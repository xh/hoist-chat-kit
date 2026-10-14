import {dropRight, isFinite, isPlainObject} from 'lodash';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import type {ChatModel} from '../../../core';
import type {ChatUiComponentSpec} from '../../../genui';
import {
    CHAT_UI_DECIMALS_SCHEMA,
    fmtChatUiNumber,
    CHAT_UI_NUMBER_FORMAT_SCHEMA
} from './ChatUiFormat';
import {chatUiFrame} from './ChatUiFrame';
import type {ChatUiSpecOptions, ChatUiNumberFormat} from './Types';
import './ChatUiCard.scss';

/** A labeled value on a {@link ChatUiCard}, as written by the model. */
export interface ChatUiCardField {
    /** What the value is, such as `Owner`. */
    label: string;

    /** The value - a number, formatted with `format`, or text shown as is. */
    value: number | string;

    /** How a numeric value displays. Default `number`. */
    format?: ChatUiNumberFormat;

    /** Decimal places for a numeric value. Default suits the value and the format. */
    decimals?: number;
}

/** A follow-up action on a {@link ChatUiCard}, as written by the model. */
export interface ChatUiCardAction {
    /** Button text, such as `Show trades`. */
    text: string;

    /**
     * Message sent as the user's own when they click the button - shown in its tooltip before the
     * click, and as the user's message after it. At most 200 characters.
     */
    prompt: string;
}

/** Props of a {@link ChatUiCard}, as written by the model. */
export interface ChatUiCardSpecProps {
    /** Title of the card - the name of the record it shows. */
    title: string;

    /** A line under the title, such as the record's type or status. */
    subtitle?: string;

    /** Labeled values, in display order. */
    fields: ChatUiCardField[];

    /** Follow-up actions, shown as buttons that send a message. */
    actions?: ChatUiCardAction[];
}

/** Options for {@link chatUiCardSpec}. */
export interface ChatUiCardSpecOptions extends ChatUiSpecOptions {
    /** Most fields the model may send. Default 16. */
    maxFields?: number;

    /** Most actions the model may send. Default 4. */
    maxActions?: number;
}

/**
 * A card component for a {@link ChatUiCatalog}: the details of one record, as labeled values
 * under a title, with optional follow-up actions. Clicking an action sends its prompt as the
 * user's next message, so the model can offer the obvious next steps.
 *
 * The model writes the prompt, so the user sees exactly what an action sends: the prompt shows in
 * the button's tooltip, and then as the user's own message in the chat. Prompts are short - at
 * most 200 characters - so that the tooltip shows all of one, and a prompt injection cannot hide
 * a long instruction behind a harmless label.
 *
 * The model's tool is `show_card`, unless renamed with `name`.
 */
export function chatUiCardSpec(
    opts: ChatUiCardSpecOptions = {}
): ChatUiComponentSpec<ChatUiCardSpecProps> {
    const {name = 'card', description = DESCRIPTION, maxFields = 16, maxActions = 4} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['title', 'fields'],
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120},
                subtitle: {type: 'string', maxLength: 160},
                fields: {
                    type: 'array',
                    maxItems: maxFields,
                    items: {
                        type: 'object',
                        required: ['label', 'value'],
                        additionalProperties: false,
                        properties: {
                            label: {type: 'string', maxLength: 40},
                            value: {
                                type: ['number', 'string'],
                                description: 'A number, or short text shown as is.'
                            },
                            format: CHAT_UI_NUMBER_FORMAT_SCHEMA,
                            decimals: CHAT_UI_DECIMALS_SCHEMA
                        }
                    }
                },
                actions: {
                    type: 'array',
                    maxItems: maxActions,
                    description:
                        'Follow-up actions, as buttons. Clicking one sends its prompt as the ' +
                        "user's next message.",
                    items: {
                        type: 'object',
                        required: ['text', 'prompt'],
                        additionalProperties: false,
                        properties: {
                            text: {type: 'string', maxLength: 40},
                            prompt: {
                                type: 'string',
                                maxLength: MAX_PROMPT_LENGTH,
                                description:
                                    "The user's next message, written as the user would say " +
                                    'it. The user sees it before and after the click.'
                            }
                        }
                    }
                }
            }
        },
        render: (props, {chatModel, isPartial}) => chatUiCard({...props, chatModel, isPartial}),
        example: {
            title: 'Acme Corp',
            subtitle: 'Counterparty - Tier 1',
            fields: [
                {label: 'Exposure', value: 4200000, format: 'currency', decimals: 0},
                {label: 'Rating', value: 'A+'}
            ],
            actions: [{text: 'Show trades', prompt: 'Show my open trades with Acme Corp.'}]
        }
    };
}

/** Props for {@link ChatUiCard}. */
export interface ChatUiCardProps extends HoistProps, Partial<ChatUiCardSpecProps> {
    /** The chat that shows the card - its actions send their prompts here. */
    chatModel: ChatModel;

    /** True while the props stream. Actions are disabled until the card is complete. */
    isPartial?: boolean;
}

/**
 * A detail card of labeled values, with follow-up actions - the component that
 * {@link chatUiCardSpec} renders. Actions are disabled while the chat is busy.
 */
export const [ChatUiCard, chatUiCard] = hoistCmp.withFactory<ChatUiCardProps>({
    displayName: 'ChatUiCard',
    model: false,
    className: 'xh-chat-ui-card',

    render({className, title, subtitle, fields, actions, chatModel, isPartial}) {
        // While streaming, the last field may be cut short - its value still being written.
        const validFields = (isPartial ? dropRight(fields) : (fields ?? [])).filter(isPlainObject),
            validActions = isPartial ? [] : (actions ?? []).filter(isPlainObject);

        return chatUiFrame({
            className,
            items: [
                div({
                    className: 'xh-chat-ui-card__header',
                    items: [
                        div({className: 'xh-chat-ui-card__title', item: title}),
                        subtitle
                            ? div({className: 'xh-chat-ui-card__subtitle', item: subtitle})
                            : null
                    ]
                }),
                validFields.length
                    ? div({
                          className: 'xh-chat-ui-card__fields',
                          items: validFields.map(({label, value, format, decimals}, idx) =>
                              div({
                                  key: idx,
                                  className: 'xh-chat-ui-card__field',
                                  items: [
                                      div({className: 'xh-chat-ui-card__label', item: label}),
                                      div({
                                          className: 'xh-chat-ui-card__value',
                                          item: isFinite(value)
                                              ? fmtChatUiNumber(value as number, format, decimals)
                                              : value
                                      })
                                  ]
                              })
                          )
                      })
                    : null,
                validActions.length
                    ? div({
                          className: 'xh-chat-ui-card__actions',
                          items: validActions.map(({text, prompt}, idx) =>
                              button({
                                  key: idx,
                                  text,
                                  tooltip: `Sends: "${prompt}"`,
                                  outlined: true,
                                  disabled: chatModel.isBusy,
                                  onClick: () => chatModel.sendAsync(prompt).catchDefault()
                              })
                          )
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
const MAX_PROMPT_LENGTH = 200;

const DESCRIPTION =
    'A detail card for one record - a client, an order, a counterparty - with its key fields ' +
    'as labeled values, and up to a few follow-up actions. Each action is a button that sends ' +
    'a prompt as the next user message, for the obvious next steps.';
