import {isEmpty, keys, last, omit, pickBy} from 'lodash';
import type {ReactElement, ReactNode, RefObject} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {createObservableRef} from '@xh/hoist/utils/react';
import {
    chatAnnouncer,
    type ChatFeedback,
    type ChatFeedbackDraft,
    type ChatFeedbackHost,
    type ChatFeedbackRating,
    type ChatFeedbackSettings,
    type ChatFeedbackSpec,
    type ChatMessage,
    type ChatModel,
    isChatModel
} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import {chatSpinner} from '../../../impl/ChatLiveCues';
import '../ChatFeedbackControls.scss';

/**
 * True if the server refused the feedback itself - an empty or over-long comment, say - rather
 * than failed to take it. Sending the same draft again cannot work, so the form shows the
 * server's reason and no Retry.
 * @internal
 */
export function isFeedbackRejected(error: Error): boolean {
    return REJECTED_STATUSES.includes((error as any)?.httpStatus);
}

/**
 * Feedback on one message, for its view: the thumbs, the inline comment form, and what shows
 * after a rating - "Thanks", a failure with Retry, and the "Add a comment" link.
 *
 * A rating that requires a comment saves nothing until the comment is sent. Others save at once,
 * optimistically, and the comment follows as an update. A failed save shows inline, never as a
 * toast: a rating's failure in the thanks slot for 8 s, a form's in the form until resent or
 * cancelled.
 *
 * The model works over a {@link ChatFeedbackHost}: a `ChatModel`, through
 * {@link getFeedbackHost}, or an app's own conversation. It shows a new rating while it saves, and
 * the host's saved rating again if the save fails.
 *
 * The form's comment lives in the host's drafts, as a `ChatModel` keeps them in
 * {@link ChatModel.feedbackDrafts}, so it survives a new view of the message, and a thread switch
 * in a `ChatThreadsModel`, which keeps it while the thread is closed. For a host that keeps none,
 * the kit keeps them, one set per host, and drops a draft when its controls unmount. Either way,
 * at most one draft is open per host.
 * @internal
 */
export class ChatMessageFeedbackModel extends HoistModel {
    override xhImpl = true;

    /** "Thanks" after a save, shown 3 s - or null. */
    @observable accessor thanks: string = null;

    /** The rating whose save failed, shown 8 s with Retry - or null. */
    @observableRef accessor failure: FeedbackPayload = null;

    /** The rating saving without a form - shown as chosen until the save ends - or null. */
    @observableRef accessor saving: FeedbackPayload = null;

    readonly upRef = createObservableRef<HTMLElement>();
    readonly downRef = createObservableRef<HTMLElement>();
    readonly inputRef = createObservableRef<HTMLInputElement>();
    readonly sendRef = createObservableRef<HTMLElement>();
    readonly retryRef = createObservableRef<HTMLElement>();

    message: ChatMessage = null;

    /** The conversation that takes the feedback - null for one that takes none. */
    host: ChatFeedbackHost = null;

    constructor() {
        super();
        // Focus moves to the comment only when the user opened the form - never when the form
        // mounts again in a new view, or as a thread the user returns to restores its draft.
        this.addReaction({
            track: () => this.inputRef.current,
            run: el => {
                if (!el) return;
                const {maxCommentLength} = this.settings;
                if (maxCommentLength != null) el.maxLength = maxCommentLength;
                if (this.isFocusPending) {
                    this.isFocusPending = false;
                    el.focus();
                }
            }
        });
    }

    /** Set the message and host - called as the view renders. */
    configure(message: ChatMessage, host: ChatFeedbackHost) {
        this.message = message;
        this.host = host;
    }

    get settings(): Required<ChatFeedbackSettings> {
        const {
            allowComment = true,
            requireComment = false,
            clearable = true,
            allowChange = true,
            maxCommentLength = 1000
        } = this.host?.feedbackSettings ?? {};
        return {allowComment, requireComment, clearable, allowChange, maxCommentLength};
    }

    /** True if the saved rating cannot change - see `allowChange`. */
    get isLocked(): boolean {
        return !this.settings.allowChange && this.savedRating != null;
    }

    /** True while a rating saves without a form. */
    get isSaving(): boolean {
        return this.saving != null;
    }

    /** True if the user can rate the message now. */
    get canRate(): boolean {
        const {message, host} = this;
        return (
            !!host &&
            message.isAssistant &&
            !message.isStreaming &&
            message.status !== 'paused' &&
            message.status !== 'error'
        );
    }

