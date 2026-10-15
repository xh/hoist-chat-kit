import {HoistModel, managed, TaskObserver} from '@xh/hoist/core';
import {
    type ChatAnnouncePoliteness,
    chatAnnouncer,
    type ChatComposerStatus,
    ChatComposerModel
} from '../../../../core';

/**
 * Local model for a ChatStatusRegion: runs its actions, retries a turn once the server's wait
 * runs out, and announces each change of status once.
 * @internal
 */
export class ChatStatusRegionLocalModel extends HoistModel {
    override xhImpl = true;

    /** Tracks a Refresh Status in progress. */
    @managed readonly refreshTask = TaskObserver.trackLast();

    /** The composer model from props, or else that of a model in context, such as a ChatModel. */
    get composerModel(): ChatComposerModel {
        return (
            (this.componentProps.model as ChatComposerModel) ??
            this.lookupModel<ComposerOwner>(hasComposerModel)?.composerModel ??
            null
        );
    }

    override onLinked() {
        // The countdown ends in the composer model, which marks the turn due. Only a mounted
        // status region retries it, so that a chat with no region never resends unseen - and a
        // region that mounts while a turn is due retries it then.
        this.addReaction({
            track: () => this.composerModel?.retryDueId,
            run: messageId => {
                if (messageId != null) this.composerModel.retryDueAsync().catchDefault();
            },
            fireImmediately: true
        });
    }

    tryAgain = () => {
        this.composerModel.host.retryAsync?.().catchDefault();
    };

    refreshStatus = () => {
        this.composerModel.host.refreshStatusAsync?.().linkTo(this.refreshTask).catchDefault();
    };

    cancelRetry = () => {
        this.composerModel.cancelRetry();
    };

    discardDraft = () => {
        this.composerModel.discardDraft();
        this.composerModel.focus();
    };

    /**
     * Announce a status to screen readers once, when it first shows. A countdown repeats every
     * 10 s at most, and never its seconds in between. The status a thread has when the region
     * mounts, or when the thread opens, is history and never announced.
     */
    noteStatus(status: ChatComposerStatus, text: string) {
        const key = announceKey(status),
            {threadId} = this.composerModel.host,
            isBaseline = !this.hasBaseline || threadId !== this.lastThreadId;
        this.hasBaseline = true;
        this.lastThreadId = threadId;

        if (key === this.lastAnnounceKey) return;
        this.lastAnnounceKey = key;
        if (key == null || isBaseline) return;
        chatAnnouncer.announce(text, politenessOf(status));
    }

    //------------------
    // Implementation
    //------------------
    private lastAnnounceKey: string = null;
    private lastThreadId: string = null;
    private hasBaseline = false;
}

//------------------
// Implementation
//------------------
type ComposerOwner = HoistModel & {composerModel: ChatComposerModel};

function hasComposerModel(model: HoistModel): boolean {
    return (model as ComposerOwner).composerModel instanceof ChatComposerModel;
}

const COUNTDOWN_ANNOUNCE_MS = 10_000;

/** What makes a status worth announcing again, or null for one never announced. */
function announceKey(status: ChatComposerStatus): string {
    if (!status || status.type === 'busy') return null;
    const {type, replyStatus, reason, action, retryInMs} = status;
    if (type === 'waitingToRetry') {
        return `${type}:${reason}:${Math.ceil(retryInMs / COUNTDOWN_ANNOUNCE_MS)}`;
    }
    return `${type}:${replyStatus}:${reason}:${action}`;
}

// Errors interrupt. Warnings and notices wait their turn.
function politenessOf(status: ChatComposerStatus): ChatAnnouncePoliteness {
    return status.type === 'failed' && status.replyStatus === 'error' && status.isRetrySafe
        ? 'assertive'
        : 'polite';
}
