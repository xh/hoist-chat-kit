import type {PlainObject} from '@xh/hoist/core';
import type {ActionPlan, ASTNode} from '@openuidev/lang-core';
import {
    compact,
    fromPairs,
    isArray,
    isBoolean,
    isEmpty,
    isFinite,
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
import {hasWhitespaceRun} from '../impl/displayText';
import {OPEN_URL_TARGET, SEND_TARGET, STATE_NAME_RE} from './impl/actionSyntax';
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
 * A message with a long run of whitespace gives no action, as the run could push the rest of the
 * message out of a tooltip.
 *
 * @param opts - set `warn` to false to log no warning for the steps the kit drops.
 * @returns the action, or null for an expression the kit cannot run - such as `@Set`, `@Reset` or
 *      `@Run`, which act on OpenUI state and queries.
 */
export function openUiToAction(
    node: ASTNode,
    library: OpenUiLibrary,
    opts: {warn?: boolean} = {}
): ChatUiAction {
    if (!isPlainObject(node) || node.k !== 'Comp') return null;

    const {name, args = [], mappedProps = {}} = node,
        arg = (key: string, idx: number) => toValue(getOwn(mappedProps, key) ?? args[idx]);
    switch (name) {
        case 'Action':
            return fromSteps(args[0], library, opts.warn !== false);
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
 * One step of an action in a program with state, as lang-core leaves it once
 * {@link prepareActions} has made every step lazy. Each holds its value as an expression, for
 * the runtime to evaluate in order.
 * @internal
 */
export type OpenUiStep =
    | {type: 'set'; target: string; valueAST: ASTNode}
    | {type: 'reset'; targets: string[]}
    | {type: 'run'; statementId: string; refType: 'query' | 'mutation'}
    | {type: 'send'; valueAST: ASTNode}
    | {type: 'openUrl'; valueAST: ASTNode}
    | {type: 'refused'};

/**
 * Read the steps of an action that lang-core evaluated. A `@Set` on a reserved target is the
 * `@ToAssistant` or the `@OpenUrl` that {@link prepareActions} rewrote. Any step of another
 * shape is refused: the kit takes a step only from action syntax, never from data.
 * @internal
 */
export function toOpenUiSteps(plan: ActionPlan): OpenUiStep[] {
    return plan.steps.map((step): OpenUiStep => {
        switch (step?.type) {
            case 'set': {
                const {target, valueAST} = step;
                if (!isPlainObject(valueAST)) return REFUSED;
                if (target === SEND_TARGET) return {type: 'send', valueAST};
                if (target === OPEN_URL_TARGET) return {type: 'openUrl', valueAST};
                return isStateName(target) ? {type: 'set', target, valueAST} : REFUSED;
            }
            case 'reset': {
                const {targets} = step;
                return isArray(targets) && !isEmpty(targets) && targets.every(isStateName)
                    ? {type: 'reset', targets}
                    : REFUSED;
            }
            case 'run': {
                const {statementId, refType} = step;
                return isString(statementId) && ['query', 'mutation'].includes(refType)
                    ? {type: 'run', statementId, refType}
                    : REFUSED;
            }
            default:
                return REFUSED;
        }
    });
}

/**
 * A `send` action for a message and a context that an expression gave, within the caps of a
 * send - see {@link openUiToAction}. Null for a message that is not text, or for text or a
 * context with a long run of whitespace, which could push the rest out of a tooltip.
 * @internal
 */
export function toSendAction(text: unknown, contextValue: unknown): ChatUiAction {
    const context = toContext(contextValue);
    if (!isString(text) || !text) return null;
    if (hasWhitespaceRun(text) || hasWhitespaceRun(context)) return null;
    return {
        type: 'send',
        text: text.slice(0, CHAT_UI_MAX_SEND_LENGTH),
        ...(context ? {context} : {})
    };
}

/** An `openUrl` action for a url that an expression gave, or null. @internal */
export function toOpenUrlAction(url: unknown): ChatUiAction {
    return isString(url) && url ? {type: 'openUrl', url} : null;
}

//------------------
// Implementation
//------------------
const REFUSED: OpenUiStep = {type: 'refused'};

function isStateName(name: unknown): name is string {
    return isString(name) && STATE_NAME_RE.test(name);
}

function fromSteps(list: ASTNode, library: OpenUiLibrary, warn: boolean): ChatUiAction {
    const steps = list?.k === 'Arr' ? list.els : [],
        actions = compact(steps.map(it => openUiToAction(it, library, {warn})));
    if (actions.length <= 1) return actions[0] ?? null;

    const ret = actions.find(it => it.type === 'send') ?? actions[0],
        message = [
            `An OpenUI Action list holds ${actions.length} steps, and the kit runs one.`,
            `Kept: ${describeChatUiAction(ret)}.`,
            `Dropped: ${without(actions, ret).map(describeChatUiAction).join('; ')}.`
        ];
    if (warn) warnOnce(message.join(' '), message, 'OpenUiActions');
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

    // An entry with no value, such as a field that an expression did not find, is left out.
    const entries = (isPlainObject(value) ? Object.entries(value) : [['value', value]])
        .map(([key, it]): [string, string | number | boolean] => [key, toContextValue(it)])
        .filter(([, it]) => it != null);
    return isEmpty(entries) ? null : fromPairs(take(entries, CHAT_UI_MAX_CONTEXT_ENTRIES));
}

// A value of a context: a number or a boolean as it is, text cut to the cap, and any other
// value as its JSON, cut to the cap. Null for a value that JSON cannot hold, such as undefined,
// a function or a number that is not finite.
function toContextValue(value: unknown): string | number | boolean {
    if (isBoolean(value)) return value;
    if (isNumber(value)) return isFinite(value) ? value : null;
    let text: string;
    try {
        text = isString(value) ? value : JSON.stringify(value);
    } catch {
        return null;
    }
    return isString(text) ? text.slice(0, CHAT_UI_MAX_CONTEXT_VALUE_LENGTH) : null;
}
