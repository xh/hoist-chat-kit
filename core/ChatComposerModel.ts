import type {HoistInputModel} from '@xh/hoist/cmp/input';
import {HoistModel, XH} from '@xh/hoist/core';
import {action, bindable, bindableRef, computed, observable, observableRef} from '@xh/hoist/mobx';
import {pluralize, throwIf} from '@xh/hoist/utils/js';
import {createObservableRef} from '@xh/hoist/utils/react';
import {findLast, isEmpty, round, take} from 'lodash';
import type {ChatComposerHost} from './ChatComposerHost';
import type {ChatModel} from './ChatModel';
import {
    type ChatComposerStatus,
    getChatComposerStatus,
    isChatRetrySafe
} from './ChatComposerStatus';
import {ChatKit} from './ChatKit';
import type {ChatFilePart} from './ChatPart';
import {getChatRetryWaitMs} from './ChatReplyStatus';
import {isChatModel} from './ChatTranscript';
import {chatDraftKey} from './impl/localData';
import {genChatId} from '../impl/ids';

/**
 * Configuration for a {@link ChatComposerModel}. Pass it as `ChatModelConfig.composer`, without
 * `host`, for the composer of a `ChatModel`.
 */
export interface ChatComposerConfig {
    /** The conversation the composer sends to. A `ChatModel` sets itself for its own composer. */
    host: ChatComposerHost;

    /** True to let the user attach files. Default false. */
    enableAttachments?: boolean;

    /**
     * File types to accept, as MIME types (`image/*`, `application/pdf`) or extensions (`.csv`).
     * Default any.
     */
    accept?: string[];

    /** Maximum files per message. Default 10. */
    maxFiles?: number;

    /** Maximum size per file, in bytes. Default 10 MB. */
    maxFileSize?: number;

    /**
     * Where to keep the unsent draft text - see {@link ChatKitDefaults.drafts}. Set 'memory' for
     * a short-lived conversation, such as a component helper's. Default `ChatKit.defaults.drafts`.
     */
    drafts?: 'local' | 'memory';
}

/** A draft the composer restored - see {@link ChatComposerModel.restoredDraft}. */
export interface ChatComposerDraft {
    /** The draft text. */
    text: string;

    /** When the draft was saved, in epoch millis. */
    savedAt: number;
}

/**
 * The wait the composer honors before it retries a failed turn - see
 * {@link ChatComposerModel.retryWait}.
 */
export interface ChatComposerRetryWait {
    /** Id of the failed reply. */
    messageId: string;

    /** When the wait ends, in epoch millis. */
    endsAt: number;
}

/**
 * Model for the message composer: the draft text and attachments of the next user message.
 * A `ChatModel` creates and manages one as its `composerModel`. To use the composer without a
 * `ChatModel`, create one with a {@link ChatComposerHost} of the app's own.
 *
 * The attachment settings are bindable, so an app can change them after construction - for
 * example to allow files only for an agent that reads them.
 *
 * The composer keeps its text per thread. When its `ChatModel` host moves to another thread,
 * outside a turn, the composer saves the text for the old thread and shows the new thread's draft,
 * or empties.
 * With `drafts: 'local'`, it saves the text after each pause of 500 ms, through
 * `XH.localStorageService`, so that the draft survives a reload. With `drafts: 'memory'`, it keeps
 * the drafts in the composer only. Attachments stay in memory, and go with a thread change. The
 * saved draft goes when the draft is sent or cleared.
 *
 * The composer also holds the state of its status region: the browser's online state, a restored
 * draft's notice, and the wait before a retry that the server asked for - see {@link getStatus}.
 */
export class ChatComposerModel extends HoistModel {
    declare config: ChatComposerConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    /** The conversation the composer sends to. */
    readonly host: ChatComposerHost;

    /** Where the composer keeps its unsent draft text. */
    readonly drafts: 'local' | 'memory';

    /**
     * Ref to the Hoist input that edits the draft. A composer component sets it as the input's
     * `ref`, which enables {@link focus}.
     */
    readonly inputRef = createObservableRef<HoistInputModel>();