    /** This message's open form - the draft of its comment - or null. */
    get form(): ChatFeedbackDraft {
        return this.drafts[this.message.id] ?? null;
    }

    /** The open form's comment, bound to its text area. */
    get comment(): string {
        return this.form?.comment ?? '';
    }

    @action
    setComment(comment: string) {
        const {form} = this;
        if (!form) return;
        // A change after a failed send makes a new payload, so Send replaces Retry.
        this.setDraft(this.message.id, {...form, comment, error: null});
    }

    /** True while the form sends. Kept on the draft, so that a new view of the form sees it. */
    get isSubmitting(): boolean {
        return !!this.form?.isSending;
    }

    /** Why the form's last send failed, or null. Kept on the draft, as `isSubmitting` is. */
    get formError(): Error {
        return this.form?.error ?? null;
    }

    /** True if the server refused the form's comment itself - see {@link isFeedbackRejected}. */
    get isRejected(): boolean {
        return isFeedbackRejected(this.formError);
    }

    /** The rating saved on the message, or null. */
    get savedRating(): ChatFeedbackRating {
        return this.savedFeedback?.rating ?? null;
    }

    /** The rating shown as chosen - that of an open form, else one saving, else the saved one. */
    get shownRating(): ChatFeedbackRating {
        const {form, saving} = this;
        if (form) return form.rating;
        return saving ? saving.rating : this.savedRating;
    }

    /**
     * Why the thumbs wait, or null: a form in the chat holds a comment. A form with nothing in it
     * closes instead.
     */
    get blockReason(): string {
        const blocking = keys(pickBy(this.drafts, it => it.comment.trim()));
        if (isEmpty(blocking)) return null;
        return blocking.includes(this.message.id)
            ? 'Send or cancel your comment first.'
            : 'Finish or cancel your other feedback.';
    }

    /** True if "Add a comment" shows - after a rating saved with no form, until the next send. */
    get showsCommentLink(): boolean {
        const {offeredUntil} = this;
        return (
            offeredUntil != null &&
            offeredUntil === this.lastUserMessageId &&
            this.savedRating != null &&
            !this.form &&
            !this.failure
        );
    }

    /** The comment sent this session, or null - a reload does not restore it. */
    get sentComment(): string {
        return this.form ? null : (this.savedFeedback?.comment ?? null);
    }

    /** True if the open form can send. */
    get canSend(): boolean {
        const {form} = this;
        // Waits for a rating saving without its comment, so that the two never race.
        return (
            !!form &&
            !this.isSaving &&
            !this.isSubmitting &&
            !this.isRejected &&
            !!form.comment.trim()
        );
    }

    /**
     * Rate the message, or clear its rating with a click on the chosen thumb. A rating that
     * requires a comment opens the form and saves nothing. Others save at once - opening the
     * form too if their rating asks for a comment.
     */
    async rateAsync(rating: ChatFeedbackRating) {
        if (this.isSaving || this.isSubmitting || this.blockReason || this.isLocked) return;
        const current = this.shownRating,
            wasPending = !!this.form?.isPending;
        this.clearNotes();
        this.closeForms();

        if (rating === current) {
            // A pending rating saved nothing, so closing its form restores the earlier one.
            if (wasPending || !this.settings.clearable) return;
            await this.saveAsync({rating: null});
            return;
        }
        if (this.requiresComment(rating)) {
            this.openForm(rating, true);
            return;
        }
        const opensForm = this.asksComment(rating);
        if (opensForm) this.openForm(rating, false);
        await this.saveAsync({rating}, !opensForm);
    }

    /** Save the rating whose save failed again. */
    async retryRatingAsync() {
        const {failure} = this;
        if (!failure) return;
        this.clearNotes();
        await this.saveAsync(failure, !this.asksComment(failure.rating));
        this.focusThumbIfLost(failure.rating);
    }

    /** Open the optional comment form for the saved rating - "Add a comment". */
    openCommentForm() {
        const rating = this.savedRating;
        if (rating == null || this.blockReason) return;
        this.clearNotes();
        this.closeForms();
        this.openForm(rating, false);
    }

