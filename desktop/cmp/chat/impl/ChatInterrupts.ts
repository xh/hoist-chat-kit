import {isInterruptExpired} from '@ag-ui/client';
import type {ReactNode} from 'react';
import {form, FormModel} from '@xh/hoist/cmp/form';
import {div, span} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type PlainObject,
    useLocalModel
} from '@xh/hoist/core';
import {numberIs, required} from '@xh/hoist/data';
import {button} from '@xh/hoist/desktop/cmp/button';
import {formField} from '@xh/hoist/desktop/cmp/form';
import {
    dateInput,
    numberInput,
    select,
    switchInput,
    textArea,
    textInput
} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, observable} from '@xh/hoist/mobx';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {isArray, isEmpty, isNil, isString} from 'lodash';
import {
    type ChatInterrupt,
    type ChatMessage,
    type ChatModel,
    type ChatSubagentData,
    isChatSubagentPart
} from '../../../../core';
import {classNames} from '../../../../impl/ClassNames';
import {
    checkInterruptAnswer,
    getInterruptAnswerSpec,
    type InterruptAnswerSpec,
    type InterruptField,
    isApprovalSchema
} from '../../../../impl/interruptSchema';
import {useChatClock} from './useChatClock';
import './ChatInterrupts.scss';

/** @internal */
export interface ChatInterruptsProps extends HoistProps {
    /** The reply that holds the interrupts, in its `metadata.interrupts`. */
    message: ChatMessage;

    /** The chat that takes the answers - null for a transcript, which shows the record alone. */
    chatModel: ChatModel;

    /** The step of the reply whose interrupts to show. */
    step: number;
}

/**
 * The questions a server agent asked in a reply, through AG-UI interrupts. While the reply waits,
 * one framed panel asks them, a step per question, with Decline on each. A lone question answers
 * and resumes the run at once. Several end in a review step, where the user can change an answer
 * before Submit. Approvals show on their tool calls, and in the review step.
 *
 * Once the reply moves on, each question shrinks to one line with its answer.
 * @internal
 */
export const chatInterrupts = hoistCmp.factory<ChatInterruptsProps>({
    displayName: 'ChatInterrupts',
    className: 'xh-chat-interrupts',

    render({className, message, chatModel, step}) {
        const impl = useLocalModel(InterruptsLocalModel),
            all = ((message.metadata.interrupts ?? []) as ChatInterrupt[]).filter(
                it => it.step === step
            ),
            pending =
                chatModel?.lastMessage?.id === message.id
                    ? chatModel.pendingInterrupts.filter(it =>
                          all.some(own => own.runId === it.runId && own.id === it.id)
                      )
                    : [],
            now = useChatClock(pending.some(it => it.expiresAt != null));
        if (isEmpty(all)) return null;

        if (isEmpty(pending)) {
            const asked = all.filter(it => !isCardApproval(it, message));
            return isEmpty(asked)
                ? null
                : div({
                      className: classNames(className, 'xh-chat-interrupts--record'),
                      items: asked.map(it => recordLine(it, message))
                  });
        }

        impl.update(chatModel, message, pending, now);
        const {questions} = impl;
        // A lone approval answers on its call.
        if (isEmpty(questions) && pending.length === 1) return null;

        return div({
            className,
            role: 'group',
            'aria-label': questions.length === 1 ? 'Question' : 'Questions',
            items: impl.isReviewing || isEmpty(questions) ? reviewStep(impl) : questionStep(impl)
        });
    }
});

