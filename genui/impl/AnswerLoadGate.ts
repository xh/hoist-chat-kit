import {HoistBase, type LoadSpec} from '@xh/hoist/core';
import {action, computed, observable} from '@xh/hoist/mobx';
import {findLastIndex} from 'lodash';
import type {
    BlueprintDataProvider,
    BlueprintDataRequest,
    BlueprintDataResult,
    BlueprintDataUpdate,
    BlueprintLoadOptions
} from '../../blueprint';
import type {ChatModel} from '../../core';
import {getCallBudget, type OpenUiCallBudget} from './callBudget';

export interface AnswerLoadGateConfig {
    /** The app's data provider, which the gate loads through. */
    provider: BlueprintDataProvider;
    /** The chat that holds the answer. */
    chatModel: ChatModel;
    /** The reply that holds the answer. */
    messageId: string;
    /** Most loads the whole chat starts in a minute, with its OpenUI programs. Default 60. */
    maxLoadsPerMinute?: number;
}

/**
 * The data provider of one chat answer, which loads within the chat's bounds:
 *
 *  - The latest reply loads at once, and stays live where the app's provider pushes updates.
 *  - An earlier reply, or one in a transcript the chat does not hold, waits until the user acts
 *    in it, and then loads once, with no updates. A reply that stops being the latest keeps its
 *    data, and stops taking updates.
 *  - The chat starts at most `maxLoadsPerMinute` loads a minute, across its answers and OpenUI
 *    programs. A load past that waits, and the user may retry once the minute is up.
 *
 * A load that waits is never refused: `barState` says why it waits, for the answer to show.
 */
export class AnswerLoadGate extends HoistBase implements BlueprintDataProvider {
    readonly subscribe?: BlueprintDataProvider['subscribe'];
    readonly loadAggregatesAsync?: BlueprintDataProvider['loadAggregatesAsync'];

    /** True once any load of the answer has delivered rows. */
    @observable accessor hasLoaded = false;

    /** True once the minute of a capped load is up, so the user may retry. */
    @observable accessor canRetry = false;

    @observable private accessor heldCount = 0;
    @observable private accessor isCapped = false;
    @observable private accessor hasUserActed = false;

    private readonly provider: BlueprintDataProvider;
    private readonly chatModel: ChatModel;
    private readonly messageId: string;
    private readonly maxLoadsPerMinute: number;
    private readonly budget: OpenUiCallBudget;
    private waiting: (() => void)[] = [];
    private retryTimer: ReturnType<typeof setTimeout> = null;

    constructor({provider, chatModel, messageId, maxLoadsPerMinute = 60}: AnswerLoadGateConfig) {
        super();
        this.provider = provider;
        this.chatModel = chatModel;
        this.messageId = messageId;
        this.maxLoadsPerMinute = maxLoadsPerMinute;
        this.budget = getCallBudget(chatModel);

        if (provider.subscribe) this.subscribe = (req, push) => this.subscribeGated(req, push);
        if (provider.loadAggregatesAsync) {
            this.loadAggregatesAsync = (req, loadSpec, opts) =>
                this.whenAllowedAsync(() => provider.loadAggregatesAsync(req, loadSpec, opts));
        }
        this.addReaction({
            track: () => this.isLatest,
            run: isLatest => isLatest && this.releaseAll()
        });
    }

    /**
     * Why the answer's data waits, for the answer to show: `held` while a load of an earlier
     * reply waits for the user and nothing has loaded yet, `capped` while a load waits for the
     * chat's minute to pass, or null.
     */
    @computed
    get barState(): 'held' | 'capped' | null {
        if (this.isCapped) return 'capped';
        return this.heldCount > 0 && !this.hasLoaded ? 'held' : null;
    }

    /** True if the chat holds the reply, and no later one. */
    @computed
    get isLatest(): boolean {
        const messages = this.chatModel?.messages ?? [],
            idx = findLastIndex(messages, it => it.id === this.messageId);
        return idx >= 0 && !messages.slice(idx + 1).some(it => it.role === 'assistant');
    }

    /** Note that the user acted in the answer, which lets the loads of an earlier reply run. */
    @action
    noteUserAction() {
        this.hasUserActed = true;
        this.releaseAll();
    }

    /** Try the loads that waited for the chat's minute again. */
    @action
    retry() {
        this.isCapped = false;
        this.canRetry = false;
        this.releaseAll();
    }

    loadAsync(
        req: BlueprintDataRequest,
        loadSpec?: LoadSpec,
        opts?: BlueprintLoadOptions
    ): Promise<BlueprintDataResult> {
        return this.whenAllowedAsync(async () => {
            const ret = await this.provider.loadAsync(req, loadSpec, opts);
            this.noteLoaded();
            return ret;
        });
    }

    override destroy() {
        clearTimeout(this.retryTimer);
        this.waiting = [];
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private subscribeGated(
        req: BlueprintDataRequest,
        push: (update: BlueprintDataUpdate) => void
    ): () => void {
        let isClosed = false,
            close: () => void = null;
        const deliver = (update: BlueprintDataUpdate) => {
                if (isClosed) return;
                this.noteLoaded();
                push(update);
            },
            stopLive = this.addReaction({
                track: () => this.isLatest,
                run: isLatest => {
                    if (isLatest) return;
                    close?.();
                    close = null;
                }
            });

        this.whenAllowedAsync(async () => {
            if (isClosed) return;
            if (this.isLatest) {
                close = this.provider.subscribe(req, deliver);
            } else {
                const {rows, aggregates} = await this.provider.loadAsync(req);
                deliver({replace: rows, aggregates});
            }
        }).catch(e => this.logError('Could not load the data of an answer', e));

        return () => {
            isClosed = true;
            close?.();
            stopLive();
        };
    }

    // Run a load once the user may see it and the chat's budget allows. Until then it waits.
    private whenAllowedAsync<T>(run: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const attempt = () => {
                if (this.isDestroyed) return;
                if (!this.isLatest && !this.hasUserActed) return this.wait(attempt, 'held');
                if (!this.budget.take(this.maxLoadsPerMinute)) return this.wait(attempt, 'capped');
                run().then(resolve, reject);
            };
            attempt();
        });
    }

    @action
    private wait(attempt: () => void, reason: 'held' | 'capped') {
        this.waiting.push(attempt);
        if (reason === 'held') {
            this.heldCount++;
        } else if (!this.isCapped) {
            this.isCapped = true;
            this.canRetry = false;
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => this.setCanRetry(), MINUTE);
        }
    }

    @action
    private releaseAll() {
        const attempts = this.waiting;
        this.waiting = [];
        this.heldCount = 0;
        attempts.forEach(it => it());
    }

    @action
    private setCanRetry() {
        this.canRetry = true;
    }

    @action
    private noteLoaded() {
        this.hasLoaded = true;
    }
}

const MINUTE = 60_000;
