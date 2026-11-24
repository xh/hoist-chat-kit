import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep, isArray, isPlainObject, isString, sum} from 'lodash';
import type {ChatContextProvider, ChatMessage, ChatTextPart, ChatToolCallPart} from '../../core';
import type {Blueprint, BlueprintIssue, BlueprintOp} from '../../blueprint';

/** What a turn's record says of the blueprint it ran against, before the turn. */
export interface ArchitectRecordBlueprint {
    id?: string;
    type?: string;
    name?: string;
    version?: number;
}

/** What the Architect was sent with a turn, as {@link ArchitectTurnCapture} keeps it. */
export interface ArchitectTurnContext {
    /** Epoch millis of the turn's first step. */
    capturedAt?: number;
    blueprint?: ArchitectRecordBlueprint;
    mode?: string;
    access?: string;
    /** The `ui_context` payload. */
    uiContext?: PlainObject;
    /** Each context provider's payload, by its name, `ui_context` and `blueprint` included. */
    providers?: Record<string, unknown>;
    /** The blueprint as it stood before the turn, for a harness scenario's host. */
    blueprintBefore?: Blueprint;
}

/** Tokens and cost for a turn, from the app's usage tracking. Every field is optional. */
export interface ArchitectRecordUsage {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    /** In US dollars. */
    cost?: number;
}

/** One tool call of a turn, in order. */
export interface ArchitectRecordToolCall {
    name: string;
    input: PlainObject;
    /** The result, with each long list of data rows, such as a query's, cut to its first rows. */
    result: unknown;
    error: string;
    durationMs: number;
    /** True if a list of rows in the result was cut. */
    truncated: boolean;
    /** The full length of each list cut, by its JSON Pointer in the result, such as `/rows`. */
    totalRows?: Record<string, number>;
}

/** An edit a turn applied, or tried to. */
export interface ArchitectRecordEdit {
    description: string;
    ops: BlueprintOp[];
    applied: boolean;
    /** The validation issues: warnings for an edit that applied, errors for one refused. */
    issues: BlueprintIssue[];
    /** The code that refused the edit outright, such as `edit.notAllowed` or `edit.blocked`. */
    refusal: string;
    versionAfter: number;
}

/** One turn of a conversation with the Architect: a prompt, and all that followed it. */
export interface ArchitectTurnRecord {
    kind: 'architectTurn';
    formatVersion: 1;
    /** The ID of the turn's user message. */
    turnId: string;
    /** The turn's place in its conversation, from 1. */
    turnNumber: number;
    prompt: string;
    model: string;
    effort: string;
    startedAt: string;
    endedAt: string;
    status: string;
    error: string;
    context: {
        blueprint: ArchitectRecordBlueprint;
        mode: string;
        access: string;
        uiContext: PlainObject;
        providers: Record<string, unknown>;
        systemPrompt: {hash: string; length: number; text?: string};
    };
    toolCalls: ArchitectRecordToolCall[];
    text: string;
    /** Each answer the turn showed with `show_ui`, as its tool input. */
    answers: PlainObject[];
    edits: ArchitectRecordEdit[];
    usage: ArchitectRecordUsage;
    /** Says what the record leaves out, such as data rows, or null if nothing. */
    redacted: string;
    /** The blueprint before the turn, where the capture kept it. */
    blueprintBefore?: Blueprint;
}

/** A whole conversation with the Architect, turn by turn. */
export interface ArchitectConversationRecord {
    kind: 'architectConversation';
    formatVersion: 1;
    exportedAt: string;
    turns: ArchitectTurnRecord[];
}

/** What {@link architectTurnRecord} and {@link architectConversationRecord} build from. */
export interface ArchitectRecordOptions {
    /** The conversation's messages, oldest first, as `ChatModel.messages` holds them. */
    messages: ChatMessage[];
    /** The context each turn was sent with, by turn ID, as {@link ArchitectTurnCapture.get} gives it. */
    contextOf?: (turnId: string) => ArchitectTurnContext;
    /** The Architect's system prompt, which the record names by its hash. */
    systemPrompt?: string;
    /** True to put the system prompt's whole text in the record. Default false, as it is large. */
    includeSystemPrompt?: boolean;
    /** The model's reasoning effort, where the app sets one. */
    effort?: string;
    /** Tokens and cost for a turn, over what its reply's metadata reports, such as with its cost. */
    usageOf?: (turnId: string) => ArchitectRecordUsage;
    /** The rows a list of data rows in a tool result keeps before it is cut. Default 5. */
    maxRows?: number;
    /** Epoch millis of the export. Default now. */
    now?: number;
}

/**
 * One turn of a conversation with the Architect as one JSON record, for a person improving the
 * Architect to read, or to turn into a harness scenario: the prompt, the context sent, every tool
 * call with its result and time, the reply's text and answers, the edits applied or refused, and
 * the tokens used. A turn is its user message and the replies up to the next user message.
 *
 * @param turnId - the ID of the turn's user message.
 */