//------------------
// Steps
//------------------
function questionStep(impl: InterruptsLocalModel): ReactNode[] {
    const {current: interrupt, questions, message} = impl,
        spec = getInterruptAnswerSpec(interrupt.responseSchema),
        idx = questions.indexOf(interrupt),
        isExpired = impl.isExpired(interrupt);

    return [
        header(
            interrupt,
            message,
            questions.length > 1 ? `${idx + 1} of ${questions.length}` : null
        ),
        div({className: 'xh-chat-interrupts__question', item: questionText(interrupt)}),
        isExpired
            ? div({
                  className: 'xh-chat-interrupts__note',
                  item: 'This question expired. It goes back declined.'
              })
            : answerControls(impl, interrupt, spec),
        div({
            className: 'xh-chat-interrupts__bar',
            items: [
                idx > 0
                    ? button({
                          text: 'Back',
                          icon: Icon.chevronLeft(),
                          onClick: () => impl.show(questions[idx - 1])
                      })
                    : null,
                div({className: 'xh-chat-interrupts__spacer'}),
                isExpired
                    ? button({
                          text: 'Next',
                          outlined: true,
                          minimal: false,
                          onClick: () => impl.advance()
                      })
                    : button({
                          className: 'xh-chat-interrupts__decline',
                          text: 'Decline',
                          onClick: () => impl.respond(interrupt, null)
                      }),
                // A form sends from the step's bar, beside Decline.
                spec.kind === 'form' && !isExpired
                    ? button({
                          text: 'Send',
                          intent: 'primary',
                          minimal: false,
                          onClick: () => impl.sendFormAsync(interrupt, spec).catchDefault()
                      })
                    : null
            ]
        })
    ];
}

function reviewStep(impl: InterruptsLocalModel): ReactNode[] {
    const {pending, message, chatModel, questions} = impl,
        open = chatModel.openInterrupts,
        hasOpen = !isEmpty(open),
        note = open.some(it => questions.includes(it))
            ? 'Answer or decline each question to continue.'
            : 'Allow or deny each action above to continue.';
    return [
        header(null, message, 'Review'),
        div({
            className: 'xh-chat-interrupts__review',
            items: pending.map(it =>
                div({
                    key: it.id,
                    className: 'xh-chat-interrupts__review-row',
                    items: [
                        div({
                            className: 'xh-chat-interrupts__review-text',
                            items: [
                                div({
                                    className: 'xh-chat-interrupts__review-question',
                                    item: questionText(it)
                                }),
                                div({
                                    className: 'xh-chat-interrupts__answer',
                                    item: summarize(it, message, impl.isExpired(it))
                                })
                            ]
                        }),
                        questions.includes(it)
                            ? button({text: 'Change', onClick: () => impl.show(it)})
                            : null
                    ]
                })
            )
        }),
        hasOpen ? div({className: 'xh-chat-interrupts__note', item: note}) : null,
        div({
            className: 'xh-chat-interrupts__bar',
            items: [
                div({className: 'xh-chat-interrupts__spacer'}),
                button({
                    text: 'Submit',
                    icon: Icon.arrowRight(),
                    intent: 'primary',
                    minimal: false,
                    disabled: hasOpen,
                    onClick: () => impl.submit()
                })
            ]
        })
    ];
}

function header(interrupt: ChatInterrupt, message: ChatMessage, step: string): ReactNode {
    const asker = interrupt ? getSubagentName(interrupt, message) : null;
    return div({
        className: 'xh-chat-interrupts__header',
        items: [
            Icon.questionCircle({className: 'xh-chat-interrupts__icon'}),
            span({className: 'xh-chat-interrupts__asker', item: asker ?? 'The assistant asks'}),
            step ? span({className: 'xh-chat-interrupts__step', item: step}) : null
        ]
    });
}

