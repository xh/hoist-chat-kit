import {isEmpty, keys, last, pickBy} from 'lodash';
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
    type ChatFeedbackDraft,
    type ChatFeedbackRating,
    type ChatMessage,
    type ChatModel
} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import {chatSpinner} from '../../../impl/ChatLiveCues';

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
 * The form's comment lives in the chat's {@link ChatModel.feedbackDrafts}, so it survives a new
 * view of the message, and a thread switch in a `ChatThreadsModel`, which keeps it while the
 * thread is closed. The model keeps at most one draft open per chat.
 * @internal
 */
export class ChatMessageFeedbackModel extends HoistModel {
    override xhImpl = true;

    /** "Thanks" after a save, shown 3 s - or null. */
    @observable accessor thanks: string = null;

    /** The rating whose save failed, shown 8 s with Retry - or null. */
    @observableRef accessor failure: FeedbackPayload = null;

    /** True while a rating saves without a form. */
    @observable accessor isSaving = false;

    readonly upRef = createObservableRef<HTMLElement>();
    readonly downRef = createObservableRef<HTMLElement>();
    readonly inputRef = createObservableRef<HTMLInputElement>();
    readonly sendRef = createObservableRef<HTMLElement>();
    readonly retryRef = createObservableRef<HTMLElement>();

    message: ChatMessage = null;

    /** The chat that takes the feedback - null for a transcript, which offers no thumbs. */
    chatModel: ChatModel = null;

    constructor() {
        super();
        // Focus moves to the comment only when the user opened the form - never when the form
        // mounts again in a new view, or as a thread the user returns to restores its draft.
        this.addReaction({
            track: () => this.inputRef.current,
            run: el => {
                if (!el) return;
                el.maxLength = this.settings.maxCommentLength;
                if (this.isFocusPending) {
                    this.isFocusPending = false;
                    el.focus();
                }
            }
        });
    }

    /** Set the message and chat - called as the view renders. */
    configure(message: ChatMessage, chatModel: ChatModel) {
        this.message = message;
        this.chatModel = chatModel;
    }

    get settings() {
        const {
            allowComment = true,
            requireComment = false,
            clearable = true,
            maxCommentLength = 1000
        } = this.chatModel?.feedback ?? {};
        return {allowComment, requireComment, clearable, maxCommentLength};
    }

    /** True if the user can rate the message now. */
    get canRate(): boolean {
        const {message, chatModel} = this;
        return (
            !!chatModel?.canSubmitFeedback &&
            message.isAssistant &&
            !message.isStreaming &&
            message.status !== 'paused' &&
            message.status !== 'error'
        );
    }

    /** This message's open form - the draft of its comment - or null. */
    get form(): ChatFeedbackDraft {
        return this.chatModel?.feedbackDrafts[this.message.id] ?? null;
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
        this.chatModel.setFeedbackDraft(this.message.id, {...form, comment, error: null});
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
        return this.message.metadata.feedback?.rating ?? null;
    }

    /** The rating shown as chosen - that of an open form, else the saved one. */
    get shownRating(): ChatFeedbackRating {
        return this.form?.rating ?? this.savedRating;
    }

    /**
     * Why the thumbs wait, or null: a form in the chat holds a comment. A form with nothing in it
     * closes instead.
     */
    get blockReason(): string {
        const drafts = this.chatModel?.feedbackDrafts ?? {},
            blocking = keys(pickBy(drafts, it => it.comment.trim()));
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
        return this.form ? null : (this.message.metadata.feedback?.comment ?? null);
    }

    /** True if the open form can send. */
    get canSend(): boolean {
        const {form} = this;
        return !!form && !this.isSubmitting && !this.isRejected && !!form.comment.trim();
    }

    /**
     * Rate the message, or clear its rating with a click on the chosen thumb. A rating that
     * requires a comment opens the form and saves nothing. Others save at once - opening the
     * form too if their rating asks for a comment.
     */
    async rateAsync(rating: ChatFeedbackRating) {
        if (this.isSaving || this.isSubmitting || this.blockReason) return;
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
        const {form, chatModel, message} = this;
        if (!this.canSend) return;

        const payload: FeedbackPayload = {rating: form.rating, comment: form.comment};
        chatModel.setFeedbackDraft(message.id, {...form, isSending: true, error: null});
        focusSoon(this.sendRef);
        const error = await this.submitAsync(payload);

        // The draft goes once its comment is sent, or if the chat cleared while the send ran.
        const current = chatModel.feedbackDrafts[message.id];
        if (current) chatModel.setFeedbackDraft(message.id, {...current, isSending: false, error});

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
        if (this.form) this.chatModel.setFeedbackDraft(this.message.id, null);
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

    private get lastUserMessageId(): string {
        return last(this.chatModel.messages.filter(it => it.isUser))?.id ?? '';
    }

    private requiresComment(rating: ChatFeedbackRating): boolean {
        return this.asksComment(rating) && this.settings.requireComment;
    }

    private openForm(rating: ChatFeedbackRating, isPending: boolean) {
        this.isFocusPending = true;
        this.chatModel.setFeedbackDraft(this.message.id, {
            rating,
            comment: '',
            isPending,
            isSending: false,
            error: null
        });
    }

    // The chat keeps one form open - opening one closes the rest.
    @action
    private closeForms() {
        const {chatModel} = this;
        keys(chatModel.feedbackDrafts).forEach(id => chatModel.setFeedbackDraft(id, null));
    }

    private async saveAsync(payload: FeedbackPayload, offerComment: boolean = false) {
        this.setSaving(true);
        const error = await this.submitAsync(payload);
        this.setSaving(false);
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

    // The chat's error - it records it and resolves - or the promise's.
    private async submitAsync(payload: FeedbackPayload): Promise<Error> {
        const {chatModel, message} = this,
            {rating, comment} = payload;
        try {
            await chatModel.submitFeedbackAsync(message.id, rating, comment || undefined);
        } catch (e) {
            return e;
        }
        return chatModel.feedbackErrors[message.id] ?? null;
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
    private setSaving(isSaving: boolean) {
        this.isSaving = isSaving;
    }

    @action
    private setOfferedUntil(messageId: string) {
        this.offeredUntil = messageId;
    }
}

/**
 * Thumbs up and down, as toggle buttons, then what follows a rating: "Thanks", a failure with
 * Retry, the comment sent, and "Add a comment". A fixed "not found" reply keeps only
 * the thumbs down, which says the answer is in the documents.
 * @internal
 */
export function feedbackThumbs(model: ChatMessageFeedbackModel, isNoAnswer: boolean): ReactNode[] {
    const {shownRating, form, blockReason, isSubmitting} = model,
        {clearable} = model.settings,
        thumb = (rating: ChatFeedbackRating, label: string, icon: ReactElement) => {
            const isChosen = shownRating === rating,
                ratedText = rating === 'positive' ? 'Rated good.' : 'Rated bad.',
                tooltip =
                    blockReason ??
                    (isChosen && !form
                        ? clearable
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
                disabled: isSubmitting,
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
    if (comment.length >= maxLength * 0.9) {
        return `${comment.length.toLocaleString()} / ${maxLength.toLocaleString()}`;
    }
    if (comment.trim()) return 'Ctrl/Cmd+Enter sends';
    return isPending ? 'Not saved until you send' : 'Your rating is already saved';
}

// Focus once the element can take it - after the render that enables or mounts it.
function focusSoon(ref: RefObject<HTMLElement>) {
    wait().then(() => ref.current?.focus());
}
