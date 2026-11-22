import {card} from '@xh/hoist/cmp/card';
import {div, span} from '@xh/hoist/cmp/layout';
import {propertyTable} from '@xh/hoist/cmp/propertytable';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {dropRight, isEmpty, isPlainObject, isString} from 'lodash';
import type {ReactNode} from 'react';
import type {ChatModel} from '../../../core';
import {
    type ChatUiAction,
    type ChatUiActionType,
    chatUiActionSchema,
    type ChatUiComponentSpec,
    describeChatUiAction,
    isChatUiMessagingAction
} from '../../../genui';
import {CHAT_UI_DECIMALS_SCHEMA, CHAT_UI_NUMBER_FORMAT_SCHEMA} from './ChatUiFormat';
import {chatUiSkeleton} from './ChatUiFrame';
import {toPropertyTableEntry} from './impl/ChatUiPropertyEntries';
import type {ChatUiSpecOptions, ChatUiNumberFormat} from './Types';
import '../../../styles/vars.scss';
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
        kitComponent: 'card',
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
    /**
     * The chat that shows the card. Actions that message it are disabled while it is busy, and
     * hidden where it is null - in a message list over a host that is not a `ChatModel`.
     */
    chatModel: ChatModel;

    /** Runs an action when its button is clicked - the catalog's `context.runActionAsync`. */
    runActionAsync: (action: ChatUiAction) => Promise<unknown>;

    /** True while the props stream. Actions are disabled until the card is complete. */
    isPartial?: boolean;
}

/**
 * A detail card of labeled values, with follow-up actions - the component that
 * {@link chatUiCardSpec} renders. It is a Hoist `Card` that holds a `PropertyTable`. The title
 * and a muted subtitle sit in the card's header. The actions sit in a row at the foot of the card,
 * as outlined chips. A long chip is cut to one line. Its tooltip always shows what the click does,
 * as the label may not. Actions that send a message or run a tool are disabled while the chat is
 * busy, and hidden with no `ChatModel`.
 */
export const [ChatUiCard, chatUiCard] = hoistCmp.withFactory<ChatUiCardProps>({
    displayName: 'ChatUiCard',
    model: false,
    className: 'xh-chat-ui-card',

    render({className, title, subtitle, fields, actions, chatModel, isPartial, runActionAsync}) {
        // While streaming, the last field may be cut short - its value still being written.
        const entries = (isPartial ? dropRight(fields) : (fields ?? [])).flatMap(
                toPropertyTableEntry
            ),
            validActions = isPartial
                ? []
                : (actions ?? []).filter(
                      it => isPlainObject(it) && (chatModel || !isChatUiMessagingAction(it))
                  );

        // A card still being written holds its place until its first field is complete.
        let body: ReactNode = null;
        if (!isEmpty(entries)) {
            body = propertyTable({entries});
        } else if (isPartial) {
            body = chatUiSkeleton(SKELETON_HEIGHT);
        }

        return card({
            className,
            title: cardTitle(title, subtitle),
            children: [
                body,
                validActions.length
                    ? div({
                          className: 'xh-chat-ui-card__actions',
                          children: validActions.map((action, idx) => {
                              // A blocked chat ignores a send, so say why the button waits.
                              const isMessaging = isChatUiMessagingAction(action),
                                  blockedReason = isMessaging ? chatModel.sendBlockedReason : null;
                              return button({
                                  key: idx,
                                  className: 'xh-chat-ui-card__action',
                                  text: action.label,
                                  // The label may differ from what the click does, so the
                                  // tooltip always says it - never the label alone.
                                  tooltip: blockedReason ?? describeChatUiAction(action),
                                  outlined: true,
                                  disabled: isMessaging && (chatModel.isBusy || !!blockedReason),
                                  onClick: () => runActionAsync(action).catchDefault()
                              });
                          })
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
const SKELETON_HEIGHT = 48;

const DESCRIPTION =
    'A detail card for one record - a client, an order, a counterparty - with its key fields ' +
    'as labeled values, and up to a few follow-up actions, shown as buttons, for the obvious ' +
    'next steps.';

// The title of the card, with the subtitle after it in a muted tone. Hoist's `Card` takes one
// title, and lays out the parts of a title node in a row.
function cardTitle(title: string, subtitle: string): ReactNode {
    const hasTitle = isString(title) && !!title,
        hasSubtitle = isString(subtitle) && !!subtitle.trim();
    if (!hasTitle && !hasSubtitle) return null;
    return [
        hasTitle
            ? span({key: 'title', className: 'xh-chat-ui-card__title', children: title})
            : null,
        hasSubtitle
            ? span({key: 'subtitle', className: 'xh-chat-ui-card__subtitle', children: subtitle})
            : null
    ];
}