export function architectTurnRecord(
    turnId: string,
    opts: ArchitectRecordOptions
): ArchitectTurnRecord {
    const {messages, contextOf, systemPrompt, includeSystemPrompt, effort, usageOf} = opts,
        maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS,
        start = messages.findIndex(it => it.id === turnId && it.role === 'user');
    if (start < 0) throw new Error(`There is no user message '${turnId}' in the conversation.`);
    const user = messages[start],
        next = messages.findIndex((it, idx) => idx > start && it.role === 'user'),
        replies = messages.slice(start + 1, next < 0 ? undefined : next),
        parts = replies.flatMap(it => it.parts),
        calls = parts.filter(it => it.type === 'toolCall') as ChatToolCallPart[],
        context = contextOf?.(turnId) ?? {},
        steps = replies.flatMap(it => (it.metadata?.usage as PlainObject[]) ?? []),
        last = replies.at(-1),
        toolCalls = calls.map(it => toolCallRecord(it, maxRows)),
        ret: ArchitectTurnRecord = {
            kind: 'architectTurn',
            formatVersion: 1,
            turnId,
            turnNumber: messages.slice(0, start + 1).filter(it => it.role === 'user').length,
            prompt: user.text,
            model: (steps.find(it => it.model)?.model ??
                replies.find(it => it.metadata?.model)?.metadata.model ??
                null) as string,
            effort: effort ?? null,
            startedAt: iso(context.capturedAt ?? user.createdAt),
            endedAt: iso(endOf(replies) ?? user.createdAt),
            status: last?.status ?? 'pending',
            error: last?.error ?? null,
            context: {
                blueprint: context.blueprint ?? null,
                mode: context.mode ?? null,
                access: context.access ?? null,
                uiContext: context.uiContext ?? null,
                providers: context.providers ?? {},
                systemPrompt: systemPrompt
                    ? {
                          hash: hashText(systemPrompt),
                          length: systemPrompt.length,
                          ...(includeSystemPrompt ? {text: systemPrompt} : {})
                      }
                    : null
            },
            toolCalls,
            text: parts
                .filter(it => it.type === 'text')
                .map(it => (it as ChatTextPart).text)
                .join('\n\n'),
            answers: calls.filter(it => it.toolName === SHOW_UI).map(it => cloneDeep(it.input)),
            edits: calls.filter(it => EDIT_TOOLS.includes(it.toolName)).map(editRecord),
            usage: usageRecord(steps, usageOf?.(turnId)),
            redacted: toolCalls.some(it => it.truncated)
                ? `Each list of data rows in a tool result keeps its first ${maxRows} rows. totalRows gives each list's full length.`
                : null
        };
    return context.blueprintBefore
        ? {...ret, blueprintBefore: cloneDeep(context.blueprintBefore)}
        : ret;
}

/** A whole conversation with the Architect, as {@link architectTurnRecord} records each turn. */
export function architectConversationRecord(
    opts: ArchitectRecordOptions
): ArchitectConversationRecord {
    return {
        kind: 'architectConversation',
        formatVersion: 1,
        exportedAt: iso(opts.now ?? Date.now()),
        turns: opts.messages
            .filter(it => it.role === 'user')
            .map(it => architectTurnRecord(it.id, opts))
    };
}

/**
 * Keeps what the Architect is sent with each turn, for its record: the context providers'
 * payloads at the turn's first step, and the blueprint as it stood then. Wrap the chat's context
 * providers with {@link wrap} as the `ChatModel` is made.
 */
export class ArchitectTurnCapture {
    private readonly turns = new Map<string, ArchitectTurnContext>();

    /**
     * @param opts.blueprintOf - the blueprint and its document as they stand now, read as each
     *      turn starts.
     */
    constructor(
        private readonly opts: {
            blueprintOf?: () => {blueprint?: Blueprint} & ArchitectRecordBlueprint;
        } = {}
    ) {}

    /** The providers, each keeping its payload for the step that starts a turn. */
    wrap(providers: ChatContextProvider[]): ChatContextProvider[] {
        return providers.map(provider => ({
            ...provider,
            getContext: async request => {
                const value = await provider.getContext(request);
                if (request?.stepIndex === 0 && request.turnId) {
                    this.note(request.turnId, provider.name, value);
                }
                return value;
            }
        }));
    }

    /** What a turn was sent, by the ID of its user message, or null if none was kept. */
    get(turnId: string): ArchitectTurnContext {
        return this.turns.get(turnId) ?? null;
    }

