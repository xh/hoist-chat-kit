import type {ToolProvider} from '@openuidev/lang-core';
import {type PlainObject, XH} from '@xh/hoist/core';
import {genDisplayName} from '@xh/hoist/data';
import {throwIf} from '@xh/hoist/utils/js';
import {isEmpty, isFunction, isPlainObject, isString} from 'lodash';
import {type ChatModel, type ChatToolSpec, ChatToolResult} from '../../../core';
import {findSchemaProblems, validateSchema} from '../../../impl/SchemaUtils';

/** Options for {@link createOpenUiToolProvider}. */
export interface OpenUiToolProviderOptions {
    /** The chat whose client tools the provider runs. */
    chatModel: ChatModel;

    /** Names of the tools the provider may run. It refuses every other tool. */
    tools: string[];

    /**
     * How a call starts: `query` for a `Query()`, which runs with no click, or `mutation` for a
     * `Mutation()`, which the user starts with a click.
     */
    kind: 'query' | 'mutation';

    /** Aborts once the program goes away, for a tool that honors it. */
    signal: AbortSignal;
}

/**
 * Runs the tools of an OpenUI Lang program, as lang-core's query manager asks for them. A program
 * is written by a model, so a call runs only where the app and the user would allow it:
 *
 * - The app must list the tool by name. With none listed, no tool runs.
 * - The tool must be a client tool of the chat, with an `execute`.
 * - The arguments must pass the tool's schema, and that schema must use only keywords the kit
 *   can check.
 * - A query runs with no click, so it cannot ask the user. A tool that needs approval for the
 *   arguments is refused.
 * - A mutation follows a click. A tool that needs approval asks the user first, with its own
 *   prompt, and a mutation waits while the chat is busy.
 *
 * A call is not part of the history, so the model does not see its result.
 * @internal
 */
export function createOpenUiToolProvider(opts: OpenUiToolProviderOptions): ToolProvider {
    const {chatModel, tools, kind, signal} = opts,
        label = kind === 'query' ? 'Query' : 'Mutation';

    return {
        async callTool(toolName, args) {
            throwIf(
                !tools.includes(toolName),
                `${label} cannot run '${toolName}'. ` +
                    (isEmpty(tools)
                        ? 'No tools are allowed.'
                        : `Allowed tools: ${tools.join(', ')}.`)
            );

            const tool = chatModel.getToolSpec(toolName),
                input: PlainObject = isPlainObject(args) ? args : {};
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

            if (needsApproval(tool, input)) {
                throwIf(
                    kind === 'query',
                    `Tool '${toolName}' needs approval, so a Query cannot run it.`
                );
                throwIf(!(await confirmAsync(tool, input)), `'${toolName}' was not approved.`);
            }
            throwIf(kind === 'mutation' && chatModel.isBusy, 'Wait for the reply to finish.');

            const result = await tool.execute(input, {
                chatModel,
                toolCallId: XH.genId(),
                signal
            });
            return toData(result);
        }
    };
}

//------------------
// Implementation
//------------------
function needsApproval(tool: ChatToolSpec, input: PlainObject): boolean {
    const {needsApproval} = tool;
    return isFunction(needsApproval) ? !!needsApproval(input) : !!needsApproval;
}

async function confirmAsync(tool: ChatToolSpec, input: PlainObject): Promise<boolean> {
    const {approvalPrompt, displayName, name} = tool,
        message = isFunction(approvalPrompt) ? approvalPrompt(input) : approvalPrompt;
    return XH.confirm({
        title: displayName ?? genDisplayName(name),
        message: message ?? 'Allow this tool to run?'
    });
}

// A tool's result as data for a program. A tool writes its result for the model, often as a
// string, so JSON in a string is parsed.
function toData(result: unknown): unknown {
    const output = result instanceof ChatToolResult ? result.output : result;
    if (!isString(output)) return output ?? null;

    const text = output.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return output;
    try {
        return JSON.parse(text);
    } catch {
        return output;
    }
}