//------------------
// Answers
//------------------
function answerControls(
    impl: InterruptsLocalModel,
    interrupt: ChatInterrupt,
    spec: InterruptAnswerSpec
): ReactNode {
    const answered = interrupt.response?.status === 'resolved' ? interrupt.response.payload : null;
    switch (spec.kind) {
        case 'text':
            return div({
                className: 'xh-chat-interrupts__text',
                items: [
                    textArea({
                        model: impl,
                        bind: 'text',
                        commitOnChange: true,
                        width: null,
                        placeholder: 'Your answer',
                        domAttrs: {'aria-label': 'Your answer'}
                    }),
                    button({
                        text: 'Send',
                        intent: 'primary',
                        minimal: false,
                        onClick: () => impl.respond(interrupt, impl.text.trim() || undefined)
                    })
                ]
            });
        case 'choice': {
            const {field, options} = spec,
                chosen = field && answered ? (answered as PlainObject)[field] : answered,
                choose = (value: string) =>
                    impl.respond(interrupt, field ? {[field]: value} : value);
            if (options.length > 3) {
                return div({
                    className: 'xh-chat-interrupts__text',
                    items: [
                        select({
                            model: impl,
                            bind: 'choice',
                            options: options.map(it => ({value: it.value, label: it.label})),
                            width: 240,
                            placeholder: 'Choose an answer...'
                        }),
                        button({
                            text: 'Send',
                            intent: 'primary',
                            minimal: false,
                            disabled: impl.choice == null,
                            onClick: () => choose(impl.choice)
                        })
                    ]
                });
            }
            return optionRows(
                options.map(it => ({
                    key: it.value,
                    label: it.label,
                    description: it.description,
                    isChosen: chosen === it.value,
                    onClick: () => choose(it.value)
                }))
            );
        }
        case 'confirm':
            return optionRows([
                {
                    key: 'yes',
                    label: 'Yes',
                    isChosen: answered === true,
                    onClick: () => impl.respond(interrupt, true)
                },
                {
                    key: 'no',
                    label: 'No',
                    isChosen: answered === false,
                    onClick: () => impl.respond(interrupt, false)
                }
            ]);
        case 'form': {
            const formModel = impl.getFormModel(interrupt, spec.fields);
            return div({
                className: 'xh-chat-interrupts__form',
                items: [
                    form({
                        model: formModel,
                        fieldDefaults: {commitOnChange: true},
                        items: spec.fields.map(field =>
                            formField({
                                key: field.name,
                                field: field.name,
                                label: field.label,
                                info: field.description,
                                item: inputFor(field)
                            })
                        )
                    }),
                    impl.problem
                        ? div({className: 'xh-chat-interrupts__problem', item: impl.problem})
                        : null
                ]
            });
        }
        default:
            return div({
                className: 'xh-chat-interrupts__note',
                item: 'This question cannot be answered here.'
            });
    }
}

function optionRows(
    rows: Array<{
        key: string;
        label: string;
        description?: string;
        isChosen: boolean;
        onClick: () => void;
    }>
): ReactNode {
    return div({
        className: 'xh-chat-interrupts__options',
        items: rows.map((row, idx) =>
            button({
                key: row.key,
                className: classNames('xh-chat-interrupts__option', {
                    'xh-chat-interrupts__option--chosen': row.isChosen
                }),
                minimal: false,
                outlined: true,
                text: div({
                    className: 'xh-chat-interrupts__option-text',
                    items: [
                        span({className: 'xh-chat-interrupts__option-index', item: `${idx + 1}`}),
                        span({className: 'xh-chat-interrupts__option-label', item: row.label}),
                        row.description
                            ? span({
                                  className: 'xh-chat-interrupts__option-description',
                                  item: row.description
                              })
                            : null
                    ]
                }),
                onClick: row.onClick
            })
        )
    });
}

function inputFor(field: InterruptField): ReactNode {
    switch (field.type) {
        case 'date':
            return dateInput({valueType: 'localDate', width: 160});
        case 'number':
        case 'integer':
            return numberInput({
                min: field.min,
                max: field.max,
                precision: field.type === 'integer' ? 0 : undefined,
                width: 160
            });
        case 'boolean':
            return switchInput();
        case 'choice':
            return select({options: field.options.map(it => ({value: it.value, label: it.label}))});
        case 'choices':
            return select({
                enableMulti: true,
                options: field.options.map(it => ({value: it.value, label: it.label}))
            });
        default:
            return textInput();
    }
}

//------------------
// Records
//------------------
function recordLine(interrupt: ChatInterrupt, message: ChatMessage): ReactNode {
    return div({
        key: `${interrupt.runId}:${interrupt.id}`,
        className: 'xh-chat-interrupts__record',
        items: [
            Icon.questionCircle({className: 'xh-chat-interrupts__icon'}),
            span({className: 'xh-chat-interrupts__record-question', item: questionText(interrupt)}),
            span({
                className: 'xh-chat-interrupts__answer',
                item: summarize(interrupt, message, false)
            })
        ]
    });
}