    /** Send the open form's rating and comment. */
    async sendAsync() {
        const {form, message} = this;
        if (!this.canSend) return;

        const payload: FeedbackPayload = {rating: form.rating, comment: form.comment};
        this.setDraft(message.id, {...form, isSending: true, error: null});
        focusSoon(this.sendRef);
        const error = await this.submitAsync(payload);

        // A sent comment's draft goes, as does one the host cleared while the send ran.
        const current = error ? this.drafts[message.id] : null;
        this.setDraft(message.id, current ? {...current, isSending: false, error} : null);

        if (error) {
            if (!current) return;
            chatAnnouncer.announce(
                this.isRejected ? error.message : 'Feedback not sent. Your comment is kept.',
                'assertive'
            );
            focusSoon(this.isRejected ? this.inputRef : this.retryRef);
            return;
        }

        this.closeForms();
        this.clearNotes();
        this.showThanks('Thanks, feedback sent');
        chatAnnouncer.announce('Feedback sent.');
        focusSoon(this.thumbRef(payload.rating));
    }

    /**
     * Close the open form. A pending rating goes with it, which restores the earlier rating.
     * Focus returns to the thumb that opened it.
     */
    cancelForm() {
        const {form} = this;
        if (!form || this.isSubmitting) return;
        this.closeForms();
        focusSoon(this.thumbRef(form.rating));
    }

    /** Close this message's form, if open - before the reply it describes is replaced. */
    discardForm() {
        if (this.form) this.setDraft(this.message.id, null);
    }

    // Typed as Hoist's TextArea types its onKeyDown. Enter adds a newline: this is a comment, not
    // the composer.
    onFormKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.cancelForm();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            this.sendAsync();
        }
    };

    thumbRef(rating: ChatFeedbackRating): RefObject<HTMLElement> {
        return rating === 'positive' ? this.upRef : this.downRef;
    }

    /** True if the rating opens the comment form at once - a thumbs down, if comments are on. */
    asksComment(rating: ChatFeedbackRating): boolean {
        return rating === 'negative' && this.settings.allowComment;
    }

    override destroy() {
        // A draft the kit keeps goes with its controls, so that no hidden form blocks the thumbs.
        if (this.message && this.draftStore instanceof KitDraftStore) {
            this.setDraft(this.message.id, null);
        }
        clearTimeout(this.thanksTimer);
        clearTimeout(this.failureTimer);
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    /** The last user message when "Add a comment" was offered - it shows until the next send. */
    @observable private accessor offeredUntil: string = null;

    private isFocusPending = false;
    private thanksTimer: any;
    private failureTimer: any;

    private get savedFeedback(): ChatFeedback {
        const {host, message} = this;
        return host?.getFeedback(message) ?? null;
    }

    // The host's drafts, else those the kit keeps for it.
    private get draftStore(): FeedbackDraftStore {
        const {host} = this;
        if (!host) return EMPTY_DRAFTS;
        if (host.feedbackDrafts && host.setFeedbackDraft) return host as FeedbackDraftStore;
        let ret = KIT_DRAFTS.get(host);
        if (!ret) {
            ret = new KitDraftStore();
            KIT_DRAFTS.set(host, ret);
        }
        return ret;
    }

    private get drafts(): Record<string, ChatFeedbackDraft> {
        return this.draftStore.feedbackDrafts;
    }

    private setDraft(messageId: string, draft: ChatFeedbackDraft) {
        this.draftStore.setFeedbackDraft(messageId, draft);
    }

    private get lastUserMessageId(): string {
        return last(this.host?.messages?.filter(it => it.isUser))?.id ?? '';
    }

    private requiresComment(rating: ChatFeedbackRating): boolean {
        return this.asksComment(rating) && this.settings.requireComment;
    }

    private openForm(rating: ChatFeedbackRating, isPending: boolean) {
        this.isFocusPending = true;
        this.setDraft(this.message.id, {
            rating,
            comment: '',
            isPending,
            isSending: false,
            error: null
        });
    }

    // The host keeps one form open - opening one closes the rest.
    @action
    private closeForms() {
        keys(this.drafts).forEach(id => this.setDraft(id, null));
    }

    private async saveAsync(payload: FeedbackPayload, offerComment: boolean = false) {
        this.setSaving(payload);
        const error = await this.submitAsync(payload);
        this.setSaving(null);
        if (error) {
            this.showFailure(payload);
            chatAnnouncer.announce('Rating not saved.', 'assertive');
            return;
        }
        if (payload.rating == null) {
            chatAnnouncer.announce('Rating removed.');
            return;
        }
        this.showThanks('Thanks');
        if (offerComment && this.settings.allowComment) {
            this.setOfferedUntil(this.lastUserMessageId);
        }
        chatAnnouncer.announce('Feedback sent.');
    }

    // The error of a failed submit, or null.
    private async submitAsync(payload: FeedbackPayload): Promise<Error> {
        const {host, message} = this,
            spec: ChatFeedbackSpec = {
                threadId: host.threadId,
                messageId: message.id,
                serverId: message.metadata.serverId ?? null,
                runId: message.metadata.runId ?? null,
                rating: payload.rating ?? null,
                comment: payload.comment?.trim() || null
            };
        try {
            await host.submitFeedbackAsync(spec, message);
        } catch (e) {
            return e;
        }
        return null;
    }

    // A thumb keeps focus through a save. Should the browser drop it, put it back.
    private focusThumbIfLost(rating: ChatFeedbackRating) {
        const {activeElement} = document;
        if (!activeElement || activeElement === document.body) focusSoon(this.thumbRef(rating));
    }

    @action
    private clearNotes() {
        clearTimeout(this.thanksTimer);
        clearTimeout(this.failureTimer);
        this.thanks = null;
        this.failure = null;
        this.offeredUntil = null;
    }

    @action
    private showThanks(text: string) {
        this.thanks = text;
        clearTimeout(this.thanksTimer);
        this.thanksTimer = setTimeout(() => this.setThanks(null), THANKS_MS);
    }

    @action
    private showFailure(payload: FeedbackPayload) {
        this.failure = payload;
        clearTimeout(this.failureTimer);
        this.failureTimer = setTimeout(() => this.setFailure(null), FAILURE_MS);
    }

    @action
    private setThanks(text: string) {
        this.thanks = text;
    }

    @action
    private setFailure(payload: FeedbackPayload) {
        this.failure = payload;
    }

    @action
    private setSaving(payload: FeedbackPayload) {
        this.saving = payload;
    }

    @action
    private setOfferedUntil(messageId: string) {
        this.offeredUntil = messageId;
    }
}

