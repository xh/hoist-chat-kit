import {dropRight, isFinite, isPlainObject} from 'lodash';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import type {ChatModel} from '../../../core';
import {
    type ChatUiAction,
    type ChatUiActionType,
    chatUiActionSchema,
    type ChatUiComponentSpec,
    describeChatUiAction
} from '../../../genui';
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

/** Props of a {@link ChatUiCard}, as written by the model. */
export interface ChatUiCardSpecProps {
    /** Title of the card - the name of the record it shows. */
    title: string;

    /** A line under the title, such as the record's type or status. */
    subtitle?: string;

    /** Labeled values, in display order. */
    fields: ChatUiCardField[];

    /** Follow-up actions, shown as buttons, each with a `label`. */
    actions?: ChatUiAction[];
}

/** Options for {@link chatUiCardSpec}. */
export interface ChatUiCardSpecOptions extends ChatUiSpecOptions {
    /** Most fields the model may send. Default 16. */
    maxFields?: number;

    /** Most actions the model may send. Default 4. */
    maxActions?: number;

    /**
     * The kinds of action the model may put on the card. Default `['send']`: buttons that send a
     * follow-up message. Add `openUrl`, `navigate`, `callTool` or `app` to allow those - see
     * {@link ChatUiAction}.
     */
    actionTypes?: ChatUiActionType[];
}

/**
 * A card component for a {@link ChatUiCatalog}: the details of one record, as labeled values
 * under a title, with optional follow-up actions. Each action is a typed {@link ChatUiAction},
 * run through the catalog - by default a `send` action, whose text goes as the user's next
 * message, so the model can offer the obvious next steps.
 *
 * The model writes the actions, so the user sees exactly what each one does: the button's tooltip
 * describes it, and a sent message shows as the user's own in the chat. Sent text is short - at
 * most 200 characters - so that the tooltip shows all of it, and a prompt injection cannot hide a
 * long instruction behind a harmless label.
 *
 * The model's tool is `show_card`, unless renamed with `name`.
 */
export function chatUiCardSpec(
    opts: ChatUiCardSpecOptions = {}
): ChatUiComponentSpec<ChatUiCardSpecProps> {
    const {
        name = 'card',
        description = DESCRIPTION,
        maxFields = 16,
        maxActions = 4,
        actionTypes = ['send']
    } = opts;

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
                    description: 'Follow-up actions, as buttons.',
                    items: chatUiActionSchema({types: actionTypes, requireLabel: true})
                }
            }
        },
        render: (props, {chatModel, isPartial, runActionAsync}) =>
            chatUiCard({...props, chatModel, isPartial, runActionAsync}),
        example: {
            title: 'Acme Corp',
            subtitle: 'Counterparty - Tier 1',
            fields: [
                {label: 'Exposure', value: 4200000, format: 'currency', decimals: 0},
                {label: 'Rating', value: 'A+'}
            ],
            actions: [
                {type: 'send', label: 'Show trades', text: 'Show my open trades with Acme Corp.'}
            ]
        }
    };
}

/** Props for {@link ChatUiCard}. */
export interface ChatUiCardProps extends HoistProps, Partial<ChatUiCardSpecProps> {
    /** The chat that shows the card. Actions that message it are disabled while it is busy. */
    chatModel: ChatModel;

    /** Runs an action when its button is clicked - the catalog's `context.runActionAsync`. */
    runActionAsync: (action: ChatUiAction) => Promise<unknown>;

    /** True while the props stream. Actions are disabled until the card is complete. */
    isPartial?: boolean;
}

/**
 * A detail card of labeled values, with follow-up actions - the component that
 * {@link chatUiCardSpec} renders. Actions that send a message or run a tool are disabled while
 * the chat is busy.
 */
export const [ChatUiCard, chatUiCard] = hoistCmp.withFactory<ChatUiCardProps>({
    displayName: 'ChatUiCard',
    model: false,
    className: 'xh-chat-ui-card',

    render({className, title, subtitle, fields, actions, chatModel, isPartial, runActionAsync}) {
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
                          items: validActions.map((action, idx) =>
                              button({
                                  key: idx,
                                  text: action.label,
                                  tooltip: describeChatUiAction(action),
                                  outlined: true,
                                  disabled: chatModel.isBusy && MESSAGING_ACTIONS.has(action.type),
                                  onClick: () => runActionAsync(action).catchDefault()
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
// Actions that message the chat, and so wait while it is busy.
const MESSAGING_ACTIONS: ReadonlySet<ChatUiActionType> = new Set(['send', 'callTool']);

const DESCRIPTION =
    'A detail card for one record - a client, an order, a counterparty - with its key fields ' +
    'as labeled values, and up to a few follow-up actions, shown as buttons, for the obvious ' +
    'next steps.';
