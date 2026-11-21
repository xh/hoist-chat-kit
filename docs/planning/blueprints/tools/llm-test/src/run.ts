/**
 * Runs the scenarios against Claude models with the Architect's tools, and reports how each did.
 *
 * Usage: pnpm test [--models opus,sonnet] [--scenarios P1,P2] [--repeat 1] [--effort medium] [--budget 20] [--dry]
 * Reads the API key from XH_ANTHROPIC_API_KEY. Writes results to results/<timestamp>/.
 * --dry counts the prompt's tokens and makes no billed call.
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadBlueprint} from './load.ts';
import {SYSTEM_PROMPT} from './prompt.ts';
import {Scenario, SCENARIOS} from './scenarios.ts';
import {Session, TOOLS} from './tools.ts';
import {validate} from './library.ts';

const MODELS: Record<string, {id: string; input: number; output: number; cacheRead: number; cacheWrite: number}> = {
    opus: {id: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5},
    sonnet: {id: 'claude-sonnet-5-5', input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5}
};
const MAX_CALLS_PER_STEP = 25;

const arg = (name: string, dflt?: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? dflt : process.argv[i + 1];
};
const models = arg('models', 'opus,sonnet')!.split(','),
    scenarioIds = arg('scenarios')?.split(','),
    effort = arg('effort', 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    budget = Number(arg('budget', '20')),
    repeat = Number(arg('repeat', '1')),
    dry = process.argv.includes('--dry');
const scenarios = SCENARIOS.filter(s => !scenarioIds || scenarioIds.includes(s.id)).flatMap(s => Array(repeat).fill(s));

const apiKey = process.env.XH_ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('Set XH_ANTHROPIC_API_KEY');
const client = new Anthropic({apiKey, maxRetries: 6});

const system: Anthropic.Beta.BetaTextBlockParam[] = [{type: 'text', text: SYSTEM_PROMPT, cache_control: {type: 'ephemeral'}}];
const tools = TOOLS as Anthropic.Beta.BetaTool[];

function firstMessage(s: Scenario, prompt: string) {
    const host = s.host ? `\n\nHost blueprint, version 0:\n${JSON.stringify(loadBlueprint(s.host))}` : '';
    return `${s.context}${host}\n\n${prompt}`;
}

interface Usage {
    input: number;
    cacheWrite: number;
    cacheRead: number;
    output: number;
    cost: number;
}
let spent = 0,
    halted = '';

function addUsage(u: Usage, model: string, usage: any) {
    const p = MODELS[model],
        input = usage.input_tokens ?? 0,
        cw = usage.cache_creation_input_tokens ?? 0,
        cr = usage.cache_read_input_tokens ?? 0,
        out = usage.output_tokens ?? 0,
        cost = (input * p.input + cw * p.cacheWrite + cr * p.cacheRead + out * p.output) / 1e6;
    Object.assign(u, {input: u.input + input, cacheWrite: u.cacheWrite + cw, cacheRead: u.cacheRead + cr, output: u.output + out, cost: u.cost + cost});
    spent += cost;
}

async function runScenario(model: string, s: Scenario) {
    const session = new Session(s.host ? loadBlueprint(s.host) : null, s.mode, s.library),
        messages: Anthropic.Beta.BetaMessageParam[] = [],
        usage: Usage = {input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0},
        replies: string[] = [],
        events: string[] = [];
    let calls = 0,
        fallbacks = 0;
    const started = Date.now();

    for (const [i, step] of s.steps.entries()) {
        session.userMessages.push(step.prompt);
        messages.push({role: 'user', content: i === 0 ? firstMessage(s, step.prompt) : step.prompt});
        for (let n = 0; ; n++) {
            if (n >= MAX_CALLS_PER_STEP) {
                events.push(`step ${i + 1}: stopped after ${MAX_CALLS_PER_STEP} calls`);
                break;
            }
            if (spent > budget) {
                events.push(`stopped: budget of $${budget} spent`);
                break;
            }
            const res = await client.beta.messages.create({
                model: MODELS[model].id,
                max_tokens: 16000,
                system,
                tools,
                messages,
                output_config: {effort},
                cache_control: {type: 'ephemeral'},
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default'
            });
            calls++;
            addUsage(usage, model, res.usage);
            if ((res.usage as any).iterations?.some((it: any) => it.type === 'fallback_message')) fallbacks++;
            messages.push({role: 'assistant', content: res.content});

            if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
                events.push(`step ${i + 1}: stop_reason ${res.stop_reason}`);
                break;
            }
            const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
            if (!toolUses.length) {
                replies.push(res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n'));
                break;
            }
            const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
            for (const t of toolUses) {
                const r = await session.run(t.name, t.input);
                results.push({type: 'tool_result', tool_use_id: t.id, content: r.content, is_error: r.isError});
            }
            messages.push({role: 'user', content: results});
        }
    }

    const outcome = {blueprint: session.blueprint, segments: session.segments, replies, calls: session.calls, featureRequests: session.featureRequests},
        finalIssues = s.steps.length && Object.keys(session.blueprint.elements ?? {}).length ? validate(session.blueprint, {artifacts: session.artifacts}) : [],
        checks = s.checks.map(([name, fn]) => {
            let ok = false;
            try {
                ok = Boolean(fn(outcome));
            } catch {
                ok = false;
            }
            return {name, ok};
        });
    return {
        model, scenario: s.id, title: s.title, calls, fallbacks, seconds: Math.round((Date.now() - started) / 1000),
        usage, stats: session.stats, checks, finalIssues, events, replies, toolOrder: session.calls, blueprint: session.blueprint, segments: session.segments, messages
    };
}

async function main() {
    if (dry) {
        for (const m of models) {
            const count = await client.beta.messages.countTokens({model: MODELS[m].id, system, tools, messages: [{role: 'user', content: 'x'}]});
            console.log(`${m}: system prompt and tools are ${count.input_tokens} tokens`);
        }
        return;
    }
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../results', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, {recursive: true});
    const runs: any[] = [];
    await Promise.all(models.map(async m => {
        for (const [i, s] of scenarios.entries()) {
            if (spent > budget || halted) break;
            console.log(`start ${m} ${s.id}`);
            try {
                const r = await runScenario(m, s);
                runs.push(r);
                const run = repeat > 1 ? `-${(i % repeat) + 1}` : '';
                fs.writeFileSync(path.join(dir, `${m}-${s.id}${run}.json`), JSON.stringify(r, null, 2));
                console.log(`done  ${m} ${s.id}: ${r.checks.filter(c => c.ok).length}/${r.checks.length} checks, ${r.finalIssues.length} issues, $${r.usage.cost.toFixed(3)}`);
            } catch (e) {
                if (!(e instanceof Anthropic.APIError)) throw e;
                console.error(`fail  ${m} ${s.id}: API ${e.status} ${e.message}`);
                // A bad request, a bad key or no credit fails every later call too.
                if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
                    halted = `${m} ${s.id}: API ${e.status}`;
                }
            }
        }
    }));

    const rows = runs
        .sort((a, b) => a.scenario.localeCompare(b.scenario) || a.model.localeCompare(b.model))
        .map(r => `| ${r.scenario} | ${r.model} | ${r.checks.filter((c: any) => c.ok).length}/${r.checks.length} | ${r.finalIssues.filter((i: any) => i.severity === 'error').length} | ${r.stats.edits - r.stats.editsRejected}/${r.stats.edits} | ${r.calls} | ${r.seconds}s | $${r.usage.cost.toFixed(3)} | ${r.events.join('; ')} |`);
    const failed = runs.flatMap(r => r.checks.filter((c: any) => !c.ok).map((c: any) => `- ${r.scenario} ${r.model}: ${c.name}`));
    const codes = runs.flatMap(r => Object.entries(r.stats.issueCodes).map(([c, n]) => `- ${r.scenario} ${r.model}: ${c} x${n}`));
    const md = [
        `# LLM test results`, '', `Effort ${effort}. Total $${spent.toFixed(2)}.`, '',
        '| Scenario | Model | Checks | Final errors | Edits applied | Calls | Time | Cost | Events |', '|---|---|---|---|---|---|---|---|---|', ...rows,
        ...(halted ? ['', `Halted after ${halted}.`] : []),
        '', '## Failed checks', '', ...(failed.length ? failed : ['None']),
        '', '## Issues the models hit', '', ...(codes.length ? codes : ['None'])
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'summary.md'), md + '\n');
    console.log(`\n${md}\n\nResults in ${dir}`);
}

await main();