    //-----------------------
    // Observable State
    //-----------------------
    /**
     * True to let the user attach files. Turning it off hides the attach button and refuses new
     * files, and leaves any files already attached in the draft. (bindable)
     */
    @bindable accessor enableAttachments: boolean;

    /** File types to accept, as MIME types or extensions, or null for any. (bindable) */
    @bindableRef accessor accept: string[];

    /** Maximum files per message. (bindable) */
    @bindable accessor maxFiles: number;

    /** Maximum size per file, in bytes. (bindable) */
    @bindable accessor maxFileSize: number;

    /** Draft message text. (observable) */
    @bindable accessor text: string = '';

    /** Files attached to the draft. (observable) */
    @observableRef accessor attachments: ChatFilePart[] = [];

    /**
     * Why files from the last attempt to attach were left out, one message per problem - shown
     * in the composer, under the attachments. Empty if all were attached. (observable)
     */
    @observableRef accessor attachmentErrors: string[] = [];

    /**
     * True while the browser reports it is offline. The composer keeps the draft and cannot send,
     * and nothing is queued to send later. (observable)
     */
    @observable accessor isOffline: boolean = isBrowserOffline();

    /**
     * The saved draft the composer restored, while its notice shows, or null. The notice goes on
     * the first change to the text, after 6 seconds, or on {@link discardDraft}. (observable)
     */
    @observableRef accessor restoredDraft: ChatComposerDraft = null;

    /**
     * The wait the server asked for before a retry of the failed last turn, while it runs, or
     * null. Set only for a failure that is retry-safe, with a host that can retry, and for at most
     * 3 retries in a row. Send is disabled meanwhile. A status region counts it down, and retries
     * once {@link retryDueId} is set - see {@link retryDueAsync}. (observable)
     */
    @observableRef accessor retryWait: ChatComposerRetryWait = null;

    /**
     * Id of the failed reply whose wait has just run out, so that the turn is due a retry, or
     * null. Cleared when the last message changes. (observable)
     */
    @observable accessor retryDueId: string = null;

    /** True if the draft has no text and no attachments. */
    @computed
    get isEmpty(): boolean {
        return !this.text.trim() && isEmpty(this.attachments);
    }

    /**
     * True if the draft can be sent now: it has content, the host is not busy, and nothing else
     * blocks it - see {@link sendDisabledReason}.
     */
    @computed
    get canSend(): boolean {
        return !this.isEmpty && !this.host.isBusy && !this.sendDisabledReason;
    }

    /**
     * Why Send is disabled for a draft with content, while the host is idle - the host's reason
     * to wait, the browser being offline, or a wait before a retry - or null.
     */
    @computed
    get sendDisabledReason(): string {
        if (this.host.sendBlockedReason) return this.host.sendBlockedReason;
        if (this.isOffline) return "You're offline";
        if (this.retryWait) return 'Waiting to retry';
        return null;
    }

    /**
     * The host, when it is a `ChatModel`, else null. Stop, per-thread drafts, and the stall,
     * retry and refresh states of the status region need one.
     */
    get chatModel(): ChatModel {
        const {host} = this;
        return isChatModel(host) ? host : null;
    }

    /** True if the host can resend the last turn - a `ChatModel`. */
    get canRetry(): boolean {
        return !!this.chatModel;
    }

    /** True if the host can reload the thread to learn how a run ended. */
    get canRefreshStatus(): boolean {
        return !!this.chatModel?.canRefreshStatus;
    }