/** The user's response, as a short phrase. */
function summarize(interrupt: ChatInterrupt, message: ChatMessage, isExpired: boolean): string {
    const {response} = interrupt;
    if (isCardApproval(interrupt, message)) {
        const call = message.toolCalls.find(it => it.id === interrupt.toolCallId);
        if (response == null) return isExpired ? 'Expired' : 'Waiting for you';
        if (response.status === 'cancelled') return 'Declined';
        return call?.state === 'output-denied' ? 'Denied' : 'Allowed';
    }
    if (response == null) return isExpired ? 'Expired' : 'No answer';
    if (response.status === 'cancelled') {
        return {expired: 'Expired', skipped: 'Skipped'}[response.declinedBy] ?? 'Declined';
    }
    return formatAnswer(getInterruptAnswerSpec(interrupt.responseSchema), response.payload);
}

function formatAnswer(spec: InterruptAnswerSpec, payload: unknown): string {
    if (payload === undefined) return 'Answered with nothing';
    switch (spec.kind) {
        case 'choice': {
            const value = spec.field ? (payload as PlainObject)?.[spec.field] : payload;
            return spec.options.find(it => it.value === value)?.label ?? String(value);
        }
        case 'confirm':
            return payload ? 'Yes' : 'No';
        case 'form':
            return spec.fields
                .filter(it => !isNil((payload as PlainObject)?.[it.name]))
                .map(it => `${it.label}: ${formatValue((payload as PlainObject)[it.name], it)}`)
                .join(', ');
        default:
            return isString(payload) ? payload : JSON.stringify(payload);
    }
}

function formatValue(value: unknown, field: InterruptField): string {
    const labelOf = (it: unknown) => field.options?.find(o => o.value === it)?.label ?? String(it);
    if (isArray(value)) return value.map(labelOf).join(', ');
    if (field.type === 'boolean') return value ? 'Yes' : 'No';
    return labelOf(value);
}

//------------------
// Implementation
//------------------
function questionText(interrupt: ChatInterrupt): string {
    return interrupt.message ?? 'The assistant needs your input.';
}

/** True for an interrupt that asks to approve a server call, which shows on the call's card. */
function isCardApproval(interrupt: ChatInterrupt, message: ChatMessage): boolean {
    return (
        interrupt.toolCallId != null &&
        isApprovalSchema(interrupt.responseSchema) &&
        message.toolCalls.some(it => it.id === interrupt.toolCallId && it.awaitsResume)
    );
}

function getSubagentName(interrupt: ChatInterrupt, message: ChatMessage): string {
    if (interrupt.subagentRunId == null) return null;
    const part = message.parts.find(
        it => isChatSubagentPart(it) && it.id === interrupt.subagentRunId
    );
    return part ? ((part as {data: ChatSubagentData}).data.name ?? null) : null;
}

class InterruptsLocalModel extends HoistModel {
    override xhImpl = true;

    /** Draft of the current question's text answer. */
    @bindable accessor text: string = '';

    /** The current question's choice, for a list of more than three options. */
    @bindable accessor choice: string = null;

    /** Why the current answer cannot be sent, or null. */
    @bindable accessor problem: string = null;

    /** Id of the question on show. */
    @observable accessor currentId: string = null;

    /** True while the review step shows. */
    @observable accessor isReviewing = false;

    chatModel: ChatModel = null;
    message: ChatMessage = null;
    pending: ChatInterrupt[] = [];
    now: number = Date.now();

    /** The pending interrupts the panel asks - all but approvals, which show on their calls. */
    get questions(): ChatInterrupt[] {
        return this.pending.filter(it => !isCardApproval(it, this.message));
    }

    get current(): ChatInterrupt {
        const {questions} = this;
        return questions.find(it => it.id === this.currentId) ?? questions[0];
    }

