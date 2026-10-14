import type {Awaitable, PlainObject} from '@xh/hoist/core';
import type {ChatPartRenderContext} from '../core';

/** The kinds of {@link ChatUiAction}. */
export type ChatUiActionType = 'send' | 'openUrl' | 'navigate' | 'callTool' | 'app';

/** A question the user answers before an action runs - see {@link ChatUiActionBase.confirm}. */
export interface ChatUiActionConfirm {
    /** Title of the dialog. */
    title?: string;

    /** The question, in plain text. */
    message: string;
}

/** Properties shared by every {@link ChatUiAction}. */
export interface ChatUiActionBase {
    /** Text for the button or link that runs the action. */
    label?: string;

    /** A question the user must confirm before the action runs. */
    confirm?: ChatUiActionConfirm;
}

/**
 * Send a message as the user. The text shows in the chat as the user's own. Structured `context`
 * goes on the message's `metadata.context`, never in its text.
 */
export interface ChatUiSendAction extends ChatUiActionBase {
    type: 'send';
    text: string;
    context?: PlainObject;
}

/** Open a URL in a new tab - only if the catalog's `urlAllowList` allows it. */
export interface ChatUiOpenUrlAction extends ChatUiActionBase {
    type: 'openUrl';
    url: string;
}

/** Route the app, with `XH.navigate()`. */
export interface ChatUiNavigateAction extends ChatUiActionBase {
    type: 'navigate';
    route: string;
    params?: PlainObject;
}

/** Run a client tool of the chat, with input checked against the tool's schema. */
export interface ChatUiCallToolAction extends ChatUiActionBase {
    type: 'callTool';
    name: string;
    input?: PlainObject;
}

/** Run an app action, by name, through the catalog's `actionHandlers`. */
export interface ChatUiAppAction extends ChatUiActionBase {
    type: 'app';
    name: string;
    params?: PlainObject;
}

/**
 * Something a generative UI component does when the user clicks it - a typed action, from a
 * closed set, that the model writes in a component's props. Components run actions with
 * `context.runActionAsync()`, which checks each one before it runs. All payloads are untrusted.
 */
export type ChatUiAction =
    | ChatUiSendAction
    | ChatUiOpenUrlAction
    | ChatUiNavigateAction
    | ChatUiCallToolAction
    | ChatUiAppAction;

/**
 * Runs an app action - see {@link ChatUiCatalogConfig.actionHandlers}. The params are untrusted:
 * check them before use.
 */
export type ChatUiActionHandler = (
    params: PlainObject,
    context: ChatPartRenderContext
) => Awaitable<unknown>;

/** Options for {@link chatUiActionSchema}. */
export interface ChatUiActionSchemaOptions {
    /** The kinds of action allowed. Default all. */
    types?: ChatUiActionType[];

    /** True to require a `label`, as for a button. Default false. */
    requireLabel?: boolean;
}

/** Most characters in the text of a `send` action, so the user can read all of it. */
export const CHAT_UI_MAX_SEND_LENGTH = 200;

/**
 * A JSON Schema for a {@link ChatUiAction}, for the props of a component that takes actions.
 *
 * ```ts
 * properties: {
 *     actions: {type: 'array', maxItems: 4, items: chatUiActionSchema({types: ['send', 'navigate'], requireLabel: true})}
 * }
 * ```
 */
export function chatUiActionSchema(opts: ChatUiActionSchemaOptions = {}): PlainObject {
    const {types = ACTION_TYPES, requireLabel = false} = opts,
        branches = types.map(type => {
            const {required, properties} = ACTION_FIELDS[type];
            return {
                type: 'object',
                required: ['type', ...(requireLabel ? ['label'] : []), ...required],
                additionalProperties: false,
                properties: {type: {const: type}, ...properties, ...BASE_PROPERTIES}
            };
        });
    return branches.length === 1 ? branches[0] : {anyOf: branches};
}

/**
 * What an action does, in plain words for the user - for a tooltip that shows exactly what a
 * click will do, such as `Sends: "Show my open trades."` or `Opens https://example.com/report`.
 */
export function describeChatUiAction(action: ChatUiAction): string {
    switch (action.type) {
        case 'send':
            return `Sends: "${action.text}"`;
        case 'openUrl':
            return `Opens ${action.url}`;
        case 'navigate':
            return `Goes to ${action.route}`;
        case 'callTool':
            return `Runs the tool ${action.name}`;
        case 'app':
            return `Runs ${action.name}`;
    }
}

//------------------
// Implementation
//------------------
const ACTION_TYPES: ChatUiActionType[] = ['send', 'openUrl', 'navigate', 'callTool', 'app'];

const BASE_PROPERTIES: PlainObject = {
    label: {type: 'string', maxLength: 40, description: 'Text for the button.'},
    confirm: {
        type: 'object',
        required: ['message'],
        additionalProperties: false,
        description: 'A question the user must confirm first.',
        properties: {
            title: {type: 'string', maxLength: 80},
            message: {type: 'string', maxLength: 300}
        }
    }
};

const NAME_SCHEMA = {type: 'string', maxLength: 100},
    PARAMS_SCHEMA = {type: 'object', description: 'Named parameters, as a flat object.'};

const ACTION_FIELDS: Record<ChatUiActionType, {required: string[]; properties: PlainObject}> = {
    send: {
        required: ['text'],
        properties: {
            text: {
                type: 'string',
                maxLength: CHAT_UI_MAX_SEND_LENGTH,
                description:
                    "The user's next message, written as the user would say it. The user sees " +
                    'it before and after the click.'
            },
            context: {
                type: 'object',
                description: 'Structured data sent with the message, such as record ids.'
            }
        }
    },
    openUrl: {
        required: ['url'],
        properties: {url: {type: 'string', maxLength: 2000, pattern: '^https?://'}}
    },
    navigate: {
        required: ['route'],
        properties: {route: NAME_SCHEMA, params: PARAMS_SCHEMA}
    },
    callTool: {
        required: ['name'],
        properties: {name: NAME_SCHEMA, input: {type: 'object'}}
    },
    app: {
        required: ['name'],
        properties: {name: NAME_SCHEMA, params: PARAMS_SCHEMA}
    }
};