    //------------------
    // Implementation
    //------------------
    private note(turnId: string, name: string, value: unknown) {
        let turn = this.turns.get(turnId);
        if (!turn) {
            const {blueprint, ...doc} = this.opts.blueprintOf?.() ?? {};
            turn = {
                capturedAt: Date.now(),
                providers: {},
                ...(blueprint ? {blueprintBefore: cloneDeep(blueprint)} : {}),
                blueprint: doc
            };
            this.turns.set(turnId, turn);
        }
        turn.providers[name] = cloneDeep(value);
        if (name === 'ui_context') turn.uiContext = value as PlainObject;
        if (name === 'blueprint' && isPlainObject(value)) {
            const {version, mode, access} = value as PlainObject;
            turn.blueprint = {...turn.blueprint, ...(version != null ? {version} : {})};
            turn.mode = mode ?? turn.mode;
            turn.access = access ?? turn.access;
        }
    }
}

//------------------
// Implementation
//------------------
const DEFAULT_MAX_ROWS = 5,
    SHOW_UI = 'show_ui',
    EDIT_TOOLS = ['edit_blueprint'];

function toolCallRecord(part: ChatToolCallPart, maxRows: number): ArchitectRecordToolCall {
    const totalRows: Record<string, number> = {},
        result = cutRows(part.output ?? null, maxRows, '', totalRows),
        truncated = Object.keys(totalRows).length > 0;
    return {
        name: part.toolName,
        input: cloneDeep(part.input ?? {}),
        result,
        error: part.errorText ?? null,
        durationMs:
            part.startedAt != null && part.endedAt != null ? part.endedAt - part.startedAt : null,
        truncated,
        ...(truncated ? {totalRows} : {})
    };
}

// A copy of a value with each list of data rows longer than maxRows cut to its first rows. Only
// data is cut: what the model read of a blueprint, the registry or the catalog stays whole.
function cutRows(
    value: unknown,
    maxRows: number,
    path: string,
    totals: Record<string, number>
): unknown {
    if (isArray(value)) {
        return value.map((it, idx) => cutRows(it, maxRows, `${path}/${idx}`, totals));
    }
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
        Object.entries(value as PlainObject).map(([k, v]) => {
            const at = `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
            if (DATA_KEYS.includes(k) && isArray(v) && v.length > maxRows) {
                totals[at] = v.length;
                v = v.slice(0, maxRows);
            }
            return [k, cutRows(v, maxRows, at, totals)];
        })
    );
}

// The keys of a tool result that hold data rows: a query's rows, and their text.
const DATA_KEYS = ['rows', 'text'];

function editRecord(part: ChatToolCallPart): ArchitectRecordEdit {
    const input = part.input ?? {},
        // A refused edit's result arrives as its error's text, which is the result as JSON.
        result: PlainObject = part.output ?? parseJson(part.errorText) ?? {},
        issues: BlueprintIssue[] = result.issues ?? result.warnings ?? [],
        applied = result.applied === true,
        refusal = applied
            ? null
            : (issues.find(it => REFUSALS.includes(it.code))?.code ??
              (issues.some(it => it.severity === 'error') ? 'edit.invalid' : null));
    return {
        description: input.description ?? null,
        ops: cloneDeep(input.ops ?? []),
        applied,
        issues: cloneDeep(issues),
        refusal,
        versionAfter: result.version ?? null
    };
}

const REFUSALS = ['edit.notAllowed', 'edit.blocked', 'edit.staleBase'];

function usageRecord(steps: PlainObject[], extra: ArchitectRecordUsage): ArchitectRecordUsage {
    const total = (key: string) =>
            steps.some(it => it[key] != null) ? sum(steps.map(it => it[key] ?? 0)) : undefined,
        ret: ArchitectRecordUsage = {
            inputTokens: total('inputTokens'),
            outputTokens: total('outputTokens'),
            cachedInputTokens: total('cachedInputTokens'),
            cacheWriteInputTokens: total('cacheWriteInputTokens'),
            ...extra
        },
        known = Object.fromEntries(Object.entries(ret).filter(([, v]) => v != null));
    return Object.keys(known).length ? known : null;
}

function endOf(replies: ChatMessage[]): number {
    const ends = replies.flatMap(it =>
        it.parts.flatMap(p => [(p as PlainObject).endedAt as number]).filter(Boolean)
    );
    return ends.length ? Math.max(...ends) : (replies.at(-1)?.createdAt ?? null);
}

function iso(millis: number): string {
    return millis != null ? new Date(millis).toISOString() : null;
}

function parseJson(text: string): PlainObject {
    if (!isString(text)) return null;
    try {
        const ret = JSON.parse(text);
        return isPlainObject(ret) ? ret : null;
    } catch {
        return null;
    }
}

/** A short, stable hash of a text, such as a system prompt, to tell its versions apart. */
export function hashText(text: string): string {
    // FNV-1a, 32 bits, twice with different seeds, for 16 hex characters.
    const fnv = (seed: number) => {
        let h = seed;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    };
    return fnv(0x811c9dc5) + fnv(0x01000193);
}