/**
 * The feedback host of a `ChatModel`, or null if it takes no feedback - see
 * `ChatModel.canSubmitFeedback`. One per chat, so that the controls see a stable host.
 * @internal
 */
export function getFeedbackHost(chatModel: ChatModel): ChatFeedbackHost {
    if (!chatModel?.canSubmitFeedback) return null;
    let ret = CHAT_MODEL_HOSTS.get(chatModel);
    if (!ret) {
        ret = new ChatModelFeedbackHost(chatModel);
        CHAT_MODEL_HOSTS.set(chatModel, ret);
    }
    return ret;
}

/**
 * The feedback host of the controls' `host` prop: a `ChatModel`'s own, else the host itself.
 * @internal
 */
export function resolveFeedbackHost(host: ChatFeedbackHost | ChatModel): ChatFeedbackHost {
    return isChatModel(host) ? getFeedbackHost(host) : (host ?? null);
}

/**
 * Thumbs up and down, as toggle buttons, then what follows a rating: "Thanks", a failure with
 * Retry, the comment sent, and "Add a comment". A fixed "not found" reply keeps only
 * the thumbs down, which says the answer is in the documents.
 * @internal
 */
export function feedbackThumbs(model: ChatMessageFeedbackModel, isNoAnswer: boolean): ReactNode[] {
    const {shownRating, form, blockReason, isSubmitting, isLocked} = model,
        {clearable} = model.settings,
        thumb = (rating: ChatFeedbackRating, label: string, icon: ReactElement) => {
            const isChosen = shownRating === rating,
                ratedText = rating === 'positive' ? 'Rated good.' : 'Rated bad.',
                tooltip =
                    blockReason ??
                    (isChosen && !form
                        ? clearable && !isLocked
                            ? `${ratedText} Click to clear.`
                            : ratedText
                        : label);
            return button({
                key: rating,
                ref: model.thumbRef(rating),
                className: classNames('xh-chat-message__thumb', {
                    'xh-chat-message__thumb--chosen': isChosen
                }),
                icon,
                tooltip,
                'aria-label': label,
                'aria-pressed': isChosen,
                // A locked rating keeps its thumb pressed, and the other unavailable.
                disabled: isSubmitting || (isLocked && !isChosen),
                onClick: () => model.rateAsync(rating)
            });
        };

    if (isNoAnswer) {
        return [
            thumb('negative', 'It is in these documents', Icon.thumbsDown()),
            span({
                key: 'hint',
                className: 'xh-chat-message__thumb-hint',
                item: 'Thumbs down here means "it is in these documents"'
            }),
            feedbackStatus(model)
        ];
    }
    return [
        thumb('positive', 'Good response', Icon.thumbsUp()),
        thumb('negative', 'Bad response', Icon.thumbsDown()),
        feedbackStatus(model)
    ];
}

