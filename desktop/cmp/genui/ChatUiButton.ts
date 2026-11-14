import {hoistCmp, type HoistProps, useContextModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import type {ChatModel} from '../../../core';
import {
    type ChatUiAction,
    type ChatUiActionType,
    chatUiActionSchema,
    type ChatUiComponentSpec,
    describeChatUiAction,
    isChatUiMessagingAction
} from '../../../genui';
import {ChatUiFormModel} from './impl/ChatUiFormModel';
import type {ChatUiIntent, ChatUiSpecOptions} from './Types';
import './ChatUiButton.scss';

/** Props of a {@link ChatUiButton}, as written by the model. */
export interface ChatUiButtonSpecProps {
    /** Text of the button. */
    label: string;

    /** What a click does. Default: sends the label as the user's message. */
    action?: ChatUiAction;

    /** Color of the button. Default none. */
    intent?: Exclude<ChatUiIntent, 'none'>;
}

/** Options for {@link chatUiButtonSpec}. */
export interface ChatUiButtonSpecOptions extends ChatUiSpecOptions {
    /**
     * The kinds of action the model may put on the button. Default `['send', 'state']`: a button
     * that sends a message, or that acts on the state of its document, as an OpenUI `@Set` does.
     * Add `openUrl`, `navigate`, `callTool` or `app` to allow those - see {@link ChatUiAction}.
     */
    actionTypes?: ChatUiActionType[];
}

/**
 * A button for a {@link ChatUiCatalog}, over Hoist's `Button`. A click runs one typed
 * {@link ChatUiAction} through the catalog. With no action, it sends its label as the user's
 * message.
 *
 * The model writes the action, so the tooltip always says what the click does, and a sent
 * message shows as the user's own. Inside the built-in form, a click first validates the fields.
 * A `send` then carries the value of each field in its `context`, by field name, and the tooltip
 * shows them. A `send` holds at most 8 values of at most 100 characters each. A form that holds
 * more cannot send, and its button says why.
 *
 * An action that a format read and had to refuse arrives as a `state` action with a
 * `disabledReason`. The button is then disabled, with the reason as its tooltip. It never falls
 * back to sending its label for an action that was written.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiButtonSpec(
    opts: ChatUiButtonSpecOptions = {}
): ChatUiComponentSpec<ChatUiButtonSpecProps> {
    const {name = 'button', description = DESCRIPTION, actionTypes = ['send', 'state']} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['label'],
            additionalProperties: false,
            properties: {
                label: {type: 'string', maxLength: 40, description: 'Text of the button.'},
                action: chatUiActionSchema({types: actionTypes}),
                intent: {
                    enum: ['primary', 'success', 'warning', 'danger'],
                    description: 'Color. Use "primary" for the main button of a form.'
                }
            }
        },
        standalone: false,
        render: (props, {chatModel, isPartial, runActionAsync}) =>
            chatUiButton({...props, chatModel, isPartial, runActionAsync}),
        result: ({label}) => label ?? '',
        example: {
            label: 'Show trades',
            action: {type: 'send', text: 'Show my open trades with Acme Corp.'}
        }
    };
}

/** Props for {@link ChatUiButton}. */
export interface ChatUiButtonProps extends HoistProps, Partial<ChatUiButtonSpecProps> {
    /**
     * The chat that shows the button. An action that messages it is disabled while it is busy,
     * and hidden where it is null - in a message list over a host that is not a `ChatModel`.
     */
    chatModel: ChatModel;

    /** Runs the action on a click - the catalog's `context.runActionAsync`. */
    runActionAsync: (action: ChatUiAction) => Promise<unknown>;

    /** True while the props stream. The button is disabled until it is complete. */
    isPartial?: boolean;
}

/**
 * A button that runs one action - the component that {@link chatUiButtonSpec} renders, over
 * Hoist's `Button`. Its tooltip always says what the click does, as the label may not. Inside a
 * {@link ChatUiForm}, a click validates the form's fields first, and a `send` carries their
 * values. It keeps the size of its label, in a column and in a row.
 */
export const [ChatUiButton, chatUiButton] = hoistCmp.withFactory<ChatUiButtonProps>({
    displayName: 'ChatUiButton',
    model: false,
    className: 'xh-chat-ui-button',

    render({className, label, action, intent, chatModel, isPartial, runActionAsync}) {
        const formModel = useContextModel(ChatUiFormModel);
        if (!label) return null;

        // An action that was written and cannot run says why, and does nothing else.
        if (action?.type === 'state' && action.disabledReason) {
            return button({
                className,
                text: label,
                intent,
                outlined: true,
                tooltip: action.disabledReason,
                disabled: true
            });
        }

        // The values show in the tooltip as they stand, and go with the click as they then are.
        const base: ChatUiAction = action ?? {type: 'send', text: label},
            withValues = () => formModel?.withValues(base) ?? base,
            shown = withValues(),
            isMessaging = isChatUiMessagingAction(shown);
        if (isMessaging && !chatModel) return null;

        const problem = formModel?.getSendProblem(base) ?? null,
            blockedReason = isMessaging ? chatModel.sendBlockedReason : null,
            submitAsync = async () => {
                if (formModel && !(await formModel.validateAsync())) return;
                await runActionAsync(withValues());
            };

        return button({
            className,
            text: label,
            intent,
            outlined: true,
            tooltip: problem ?? blockedReason ?? describeChatUiAction(shown),
            disabled:
                !!isPartial || !!problem || (isMessaging && (chatModel.isBusy || !!blockedReason)),
            onClick: () => submitAsync().catchDefault()
        });
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A button that runs one action on a click. Inside a form it submits the form: the fields ' +
    'are checked, and a message it sends carries their values. With no action, it sends its ' +
    'label as the next message of the user.';