    constructor(config: ChatComposerConfig) {
        super();
        const {
            host,
            enableAttachments = false,
            accept = null,
            maxFiles = 10,
            maxFileSize = 10 * MB,
            drafts = ChatKit.defaults.drafts
        } = config;
        throwIf(!host, 'ChatComposerModel requires a host.');
        this.host = host;
        this.drafts = drafts;
        this.enableAttachments = enableAttachments;
        this.accept = accept;
        this.maxFiles = maxFiles;
        this.maxFileSize = maxFileSize;

        // TODO(design-open B6) - drafts in local storage, keyed by user and thread, removed by
        // `ChatKit.clearLocalData()` on logout.
        this.restoreDraft(this.threadId);
        if (this.isLocalDrafts) {
            this.addReaction({
                track: () => this.text,
                run: () => this.saveDraft(this.threadId),
                debounce: DRAFT_SAVE_DELAY_MS
            });
        }
        this.addReaction(
            {
                track: () => this.threadId,
                run: (threadId, prevThreadId) => this.onThreadIdChange(threadId, prevThreadId)
            },
            {
                // Any change to the text retires the notice of a restored draft.
                track: () => this.text,
                run: text => {
                    if (this.restoredDraft && text !== this.restoredDraft.text) {
                        this.setRestoredDraft(null);
                    }
                }
            },
            {
                track: () => this.chatModel?.lastMessage,
                run: () => this.syncRetryWait(),
                fireImmediately: true
            }
        );

        window.addEventListener('online', this.onOnline);
        window.addEventListener('offline', this.onOffline);
    }

    override destroy() {
        window.removeEventListener('online', this.onOnline);
        window.removeEventListener('offline', this.onOffline);
        clearTimeout(this.retryTimer);
        clearTimeout(this.noticeTimer);
        // Keep text typed within the last pause, which the debounced save has not yet written.
        if (this.isLocalDrafts) this.saveDraft(this.threadId);
        super.destroy();
    }

    /**
     * The status the composer's status region shows now, or null - see
     * {@link getChatComposerStatus}.
     *
     * @param now - epoch millis to read the clock-based states at. Default now.
     */
    getStatus(now: number = Date.now()): ChatComposerStatus {
        const {host, chatModel} = this;
        return getChatComposerStatus({
            lastMessage: chatModel?.lastMessage,
            lastActivityAt: chatModel?.lastActivityAt,
            stallAfterMs: chatModel?.stallAfterMs,
            historyMode: chatModel?.historyMode,
            sendBlockedReason: host.sendBlockedReason,
            isOffline: this.isOffline,
            retryWaitEndsAt: this.retryWait?.endsAt,
            canRetry: this.canRetry,
            canRefreshStatus: this.canRefreshStatus,
            draftSavedAt: this.restoredDraft?.savedAt,
            now
        });
    }

    //------------------
    // Actions
    //------------------
    /**
     * Send the draft through the host, and clear it. Does nothing if it cannot be sent.
     *
     * @returns a promise that resolves when the host's `sendAsync` does.
     */
    async submitAsync(): Promise<void> {
        if (!this.canSend) return;
        const spec = {text: this.text.trim(), files: this.attachments};
        this.clear();
        this.autoRetryCount = 0;
        await this.host.sendAsync(spec);
    }

    /**
     * Resend the failed last turn, if its wait has run out - see {@link retryDueId}. Does nothing
     * if no turn is due, or while offline. A status region calls it, so that a chat with no region
     * never resends unseen. The first caller takes the retry, so two regions on one composer retry
     * once.
     */
    async retryDueAsync(): Promise<void> {
        const {retryDueId, chatModel} = this;
        if (retryDueId == null || this.isOffline || !chatModel) return;
        if (chatModel.lastMessage?.id !== retryDueId) return;

        this.setRetryDueId(null);
        this.autoRetryCount++;
        await chatModel.retryAsync();
    }

    /**
     * Attach files to the draft, read into memory as base64. Files that break the `accept`,
     * `maxFiles` or `maxFileSize` rules are left out, and `attachmentErrors` names them.
     */
    async addFilesAsync(files: File[]): Promise<void> {
        throwIf(!this.enableAttachments, 'Attachments are not enabled for this composer.');

        const {maxFiles} = this,
            problems: string[] = [],
            valid: File[] = [];
        files.forEach(file => {
            const problem = this.validateFile(file);
            if (problem) {
                problems.push(problem);
            } else {
                valid.push(file);
            }
        });

        const accepted = take(valid, Math.max(maxFiles - this.attachments.length, 0)),
            surplus = valid.length - accepted.length;
        if (surplus) {
            problems.push(
                `File limit of ${maxFiles} reached - ${surplus} ${pluralize('file', surplus)} not added.`
            );
        }
        this.setAttachmentErrors(problems);
        if (isEmpty(accepted)) return;

        const parts = await Promise.all(accepted.map(toFilePartAsync));
        this.appendAttachments(parts);
    }

