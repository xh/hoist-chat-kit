import type {PlainObject} from '@xh/hoist/core';
import type {Blueprint} from '../../blueprint';
import type {
    ArchitectConversationRecord,
    ArchitectRecordToolCall,
    ArchitectTurnRecord
} from './architectRecord';

/** A turn or a conversation with the Architect as Markdown, for a person to read. */
export function architectRecordMarkdown(
    record: ArchitectTurnRecord | ArchitectConversationRecord
): string {
    if (record.kind === 'architectTurn') return turnMarkdown(record, 1);
    return [
        `# Conversation with the Architect`,
        `Exported ${record.exportedAt}. ${record.turns.length} turn${record.turns.length === 1 ? '' : 's'}.`,
        ...record.turns.map((it, idx) => turnMarkdown(it, idx + 1))
    ].join('\n\n');
}

/** What {@link architectHarnessScenario} returns: the scenario, its host, and its source. */
export interface ArchitectHarnessScenario {
    /** The scenario, in the shape the llm-test harness's `SCENARIOS` holds, with no checks yet. */
    scenario: {
        id: string;
        title: string;
        host?: string;
        context: string;
        uiContext?: PlainObject;
        steps: {prompt: string}[];
        checks: [];
    };
    /** The blueprint before the turn, to save as the host file, or null for a new blueprint. */
    host: Blueprint;
    /** The scenario as TypeScript, to paste into `scenarios.ts`, with its checks left as a TODO. */
    source: string;
}

/**
 * A turn as a scenario for the Architect's llm-test harness: its prompt, the blueprint it ran on
 * as the host, its `ui_context`, and its mode and access as the scenario's context. A person adds
 * the checks, which say what the turn should have done.
 *
 * @param opts.id - the scenario's ID, such as `P20`. Default `X1`.
 */
export function architectHarnessScenario(
    record: ArchitectTurnRecord,
    opts: {id?: string; title?: string} = {}
): ArchitectHarnessScenario {
    const id = opts.id ?? 'X1',
        host = record.blueprintBefore ?? null,
        hostFile = host ? `${id.toLowerCase()}-host.json` : null,
        {mode, access, uiContext} = record.context,
        scenario: ArchitectHarnessScenario['scenario'] = {
            id,
            title: opts.title ?? firstLine(record.prompt),
            ...(hostFile ? {host: hostFile} : {}),
            context: contextLine(mode, access, !!host),
            ...(uiContext ? {uiContext} : {}),
            steps: [{prompt: record.prompt}],
            checks: []
        };
    return {scenario, host, source: scenarioSource(scenario)};
}

//------------------
// Implementation
//------------------
function turnMarkdown(turn: ArchitectTurnRecord, n: number): string {
    const {context, usage} = turn,
        bp = context.blueprint,
        facts = [
            ['Model', [turn.model, turn.effort].filter(Boolean).join(', ')],
            ['Started', turn.startedAt],
            ['Ended', turn.endedAt],
            ['Status', turn.error ? `${turn.status}: ${turn.error}` : turn.status],
            [
                'Blueprint',
                bp
                    ? [bp.name, bp.id, bp.type, bp.version != null ? `version ${bp.version}` : null]
                          .filter(Boolean)
                          .join(' · ')
                    : null
            ],
            ['Mode', [context.mode, context.access].filter(Boolean).join(', ')],
            [
                'System prompt',
                context.systemPrompt
                    ? `${context.systemPrompt.hash} (${context.systemPrompt.length} characters)`
                    : null
            ],
            ['Usage', usage ? usageText(usage) : null]
        ].filter(([, v]) => v);
    return [
        `## Turn ${n}`,
        facts.map(([k, v]) => `- **${k}:** ${v}`).join('\n'),
        `### Prompt\n\n${quote(turn.prompt)}`,
        context.uiContext ? `### ui_context\n\n${json(context.uiContext)}` : null,
        turn.toolCalls.length
            ? `### Tool calls\n\n${turn.toolCalls.map(toolCallMarkdown).join('\n\n')}`
            : null,
        turn.edits.length
            ? `### Edits\n\n${turn.edits
                  .map(
                      it =>
                          `- ${it.applied ? 'Applied' : `Refused (${it.refusal ?? 'invalid'})`}: ${it.description ?? '(no description)'}, ${it.ops.length} op${it.ops.length === 1 ? '' : 's'}${it.versionAfter != null ? `, version ${it.versionAfter}` : ''}${it.issues.length ? `\n${it.issues.map(i => `  - ${i.severity} ${i.code} ${i.path}: ${i.message}`).join('\n')}` : ''}`
                  )
                  .join('\n')}`
            : null,
        turn.answers.length ? `### Answers\n\n${turn.answers.map(json).join('\n\n')}` : null,
        turn.text ? `### Reply\n\n${turn.text}` : null,
        turn.redacted ? `_${turn.redacted}_` : null
    ]
        .filter(Boolean)
        .join('\n\n');
}

function toolCallMarkdown(call: ArchitectRecordToolCall, idx: number): string {
    const head = `${idx + 1}. \`${call.name}\`${call.durationMs != null ? ` (${call.durationMs} ms)` : ''}${call.error ? ', failed' : ''}`;
    return [
        head,
        `Input:\n${json(call.input)}`,
        call.error ? `Error:\n${json(call.error)}` : `Result:\n${json(call.result)}`,
        call.truncated ? `Rows cut, of ${JSON.stringify(call.totalRows)}.` : null
    ]
        .filter(Boolean)
        .join('\n\n');
}

function usageText(usage: ArchitectTurnRecord['usage']): string {
    const {inputTokens, outputTokens, cachedInputTokens, cost} = usage;
    return [
        inputTokens != null ? `${inputTokens} in` : null,
        cachedInputTokens ? `${cachedInputTokens} cached` : null,
        outputTokens != null ? `${outputTokens} out` : null,
        cost != null ? `$${cost.toFixed(4)}` : null
    ]
        .filter(Boolean)
        .join(', ');
}

function json(value: unknown): string {
    return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

function quote(text: string): string {
    return (text ?? '')
        .split('\n')
        .map(it => `> ${it}`)
        .join('\n');
}

function firstLine(text: string): string {
    const line = (text ?? '').split('\n')[0].trim();
    return line.length > 70 ? `${line.slice(0, 67)}...` : line;
}

// The harness's context line, as its scenarios write it.
function contextLine(mode: string, access: string, hasHost: boolean): string {
    const parts = [
        `Mode: ${mode ?? 'design'}.`,
        access === 'read' ? 'The user has read access.' : 'The user has write access.',
        hasHost
            ? 'They are editing the host blueprint below.'
            : 'Build a new blueprint: it starts empty, at version 0.'
    ];
    return parts.join(' ');
}

function scenarioSource(scenario: ArchitectHarnessScenario['scenario']): string {
    const lit = (v: unknown) => JSON.stringify(v).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:'),
        lines = [
            '    {',
            `        id: ${lit(scenario.id)},`,
            `        title: ${lit(scenario.title)},`,
            ...(scenario.host ? [`        host: ${lit(scenario.host)},`] : []),
            `        context: ${lit(scenario.context)},`,
            ...(scenario.uiContext ? [`        uiContext: ${lit(scenario.uiContext)},`] : []),
            `        steps: [{prompt: ${lit(scenario.steps[0].prompt)}}],`,
            '        checks: [',
            "            // TODO: what this turn should do, each as ['what', o => test], such as",
            "            // ['a cubeGrid over positions', o => cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'positions').length]",
            '        ]',
            '    },'
        ];
    return lines.join('\n');
}
