import {type PlainObject, XH} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {logDebug, throwIf} from '@xh/hoist/utils/js';
import {isEmpty, isFunction, isPlainObject, isString} from 'lodash';
import {type ChatModel, type ChatToolSpec, ChatToolResult} from '../../../core';
import {findSchemaProblems, validateSchema} from '../../../impl/SchemaUtils';

/** A call that an OpenUI Lang program makes to a chat tool - see `onToolCall`. */
export interface OpenUiToolCall {
    /**
     * How the call starts: `query` for a `Query()`, which runs with no click, or `mutation` for a
     * `Mutation()`, which the user starts with a click.
     */
    kind: 'query' | 'mutation';

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

    kind: OpenUiToolCall['kind'];

    /** Id of the message that holds the program. */
    messageId: string;

    /** Aborts once the program goes away, for a tool that honors it. */
    signal: AbortSignal;

    /** Called with each call that passed its checks, as it starts. */
    onToolCall?: (call: OpenUiToolCall) => void;
}

/**
 * Decides whether an OpenUI Lang program may call a chat tool, and runs the call. A program is
 * written by a model, so a call runs only where the app and the user would allow it:
 *
 * - The app must list the tool by name. With none listed, no tool runs.
 * - The tool must be a client tool of the chat, with an `execute`.
 * - The arguments must pass the tool's schema, and that schema must use only keywords the kit
 *   can check.
 * - A query runs with no click, so it cannot ask the user. A tool that needs approval for the
 *   arguments is refused.
 * - A mutation follows a click. A tool that needs approval asks the user first, with its own
 *   prompt, or with one that names the tool and shows the arguments. A mutation is refused while
 *   the chat is busy.
 *
 * A call is not part of the history, so the model does not see its result. The result reaches the
 * program as plain JSON, so a tool that returns a live object does not expose it.
 * @internal
 */
export class OpenUiToolGate {
    private readonly config: OpenUiToolGateConfig;

    constructor(config: OpenUiToolGateConfig) {
        this.config = config;
    }

    /**
     * Check a call, and for a mutation ask for any approval its tool needs.
     *
     * @returns a function that runs the call, and resolves to its result as plain JSON.
     * @throws if the call may not run, or the user does not approve it.
     */
    async prepareAsync(toolName: string, args: unknown): Promise<() => Promise<unknown>> {
        const {chatModel, tools, kind, messageId, signal, onToolCall} = this.config,
            label = kind === 'query' ? 'Query' : 'Mutation';
        throwIf(
            !isString(toolName) || !tools.includes(toolName),
            `${label} cannot run '${toolName}'. ` +
                (isEmpty(tools) ? 'No tools are allowed.' : `Allowed tools: ${tools.join(', ')}.`)
        );

        // The arguments as plain JSON, so that a tool gets data and never a live object that
        // an expression reached, such as a function.
        const tool = chatModel.getToolSpec(toolName),
            json = toJson(args),
            input: PlainObject = isPlainObject(json) ? (json as PlainObject) : {};
        throwIf(!tool?.execute, `No client tool named '${toolName}'.`);

        // The check must cover the whole schema, or invalid input would reach the tool.
        const schemaProblems = tool.parameters ? findSchemaProblems(tool.parameters) : [];
        throwIf(
            !isEmpty(schemaProblems),
            `Tool '${toolName}' cannot run from a ${label}: its schema uses keywords the ` +
                `kit cannot check - ${schemaProblems.join('; ')}.`
        );
        const inputErrors = tool.parameters ? validateSchema(input, tool.parameters) : [];
        throwIf(
            !isEmpty(inputErrors),
            `Invalid input for tool '${toolName}': ${inputErrors.join('; ')}`
        );
        this.checkNotBusy();

        if (needsApproval(tool, input)) {
            throwIf(
                kind === 'query',
                `Tool '${toolName}' needs approval, so a Query cannot run it.`
            );
            throwIf(!(await confirmAsync(tool, input)), `'${toolName}' was not approved.`);
        }

        return async () => {
            this.checkNotBusy();
            logDebug([`${label} runs the tool '${toolName}'`, input], 'OpenUiToolGate');
            onToolCall?.({kind, toolName, args: input, messageId});
            const result = await tool.execute(input, {chatModel, toolCallId: XH.genId(), signal});
            return toData(result, toolName);
        };
    }

    //------------------
    // Implementation
    //------------------
    // A mutation writes, as a `callTool` action does, so it waits for the reply to end.
    private checkNotBusy() {
        const {chatModel, kind} = this.config;
        throwIf(kind === 'mutation' && chatModel.isBusy, 'Wait for the reply to finish.');
    }
}

//------------------
// Implementation
//------------------
function needsApproval(tool: ChatToolSpec, input: PlainObject): boolean {
    const {needsApproval} = tool;
    return isFunction(needsApproval) ? !!needsApproval(input) : !!needsApproval;
}

// Ask the user to approve a call. A tool with no prompt of its own gets one that names the tool
// and shows every argument, so that the user approves what will run.
async function confirmAsync(tool: ChatToolSpec, input: PlainObject): Promise<boolean> {
    const {approvalPrompt, displayName, name} = tool,
        message = isFunction(approvalPrompt) ? approvalPrompt(input) : approvalPrompt;
    return XH.confirm({
        title: displayName ?? genDisplayName(name),
        message: message ?? `Run the tool '${name}' with ${JSON.stringify(input)}?`
    });
}

function toJson(value: unknown): unknown {
    try {
        return JSON.parse(JSON.stringify(value) ?? 'null');
    } catch {
        return null;
    }
}

// A tool's result as plain JSON for a program. A tool writes its result for the model, often as
// a string, so JSON in a string is parsed. Any other result goes through JSON, so that a program
// reads data and never a live object.
function toData(result: unknown, toolName: string): unknown {
    const output = result instanceof ChatToolResult ? result.output : result;
    if (output == null) return null;

    if (!isString(output)) {
        try {
            return JSON.parse(JSON.stringify(output)) ?? null;
        } catch (e) {
            throw new Error(`Tool '${toolName}' returned a result that is not JSON.`, {cause: e});
        }
    }

    const text = output.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return output;
    try {
        return JSON.parse(text);
    } catch {
        return output;
    }
}
