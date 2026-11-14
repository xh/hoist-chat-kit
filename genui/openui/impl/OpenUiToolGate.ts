import {type PlainObject, XH} from '@xh/hoist/core';
import {logDebug, throwIf} from '@xh/hoist/utils/js';
import {isEmpty, isFunction, isPlainObject, isString} from 'lodash';
import {type ChatModel, type ChatToolSpec, ChatToolResult} from '../../../core';
import {findSchemaProblems, validateSchema} from '../../../impl/SchemaUtils';
import type {OpenUiCallBudget} from './callBudget';

/** A call that an OpenUI Lang program makes to a chat tool, with `Query()` - see `onToolCall`. */
export interface OpenUiToolCall {
    /** Name of the tool. */
    toolName: string;

    /** The arguments, as the program wrote them. They passed the tool's schema. */
    args: PlainObject;

    /** Id of the message that holds the program, or null outside a chat. */
    messageId: string;
}

/** Configuration for an {@link OpenUiToolGate}. */
export interface OpenUiToolGateConfig {
    /** The chat whose client tools the gate runs. */
    chatModel: ChatModel;

    /** Names of the tools the gate may run. It refuses every other tool. */
    tools: string[];

    /** Id of the message that holds the program. */
    messageId: string;

    /** Aborts once the program goes away, for a tool that honors it. */
    signal: AbortSignal;

    /** The calls that all the programs of the chat may start. */
    budget: OpenUiCallBudget;

    /** Most calls that the programs of the chat may start in a minute. */
    maxCallsPerMinute: number;

    /** Called with each call that passed its checks, as it starts. */
    onToolCall?: (call: OpenUiToolCall) => void;
}

/**
 * Decides whether a `Query()` of an OpenUI Lang program may call a chat tool, and runs the call.
 * A program is written by a model, and a query runs with no click. So a call runs only where the
 * app would allow it:
 *
 * - The app must list the tool by name. With none listed, no tool runs.
 * - The tool must be a client tool of the chat, with an `execute`.
 * - The arguments must pass the tool's schema, and that schema must use only keywords the kit
 *   can check.
 * - A query cannot ask the user, so a tool that needs approval for the arguments is refused.
 * - The chat has calls left in its budget for the minute.
 *
 * A call is not part of the history, so the model does not see its result. Arguments reach the
 * tool, and the result reaches the program, as plain JSON with no `__proto__`, `constructor` or
 * `prototype` key. So neither side gets a live object, or a key that could reach a prototype.
 * @internal
 */
export class OpenUiToolGate {
    private readonly config: OpenUiToolGateConfig;

    constructor(config: OpenUiToolGateConfig) {
        this.config = config;
    }

    /**
     * Check a call, and run it.
     *
     * @returns the result of the tool, as plain JSON.
     * @throws if the call may not run.
     */
    async callAsync(toolName: string, args: unknown): Promise<unknown> {
        const {chatModel, tools, messageId, signal, budget, maxCallsPerMinute, onToolCall} =
            this.config;
        throwIf(
            !isString(toolName) || !tools.includes(toolName),
            `Query cannot run '${toolName}'. ` +
                (isEmpty(tools) ? 'No tools are allowed.' : `Allowed tools: ${tools.join(', ')}.`)
        );

        const tool = chatModel.getToolSpec(toolName),
            json = toJson(args),
            input: PlainObject = isPlainObject(json) ? (json as PlainObject) : {};
        throwIf(!tool?.execute, `No client tool named '${toolName}'.`);

        // The check must cover the whole schema, or invalid input would reach the tool.
        const schemaProblems = tool.parameters ? findSchemaProblems(tool.parameters) : [];
        throwIf(
            !isEmpty(schemaProblems),
            `Tool '${toolName}' cannot run from a Query: its schema uses keywords the kit ` +
                `cannot check - ${schemaProblems.join('; ')}.`
        );
        const inputErrors = tool.parameters ? validateSchema(input, tool.parameters) : [];
        throwIf(
            !isEmpty(inputErrors),
            `Invalid input for tool '${toolName}': ${inputErrors.join('; ')}`
        );
        throwIf(
            needsApproval(tool, input),
            `Tool '${toolName}' needs approval, so a Query cannot run it.`
        );
        throwIf(
            !budget.take(maxCallsPerMinute),
            `Query did not run '${toolName}': the programs of this chat may start at most ` +
                `${maxCallsPerMinute} calls a minute.`
        );

        logDebug([`Query runs the tool '${toolName}'`, input], 'OpenUiToolGate');
        onToolCall?.({toolName, args: input, messageId});
        const result = await tool.execute(input, {chatModel, toolCallId: XH.genId(), signal});
        return toData(result, toolName);
    }
}

/**
 * A value as plain JSON, with no key that names a prototype. Null for a value that JSON cannot
 * hold, such as a function.
 * @internal
 */
export function toJson(value: unknown): unknown {
    try {
        return JSON.parse(JSON.stringify(value) ?? 'null', dropPrototypeKeys) ?? null;
    } catch {
        return null;
    }
}

//------------------
// Implementation
//------------------
const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'prototype'];

function dropPrototypeKeys(key: string, value: unknown): unknown {
    return PROTOTYPE_KEYS.includes(key) ? undefined : value;
}

function needsApproval(tool: ChatToolSpec, input: PlainObject): boolean {
    const {needsApproval} = tool;
    return isFunction(needsApproval) ? !!needsApproval(input) : !!needsApproval;
}

// A tool's result as plain JSON for a program. A tool writes its result for the model, often as
// a string, so JSON in a string is parsed. Any other result goes through JSON, so that a program
// reads data and never a live object.
function toData(result: unknown, toolName: string): unknown {
    const output = result instanceof ChatToolResult ? result.output : result;
    if (output == null) return null;

    if (!isString(output)) {
        try {
            return JSON.parse(JSON.stringify(output), dropPrototypeKeys) ?? null;
        } catch (e) {
            throw new Error(`Tool '${toolName}' returned a result that is not JSON.`, {cause: e});
        }
    }

    const text = output.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return output;
    try {
        return JSON.parse(text, dropPrototypeKeys);
    } catch {
        return output;
    }
}
