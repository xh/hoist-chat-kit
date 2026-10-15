import {isEmpty, last, without} from 'lodash';
import type {ReactElement, ReactNode, RefObject} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {HoistBase, hoistCmp, HoistModel, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {textArea} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, observable, observableRef} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {createObservableRef} from '@xh/hoist/utils/react';
import {
    chatAnnouncer,
    type ChatFeedbackRating,
    type ChatMessage,
    type ChatModel
} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import {onClearLocalData} from '../../../../impl/clearLocalData';
import {chatSpinner} from '../../../impl/ChatLiveCues';

/**
 * One open feedback form: the rating it is for, and the draft of its comment and reasons. A
 * thread has at most one - see {@link ChatMessageFeedbackModel}.
 * @internal
 */
export class ChatFeedbackForm extends HoistModel {
    override xhImpl = true;

    /** The message the form rates. */
    readonly messageId: string;

    /** The rating the form sends. */
    readonly rating: ChatFeedbackRating;

    /** True if the rating saves only with this form - nothing is saved yet. */
    readonly isPending: boolean;

    @bindable accessor comment: string = '';
    @observableRef accessor reasons: string[] = [];
    @observable accessor isSubmitting = false;

    /** Why the last send failed, or null. Cleared by any change to the draft. */
    @observableRef accessor error: Error = null;

    readonly inputRef = createObservableRef<HTMLInputElement>();
    readonly sendRef = createObservableRef<HTMLElement>();
    readonly retryRef = createObservableRef<HTMLElement>();

    /** True if the draft has no comment and no reasons, so that closing it loses nothing. */
    get isEmpty(): boolean {
        return !this.comment.trim() && isEmpty(this.reasons);
    }

    /** True if the server refused the draft itself - see {@link isFeedbackRejected}. */
    get isRejected(): boolean {
        return isFeedbackRejected(this.error);
    }

    constructor(opts: {
        messageId: string;
        rating: ChatFeedbackRating;
        isPending: boolean;
        maxLength: number;
    }) {
        super();
        const {messageId, rating, isPending, maxLength} = opts;
        this.messageId = messageId;
        this.rating = rating;
        this.isPending = isPending;

        this.addReaction(
            {
                // A change after a failed send makes a new payload, so Send replaces Retry.
                track: () => [this.comment, this.reasons],
                run: () => this.setError(null)
            },
            {
                // Focus moves to the comment only when the user opened the form - never when it
                // mounts again after a scroll or a thread switch.
                track: () => this.inputRef.current,
                run: el => {
                    if (!el) return;
                    el.maxLength = maxLength;
                    if (this.isFocusPending) {
                        this.isFocusPending = false;
                        el.focus();
                    }
                },
                fireImmediately: true
            }
        );
    }

    @action
    toggleReason(reason: string) {
        const {reasons} = this;
        this.reasons = reasons.includes(reason) ? without(reasons, reason) : [...reasons, reason];
    }

    @action
    setSubmitting(isSubmitting: boolean) {
        this.isSubmitting = isSubmitting;
    }

    @action
    setError(error: Error) {
        this.error = error;
    }

    private isFocusPending = true;
}

/**
 * The feedback state of one model, which the views of its messages share: the views of one
 * message list, or of one thread across a switch away and back. At most one form is open.
 *
 * A thread's state is kept for the session only while its form is open, so that closed forms
 * leave nothing behind. `ChatKit.clearLocalData()` drops it too.
 * @internal
 */
export class ChatFeedbackThreadState extends HoistBase {
    @observableRef accessor form: ChatFeedbackForm = null;

    /** The thread the state belongs to, or null for one kept by its chat. */
    readonly threadId: string;

    constructor(threadId: string = null) {
        super();
        this.threadId = threadId;
    }

    @action
    open(form: ChatFeedbackForm) {
        this.form?.destroy();
        this.form = form;
        if (this.threadId != null) statesByThread.set(this.threadId, this);
    }

    @action
    close() {
        this.form?.destroy();
        this.form = null;
        if (this.threadId != null && statesByThread.get(this.threadId) === this) {
            statesByThread.delete(this.threadId);
        }
    }
}

/**
 * The feedback state for a chat's thread - by its `threadId` if it has one, so that a draft
 * survives a switch to another thread and back, for the session. A thread with no open form gets
 * a new state, which the session keeps once a form opens in it.
 * @internal
 */