    isExpired(interrupt: ChatInterrupt): boolean {
        return isInterruptExpired(interrupt, new Date(this.now));
    }

    update(chatModel: ChatModel, message: ChatMessage, pending: ChatInterrupt[], now: number) {
        this.chatModel = chatModel;
        this.message = message;
        this.pending = pending;
        this.now = now;
    }

    @action
    show(interrupt: ChatInterrupt) {
        this.currentId = interrupt.id;
        this.isReviewing = false;
        this.problem = null;
        const answered =
            interrupt.response?.status === 'resolved' ? interrupt.response.payload : null;
        this.text = isString(answered) ? answered : '';
        this.choice = isString(answered) ? answered : null;
    }

    /** Record a response - null to decline - then resume a lone question, or move on. */
    respond(interrupt: ChatInterrupt, payload: unknown) {
        const {chatModel} = this;
        if (payload === null) {
            chatModel.declineInterrupt(interrupt.id);
        } else {
            chatModel.answerInterrupt(interrupt.id, payload);
        }
        if (this.pending.length === 1) {
            chatModel.submitInterruptsAsync().catchDefault();
        } else {
            this.advance();
        }
    }

    /** Show the next question without a response, or the review step. */
    @action
    advance() {
        const {questions, current} = this,
            next = questions.find(
                it =>
                    it !== current &&
                    it.response == null &&
                    !this.isExpired(it) &&
                    questions.indexOf(it) > questions.indexOf(current)
            );
        if (next) {
            this.show(next);
        } else {
            this.isReviewing = true;
        }
    }

    submit() {
        this.chatModel.submitInterruptsAsync().catchDefault();
    }

    /** The form for a question, made once and kept with the panel. */
    getFormModel(interrupt: ChatInterrupt, fields: InterruptField[]): FormModel {
        const key = `${interrupt.runId}:${interrupt.id}`;
        let ret = this.formModels.get(key);
        if (!ret) {
            const answered = interrupt.response?.payload as PlainObject;
            ret = this.markManaged(
                new FormModel({
                    fields: fields.map(field => ({
                        name: field.name,
                        displayName: field.label,
                        initialValue: toInputValue(
                            answered?.[field.name] ?? field.defaultValue,
                            field
                        ),
                        rules: [
                            ...(field.isRequired ? [required] : []),
                            ...(field.min != null || field.max != null
                                ? [numberIs({min: field.min, max: field.max})]
                                : [])
                        ]
                    }))
                })
            );
            this.formModels.set(key, ret);
        }
        return ret;
    }

    async sendFormAsync(interrupt: ChatInterrupt, spec: InterruptAnswerSpec & {kind: 'form'}) {
        const formModel = this.getFormModel(interrupt, spec.fields),
            isValid = await formModel.validateAsync({display: true});
        if (!isValid) return;

        const data = formModel.getData(),
            payload = Object.fromEntries(
                spec.fields
                    .map(field => [field.name, toPayloadValue(data[field.name], field)])
                    .filter(([, value]) => value !== undefined)
            ),
            problems = checkInterruptAnswer(spec, payload);
        this.problem = isEmpty(problems) ? null : problems.join('. ');
        if (!this.problem) this.respond(interrupt, payload);
    }

    private formModels = new Map<string, FormModel>();
}

/** A value from a payload or a default, as its input holds it. */
function toInputValue(value: unknown, field: InterruptField): unknown {
    if (field.type === 'date' && isString(value)) return LocalDate.get(value);
    if (field.type === 'boolean') return value ?? false;
    return value ?? null;
}

/** A value from an input, as the payload sends it - undefined to leave it out. */
function toPayloadValue(value: unknown, field: InterruptField): unknown {
    if (field.type === 'boolean') return !!value;
    if (value instanceof LocalDate) return value.isoString;
    if (isString(value)) return value.trim() || undefined;
    if (isArray(value)) return isEmpty(value) && !field.isRequired ? undefined : value;
    return value ?? undefined;
}