    /** Remove an attachment from the draft. */
    @action
    removeAttachment(id: string) {
        this.attachments = this.attachments.filter(it => it.id !== id);
    }

    /** Clear the draft text and attachments, and remove the saved draft. */
    @action
    clear() {
        this.text = '';
        this.attachments = [];
        this.attachmentErrors = [];
        this.setRestoredDraft(null);
        this.removeSavedDraft(this.threadId);
    }

    /** Clear a restored draft - the Discard action of its notice. */
    discardDraft() {
        this.clear();
    }

    /**
     * Stop the countdown to a retry of the failed last turn. The status region then offers Try
     * Again instead.
     */
    @action
    cancelRetry() {
        const {retryWait} = this;
        if (!retryWait) return;
        this.cancelledRetryId = retryWait.messageId;
        clearTimeout(this.retryTimer);
        this.retryWait = null;
    }

    /** Dismiss the messages about files left out of the draft. */
    @action
    clearAttachmentErrors() {
        this.attachmentErrors = [];
    }

    /**
     * Put the text of the last user message into an empty draft, for re-use. Does nothing if the
     * host has no `messages`.
     */
    @action
    recallLastMessage() {
        if (this.text.trim()) return;
        const message = findLast(this.host.messages, it => it.isUser);
        if (message) this.text = message.text;
    }

    /** Move keyboard focus to the input. */
    focus() {
        this.inputRef.current?.focus();
    }

    //------------------
    // Implementation
    //------------------
    private cancelledRetryId: string = null;
    private retryTimer: ReturnType<typeof setTimeout> = null;
    private noticeTimer: ReturnType<typeof setTimeout> = null;
    /** Retries in a row that the composer ran on its own, since the last send or success. */
    private autoRetryCount = 0;
    /** Drafts by thread id, with `drafts: 'memory'`. */
    private memoryDrafts = new Map<string, ChatComposerDraft>();

    /** The thread the draft belongs to - null for a host that is not a `ChatModel`. */
    private get threadId(): string {
        return this.chatModel?.threadId ?? null;
    }

    private get isLocalDrafts(): boolean {
        return this.drafts === 'local' && !!XH.localStorageService;
    }

    private onOnline = () => this.setOffline(false);
    private onOffline = () => this.setOffline(true);

    @action
    private setOffline(isOffline: boolean) {
        this.isOffline = isOffline;
    }

    /** Start, or end, the wait before a retry of the last reply, if it failed with one. */
    @action
    private syncRetryWait() {
        clearTimeout(this.retryTimer);
        this.retryDueId = null;

        const {chatModel} = this,
            message = chatModel?.lastMessage,
            waitMs = getChatRetryWaitMs(message);
        if (message?.status === 'complete') this.autoRetryCount = 0;
        if (
            waitMs == null ||
            !this.canRetry ||
            this.autoRetryCount >= MAX_AUTO_RETRIES ||
            message.id === this.cancelledRetryId ||
            !isChatRetrySafe(message, chatModel.historyMode)
        ) {
            this.retryWait = null;
            return;
        }

        this.retryWait = {messageId: message.id, endsAt: Date.now() + waitMs};
        this.retryTimer = setTimeout(() => this.endRetryWait(message.id), waitMs);
    }

    @action
    private endRetryWait(messageId: string) {
        if (this.retryWait?.messageId !== messageId) return;
        this.retryWait = null;
        this.retryDueId = messageId;
    }

    @action
    private setRetryDueId(messageId: string) {
        this.retryDueId = messageId;
    }

    @action
    private setRestoredDraft(draft: ChatComposerDraft) {
        clearTimeout(this.noticeTimer);
        this.restoredDraft = draft;
        if (draft) {
            this.noticeTimer = setTimeout(() => this.setRestoredDraft(null), DRAFT_NOTICE_MS);
        }
    }