/** What follows the thumbs - always shown, as the chosen thumb is. */
function feedbackStatus(model: ChatMessageFeedbackModel): ReactNode {
    const {failure, thanks, sentComment, showsCommentLink} = model;
    if (failure) {
        return span({
            key: 'status',
            className: 'xh-chat-message__feedback-status xh-chat-message__feedback-status--failed',
            items: [
                Icon.error(),
                span({item: "Couldn't save rating"}),
                button({
                    className: 'xh-chat-message__feedback-retry',
                    icon: Icon.refresh(),
                    text: 'Retry',
                    onClick: () => model.retryRatingAsync()
                })
            ]
        });
    }

    const items = [
        sentComment
            ? span({
                  key: 'note',
                  className: 'xh-chat-message__feedback-note',
                  title: sentComment,
                  'aria-label': `Your comment: ${sentComment}`,
                  item: Icon.comment()
              })
            : null,
        thanks
            ? span({
                  key: 'thanks',
                  className: 'xh-chat-message__feedback-thanks',
                  items: [Icon.check(), thanks]
              })
            : null,
        showsCommentLink
            ? button({
                  key: 'comment',
                  className: 'xh-chat-message__feedback-link',
                  text: 'Add a comment',
                  onClick: () => model.openCommentForm()
              })
            : null
    ].filter(it => it);
    if (!items.length) return null;

    return span({
        key: 'status',
        className: 'xh-chat-message__feedback-status',
        items: items.flatMap((it, idx) =>
            idx
                ? [span({key: `sep${idx}`, className: 'xh-chat-message__dot', item: '·'}), it]
                : [it]
        )
    });
}

interface FeedbackFormProps extends HoistProps {
    model: ChatMessageFeedbackModel;
}

/**
 * The comment form for a rating, inline under the action bar - never in a popover, so that an
 * outside click cannot lose the comment. A comment must be non-blank before Send enables.
 * @internal
 */
export const chatFeedbackForm = hoistCmp.factory<FeedbackFormProps>({
    displayName: 'ChatFeedbackForm',
    model: false,

    render({model}) {
        const {form} = model;
        if (!form) return null;

        const {rating, isPending, comment} = form,
            {isSubmitting, formError: error, isRejected} = model,
            {maxCommentLength} = model.settings,
            isNegative = rating === 'negative',
            heading = isNegative ? 'What went wrong?' : 'What worked?',
            hintId = `${model.xhId}-hint`,
            errorId = `${model.xhId}-error`,
            isBlank = !comment.trim(),
            isFailed = !!error && !isRejected,
            sendLabel = !isNegative && !isPending ? 'Send Comment' : 'Send Feedback';

        return div({
            className: 'xh-chat-message__feedback',
            role: 'group',
            'aria-label': heading,
            items: [
                div({
                    className: 'xh-chat-message__feedback-heading',
                    items: [
                        heading,
                        span({
                            id: hintId,
                            className: 'xh-chat-message__feedback-hint',
                            item: isPending ? 'Comment required' : 'Optional'
                        })
                    ]
                }),
                textArea({
                    model,
                    bind: 'comment',
                    commitOnChange: true,
                    spellCheck: true,
                    width: null,
                    height: null,
                    disabled: isSubmitting,
                    inputRef: model.inputRef,
                    placeholder: isNegative
                        ? 'Say what was wrong. A sentence is enough.'
                        : 'Anything we should keep doing',
                    domAttrs: {
                        'aria-label': heading,
                        'aria-describedby': error ? `${hintId} ${errorId}` : hintId,
                        'aria-invalid': isRejected || undefined
                    },
                    onKeyDown: model.onFormKeyDown
                }),
                error
                    ? div({
                          id: errorId,
                          className: 'xh-chat-message__feedback-error',
                          items: [
                              Icon.error(),
                              isRejected && error.message
                                  ? error.message
                                  : "Couldn't send feedback. Your comment is kept."
                          ]
                      })
                    : null,
                div({
                    className: 'xh-chat-message__feedback-bar',
                    items: [
                        isFailed
                            ? button({
                                  ref: model.retryRef,
                                  icon: Icon.refresh(),
                                  text: 'Retry',
                                  intent: 'primary',
                                  minimal: false,
                                  onClick: () => model.sendAsync()
                              })
                            : span({
                                  // Holds focus while Send is disabled mid-flight.
                                  ref: model.sendRef,
                                  className: 'xh-chat-message__feedback-send',
                                  tabIndex: -1,
                                  items: [
                                      button({
                                          text: isSubmitting ? 'Sending…' : sendLabel,
                                          intent: 'primary',
                                          minimal: false,
                                          tooltip:
                                              isBlank && !isSubmitting
                                                  ? 'Add a comment to send'
                                                  : null,
                                          disabled: !model.canSend,
                                          onClick: () => model.sendAsync()
                                      }),
                                      isSubmitting ? chatSpinner() : null
                                  ]
                              }),
                        // No Cancel in flight: the request cannot be recalled.
                        isSubmitting
                            ? null
                            : button({text: 'Cancel', onClick: () => model.cancelForm()}),
                        span({
                            className: 'xh-chat-message__feedback-tip',
                            item: footHint(comment, isPending, isSubmitting, maxCommentLength)
                        })
                    ]
                })
            ]
        });
    }
});