export function getFeedbackThreadState(chatModel: ChatModel): ChatFeedbackThreadState {
    const {threadId} = chatModel;
    if (threadId != null) {
        // Observable, so that the views of a thread see a form another view opens.
        return statesByThread.get(threadId) ?? new ChatFeedbackThreadState(threadId);
    }
    let ret = statesByChat.get(chatModel);
    if (!ret) statesByChat.set(chatModel, (ret = new ChatFeedbackThreadState()));
    return ret;
}

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

    message: ChatMessage = null;

    /** The chat that takes the feedback - null for a transcript, which offers no thumbs. */
    chatModel: ChatModel = null;

    /** Set the message and chat - called as the view renders. */
    configure(message: ChatMessage, chatModel: ChatModel) {
        this.message = message;
        this.chatModel = chatModel;
    }

    get settings() {
        const {
            commentOn = 'negative',
            requireComment = false,
            reasons = [],
            clearable = true,
            maxCommentLength = 1000
        } = this.chatModel?.feedback ?? {};
        return {commentOn, requireComment, reasons, clearable, maxCommentLength};
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

    get threadState(): ChatFeedbackThreadState {
        return getFeedbackThreadState(this.chatModel);
    }

    /** This message's open form, or null. */
    get form(): ChatFeedbackForm {
        if (!this.chatModel) return null;
        const {form} = this.threadState;
        return form?.messageId === this.message.id ? form : null;
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
     * Why the thumbs wait, or null: a form in the thread holds a draft, or is sending. A form
     * with nothing in it closes instead.
     */
    get blockReason(): string {
        const {form} = this.threadState;
        if (!form || (form.isEmpty && !form.isSubmitting) || !this.isLive(form)) return null;
        return form.messageId === this.message.id
            ? 'Send or cancel your comment first.'
            : 'Finish or cancel your other feedback.';
    }

    /** True while the form sends, when the thumbs and the form disable. */
    get isSubmitting(): boolean {
        return !!this.form?.isSubmitting;
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

    /** The comment and reasons sent this session, or null - a reload does not restore them. */
    get sentNote(): {comment: string; reasons: string[]} {
        const {feedback} = this.message.metadata;
        if (!feedback || this.form || (!feedback.comment && isEmpty(feedback.reasons))) {
            return null;
        }
        return {comment: feedback.comment ?? null, reasons: feedback.reasons ?? []};
    }

    /** True if the open form can send. */
    get canSend(): boolean {
        const {form} = this;
        if (!form || form.isSubmitting || form.isRejected) return false;
        return !!form.comment.trim() || (!form.isPending && !isEmpty(form.reasons));
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
        this.threadState.close();

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
        this.threadState.close();
        this.openForm(rating, false);
    }

    /** Send the open form's rating, comment and reasons. */
    async sendAsync() {
        const {form} = this;
        if (!this.canSend) return;

        const payload: FeedbackPayload = {
            rating: form.rating,
            comment: form.comment,
            reasons: form.rating === 'negative' ? form.reasons : []
        };
        form.setSubmitting(true);
        form.setError(null);
        focusSoon(form.sendRef);
        const error = await this.submitAsync(payload);
        form.setSubmitting(false);
        if (form !== this.threadState.form) return;

        if (error) {
            form.setError(error);
            chatAnnouncer.announce(
                form.isRejected ? error.message : 'Feedback not sent. Your comment is kept.',
                'assertive'
            );
            focusSoon(form.isRejected ? form.inputRef : form.retryRef);
            return;
        }

        this.threadState.close();
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
        if (!form || form.isSubmitting) return;
        this.threadState.close();
        focusSoon(this.thumbRef(form.rating));
    }

    /** Close this message's form, if open - before the reply it describes is replaced. */
    discardForm() {
        if (this.form) this.threadState.close();
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

    asksComment(rating: ChatFeedbackRating): boolean {
        const {commentOn} = this.settings;
        return commentOn === 'both' || commentOn === rating;
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

    private thanksTimer: any;
    private failureTimer: any;

    private get lastUserMessageId(): string {
        return last(this.chatModel.messages.filter(it => it.isUser))?.id ?? '';
    }

    private requiresComment(rating: ChatFeedbackRating): boolean {
        return this.asksComment(rating) && this.settings.requireComment;
    }

    // A form whose message is gone - replaced by a regenerate, say - blocks nothing.
    private isLive(form: ChatFeedbackForm): boolean {
        return this.chatModel.messages.some(it => it.id === form.messageId);
    }

    private openForm(rating: ChatFeedbackRating, isPending: boolean) {
        this.threadState.open(
            new ChatFeedbackForm({
                messageId: this.message.id,
                rating,
                isPending,
                maxLength: this.settings.maxCommentLength
            })
        );
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
        if (offerComment && this.settings.commentOn !== 'none') {
            this.setOfferedUntil(this.lastUserMessageId);
        }
        chatAnnouncer.announce('Feedback sent.');
    }

    // The chat's error - it records it and resolves - or the promise's.
    private async submitAsync(payload: FeedbackPayload): Promise<Error> {
        const {chatModel, message} = this,
            {rating, comment, reasons} = payload;
        try {
            await chatModel.submitFeedbackAsync(
                message.id,
                rating,
                comment || undefined,
                isEmpty(reasons) ? undefined : reasons
            );
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
 * Retry, the comment and reasons sent, and "Add a comment". A fixed "not found" reply keeps only
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
    const {failure, thanks, sentNote, showsCommentLink} = model;
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
        sentNote
            ? span({
                  key: 'note',
                  className: 'xh-chat-message__feedback-note',
                  title: sentNote.comment ?? undefined,
                  'aria-label': sentNote.comment ? `Your comment: ${sentNote.comment}` : undefined,
                  items: [Icon.comment(), sentNote.reasons.join(', ') || null]
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
 * outside click cannot lose the comment. Reasons show as toggles on a negative rating. A required
 * comment must be non-blank before Send Feedback enables - reasons alone never satisfy it.
 * @internal
 */
export const chatFeedbackForm = hoistCmp.factory<FeedbackFormProps>({
    displayName: 'ChatFeedbackForm',
    model: false,

    render({model}) {
        const {form} = model;
        if (!form) return null;

        const {rating, isPending, isSubmitting, error, isRejected, comment} = form,
            {reasons, maxCommentLength} = model.settings,
            isNegative = rating === 'negative',
            heading = isNegative ? 'What went wrong?' : 'What worked?',
            hintId = `${form.xhId}-hint`,
            errorId = `${form.xhId}-error`,
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
                isNegative && !isEmpty(reasons)
                    ? div({
                          className: 'xh-chat-message__feedback-reasons',
                          role: 'group',
                          'aria-label': 'Reasons',
                          items: reasons.map(reason => {
                              const isOn = form.reasons.includes(reason);
                              return button({
                                  key: reason,
                                  className: classNames('xh-chat-message__feedback-reason', {
                                      'xh-chat-message__feedback-reason--on': isOn
                                  }),
                                  text: reason,
                                  outlined: true,
                                  active: isOn,
                                  'aria-pressed': isOn,
                                  disabled: isSubmitting,
                                  onClick: () => form.toggleReason(reason)
                              });
                          })
                      })
                    : null,
                textArea({
                    model: form,
                    bind: 'comment',
                    commitOnChange: true,
                    spellCheck: true,
                    width: null,
                    height: null,
                    disabled: isSubmitting,
                    inputRef: form.inputRef,
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
                                  ref: form.retryRef,
                                  icon: Icon.refresh(),
                                  text: 'Retry',
                                  intent: 'primary',
                                  minimal: false,
                                  onClick: () => model.sendAsync()
                              })
                            : span({
                                  // Holds focus while Send is disabled mid-flight.
                                  ref: form.sendRef,
                                  className: 'xh-chat-message__feedback-send',
                                  tabIndex: -1,
                                  items: [
                                      button({
                                          text: isSubmitting ? 'Sending…' : sendLabel,
                                          intent: 'primary',
                                          minimal: false,
                                          tooltip:
                                              isBlank && !isSubmitting && isPending
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
    reasons?: string[];
}

// HTTP statuses for a request the server understood and refused: bad, too large, unprocessable.
const REJECTED_STATUSES = [400, 413, 422];

const THANKS_MS = 3_000,
    FAILURE_MS = 8_000;

// States with an open form, by thread id, and states by chat for a chat with no thread id.
const statesByThread = observable.map<string, ChatFeedbackThreadState>({}, {deep: false}),
    statesByChat = new WeakMap<ChatModel, ChatFeedbackThreadState>();

onClearLocalData(threadIds => {
    const states = threadIds
        ? threadIds.map(id => statesByThread.get(id)).filter(it => it)
        : Array.from(statesByThread.values());
    states.forEach(it => it.close());
});

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