    /** Put the saved draft of a thread into the composer, with its notice. */
    @action
    private restoreDraft(threadId: string) {
        const draft = this.readSavedDraft(threadId);
        if (!draft?.text || draft.text === this.text) return;
        this.text = draft.text;
        this.setRestoredDraft(draft);
    }

    @action
    private onThreadIdChange(threadId: string, prevThreadId: string) {
        // A chat changes its id mid-turn only to adopt the backend's id for the same thread, so
        // the draft moves with it. Otherwise the composer now writes to another thread.
        if (this.host.isBusy) {
            this.removeSavedDraft(prevThreadId);
            this.saveDraft(threadId);
            return;
        }
        this.saveDraft(prevThreadId);
        this.text = '';
        this.attachments = [];
        this.attachmentErrors = [];
        this.setRestoredDraft(null);
        this.autoRetryCount = 0;
        this.restoreDraft(threadId);
    }

    private readSavedDraft(threadId: string): ChatComposerDraft {
        if (threadId == null) return null;
        if (!this.isLocalDrafts) return this.memoryDrafts.get(threadId) ?? null;
        try {
            return XH.localStorageService.get(chatDraftKey(threadId), null);
        } catch (e) {
            this.logWarn('Could not read the saved draft', e);
            return null;
        }
    }

    private saveDraft(threadId: string) {
        if (threadId == null) return;
        const text = this.text;
        if (!text.trim()) {
            this.removeSavedDraft(threadId);
            return;
        }
        if (this.readSavedDraft(threadId)?.text === text) return;
        if (!this.isLocalDrafts) {
            this.memoryDrafts.set(threadId, {text, savedAt: Date.now()});
            return;
        }
        try {
            XH.localStorageService.set(chatDraftKey(threadId), {text, savedAt: Date.now()});
        } catch (e) {
            this.logWarn('Could not save the draft', e);
        }
    }

    private removeSavedDraft(threadId: string) {
        if (threadId == null) return;
        if (this.isLocalDrafts) {
            XH.localStorageService.remove(chatDraftKey(threadId));
        } else {
            this.memoryDrafts.delete(threadId);
        }
    }

    @action
    private setAttachmentErrors(errors: string[]) {
        this.attachmentErrors = errors;
    }

    @action
    private appendAttachments(parts: ChatFilePart[]) {
        // Re-applies the limit, in case another add completed while these files were read.
        this.attachments = take([...this.attachments, ...parts], this.maxFiles);
    }

    /** @returns why the file cannot be attached, or null if it can. */
    private validateFile(file: File): string {
        if (!isAccepted(file, this.accept)) {
            return `'${file.name}' is not an accepted file type.`;
        }
        if (file.size > this.maxFileSize) {
            return `'${file.name}' is larger than ${fmtFileSize(this.maxFileSize)}.`;
        }
        return null;
    }
}

//------------------
// Implementation
//------------------
const MB = 1024 * 1024;

/** Most retries in a row that the composer runs on its own, before it offers Try Again only. */
const MAX_AUTO_RETRIES = 3;

/** The pause in typing after which the composer saves its draft. */
const DRAFT_SAVE_DELAY_MS = 500;

/** How long the notice of a restored draft shows. */
const DRAFT_NOTICE_MS = 6000;

function isBrowserOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isAccepted(file: File, accept: string[]): boolean {
    if (isEmpty(accept)) return true;

    const name = file.name.toLowerCase(),
        type = file.type.toLowerCase();
    return accept.some(it => {
        const rule = it.trim().toLowerCase();
        if (rule.startsWith('.')) return name.endsWith(rule);
        if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
        return type === rule;
    });
}

async function toFilePartAsync(file: File): Promise<ChatFilePart> {
    return {
        type: 'file',
        id: genChatId(),
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        size: file.size,
        data: await readBase64Async(file)
    };
}

function readBase64Async(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // The result is a data URL - `data:<type>;base64,<data>`.
            const url = reader.result as string;
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function fmtFileSize(bytes: number): string {
    return bytes >= MB ? `${round(bytes / MB, 1)} MB` : `${round(bytes / 1024)} KB`;
}