//------------------
// Implementation
//------------------
interface FeedbackPayload {
    rating: ChatFeedbackRating;
    comment?: string;
}

// A ChatModel as a feedback host. The chat shows a rating at once and reverts it itself, and
// records a failure rather than throwing it, so the host throws the recorded error.
class ChatModelFeedbackHost implements ChatFeedbackHost {
    constructor(private readonly chatModel: ChatModel) {}

    get threadId(): string {
        return this.chatModel.threadId;
    }

    get feedbackSettings(): ChatFeedbackSettings {
        return this.chatModel.feedback;
    }

    get feedbackDrafts(): Record<string, ChatFeedbackDraft> {
        return this.chatModel.feedbackDrafts;
    }

    get messages(): ChatMessage[] {
        return this.chatModel.messages;
    }

    // The view's own message, so that a rating tracks no other message.
    getFeedback(message: ChatMessage): ChatFeedback {
        return message.metadata.feedback ?? null;
    }

    setFeedbackDraft(messageId: string, draft: ChatFeedbackDraft) {
        this.chatModel.setFeedbackDraft(messageId, draft);
    }

    async submitFeedbackAsync({messageId, rating, comment}: ChatFeedbackSpec) {
        const {chatModel} = this;
        await chatModel.submitFeedbackAsync(messageId, rating, comment ?? undefined);
        const error = chatModel.feedbackErrors[messageId];
        if (error) throw error;
    }
}

const CHAT_MODEL_HOSTS = new WeakMap<ChatModel, ChatFeedbackHost>();

// Where a host's drafts live - see `ChatFeedbackHost.feedbackDrafts`.
type FeedbackDraftStore = Required<Pick<ChatFeedbackHost, 'feedbackDrafts' | 'setFeedbackDraft'>>;

// The drafts the kit keeps for a host that keeps none.
class KitDraftStore implements FeedbackDraftStore {
    @observableRef accessor feedbackDrafts: Record<string, ChatFeedbackDraft> = {};

    @action
    setFeedbackDraft(messageId: string, draft: ChatFeedbackDraft) {
        if (draft) {
            this.feedbackDrafts = {...this.feedbackDrafts, [messageId]: draft};
        } else if (this.feedbackDrafts[messageId]) {
            this.feedbackDrafts = omit(this.feedbackDrafts, messageId);
        }
    }
}

const KIT_DRAFTS = new WeakMap<ChatFeedbackHost, FeedbackDraftStore>(),
    EMPTY_DRAFTS: FeedbackDraftStore = {feedbackDrafts: {}, setFeedbackDraft: () => {}};

// HTTP statuses for a request the server understood and refused: bad, too large, unprocessable.
const REJECTED_STATUSES = [400, 413, 422];

const THANKS_MS = 3_000,
    FAILURE_MS = 8_000;

function footHint(
    comment: string,
    isPending: boolean,
    isSubmitting: boolean,
    maxLength: number
): string {
    if (isSubmitting) return null;
    if (maxLength != null && comment.length >= maxLength * 0.9) {
        return `${comment.length.toLocaleString()} / ${maxLength.toLocaleString()}`;
    }
    if (comment.trim()) return 'Ctrl/Cmd+Enter sends';
    return isPending ? 'Not saved until you send' : 'Your rating is already saved';
}

// Focus once the element can take it - after the render that enables or mounts it.
function focusSoon(ref: RefObject<HTMLElement>) {
    wait().then(() => ref.current?.focus());
}
