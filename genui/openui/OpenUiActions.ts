import type {PlainObject} from '@xh/hoist/core';
import type {ActionPlan, ASTNode} from '@openuidev/lang-core';
import {
    castArray,
    compact,
    fromPairs,
    isBoolean,
    isEmpty,
    isNumber,
    isPlainObject,
    isString,
    mapValues,
    take,
    without
} from 'lodash';
import {getOwn} from '../../impl/LangUtils';
import {
    CHAT_UI_MAX_CONTEXT_ENTRIES,
    CHAT_UI_MAX_CONTEXT_VALUE_LENGTH,
    CHAT_UI_MAX_SEND_LENGTH,
    describeChatUiAction,
    type ChatUiAction
} from '../ChatUiAction';
import {warnOnce} from './impl/warnOnce';
import type {OpenUiLibrary} from './OpenUiLibrary';

/**
 * Turn an OpenUI action expression into a {@link ChatUiAction}, which the catalog checks before it
 * runs:
 *
 * - `@ToAssistant(message, context)` becomes `send`. The text is cut to 200 characters. The
 *   context becomes a flat object of at most 8 entries: a string, number or boolean value stays,
 *   with a string cut to 100 characters, and any other value becomes its JSON, cut to 100
 *   characters. A context that is not an object becomes `{value: ...}`.
 * - `@OpenUrl(url)` becomes `openUrl`.
 * - A call to an action that `library.schema.actions` declares becomes `app`, with the call's
 *   arguments as its params. {@link toOpenUiLibrary} declares no actions yet, so this applies
 *   only to a library that adds its own `schema.actions`.
 * - `Action([...])` becomes its one step the kit can run. Of several, the first `send` wins, or
 *   else the first step, and the rest are dropped with a warning.
 *
 * This reads an action as lang-core parsed it, for a program that runs with no state. A program
 * with state evaluates its actions first, and reads them with {@link toOpenUiSteps}.
 *
 * @returns the action, or null for an expression the kit cannot run - such as `@Set`, `@Reset` or
 *      `@Run`, which act on OpenUI state and queries.
 */
export function openUiToAction(node: ASTNode, library: OpenUiLibrary): ChatUiAction {
    if (!isPlainObject(node) || node.k !== 'Comp') return null;

    const {name, args = [], mappedProps = {}} = node,
        arg = (key: string, idx: number) => toValue(getOwn(mappedProps, key) ?? args[idx]);
    switch (name) {
        case 'Action':
            return fromSteps(args[0], library);
        case 'ToAssistant':
            return toSendAction(
                arg('message', 0),
                toValue(getOwn(mappedProps, 'context') ?? args[1])
            );
        case 'OpenUrl':
            return toOpenUrlAction(arg('url', 0));
        default:
            return getOwn(library.schema.actions, name)
                ? {type: 'app', name, params: mapValues(mappedProps, toValue)}
                : null;
    }
}

/**
 * One step of an action in a program with state: a change to the state, or a kit action.
 * @internal
 */
export type OpenUiStep =
    | {type: 'set'; target: string; valueAST: ASTNode}
    | {type: 'reset'; targets: string[]}
    | {type: 'run'; statementId: string; refType: 'query' | 'mutation'}
    | {type: 'action'; action: ChatUiAction};

/**
 * Turn an action that lang-core evaluated into steps the kit can run, in order. `@ToAssistant`,
 * `@OpenUrl` and a library action become kit actions, with the same caps as
 * {@link openUiToAction}. `@Set`, `@Reset` and `@Run` become steps on the program's state. A step
 * the kit cannot run is left out.
 * @internal
 */
export function toOpenUiSteps(plan: ActionPlan, library: OpenUiLibrary): OpenUiStep[] {
    return compact(
        plan.steps.map((step): OpenUiStep => {
            switch (step?.type) {
                case 'set':
                    return isString(step.target) && step.valueAST
                        ? {type: 'set', target: step.target, valueAST: step.valueAST}
                        : null;
                case 'reset':
                    return {type: 'reset', targets: castArray(step.targets).filter(isString)};
                case 'run':
                    return isString(step.statementId)
                        ? {type: 'run', statementId: step.statementId, refType: step.refType}
                        : null;
                case 'continue_conversation':
                    return toActionStep(toSendAction(step.message, step.context));
                case 'open_url':
                    return toActionStep(toOpenUrlAction(step.url));
                case 'custom_action':
                    return getOwn(library.schema.actions, step.name)
                        ? {
                              type: 'action',
                              action: {type: 'app', name: step.name, params: step.params}
                          }
                        : null;
                default:
                    return null;
            }
        })
    );
}

//------------------
// Implementation
//------------------
function toActionStep(action: ChatUiAction): OpenUiStep {
    return action ? {type: 'action', action} : null;
}

function toSendAction(text: unknown, contextValue: unknown): ChatUiAction {
    const context = toContext(contextValue);
    if (!isString(text) || !text) return null;
    return {
        type: 'send',
        text: text.slice(0, CHAT_UI_MAX_SEND_LENGTH),
        ...(context ? {context} : {})
    };
}

function toOpenUrlAction(url: unknown): ChatUiAction {
    return isString(url) && url ? {type: 'openUrl', url} : null;
}

function fromSteps(list: ASTNode, library: OpenUiLibrary): ChatUiAction {
    const steps = list?.k === 'Arr' ? list.els : [],
        actions = compact(steps.map(it => openUiToAction(it, library)));
    if (actions.length <= 1) return actions[0] ?? null;

    const ret = actions.find(it => it.type === 'send') ?? actions[0],
        message = [
            `An OpenUI Action list holds ${actions.length} steps, and the kit runs one.`,
            `Kept: ${describeChatUiAction(ret)}.`,
            `Dropped: ${without(actions, ret).map(describeChatUiAction).join('; ')}.`
        ];
    warnOnce(message.join(' '), message, 'OpenUiActions');
    return ret;
}

// A literal as a value - null for an expression, such as a reference, that is not one.
function toValue(node: ASTNode): unknown {
    if (node == null) return null;
    switch (node.k) {
        case 'Str':
        case 'Num':
        case 'Bool':
            return node.v;
        case 'Arr':
            return node.els.map(toValue);
        case 'Obj':
            return fromPairs(node.entries.map(([key, value]) => [key, toValue(value)]));
        default:
            return null;
    }
}

function toContext(value: unknown): PlainObject {
    if (value == null) return null;

    const entries = isPlainObject(value) ? Object.entries(value) : [['value', value]];
    if (isEmpty(entries)) return null;
    return fromPairs(
        take(entries, CHAT_UI_MAX_CONTEXT_ENTRIES).map(([key, it]) => [key, toContextValue(it)])
    );
}

function toContextValue(value: unknown): string | number | boolean {
    if (isNumber(value) || isBoolean(value)) return value;
    const text = isString(value) ? value : JSON.stringify(value);
    return text.slice(0, CHAT_UI_MAX_CONTEXT_VALUE_LENGTH);
}
