import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import type {PlainObject} from '@xh/hoist/core';
import {get, has, isEmpty, isEqual, isNil, isPlainObject, isString, omit, omitBy} from 'lodash';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ChatMessage, ChatStreamReducer} from '../../core';
import {AgUiCodec, type ChatEvent, type ChatRunRequest} from '../../transport';
import {getAgUiAssistantText, groupAgUiMessages} from '../../transport/impl/agUiMessages';
import {KNOWN_GAPS, NOT_APPLICABLE} from './agUiKnownGaps';

/**
 * The official AG-UI 1.0 consumer conformance corpus, run against the kit.
 *
 * Each fixture is a stream of raw events and what a client must do with it. The runner decodes the
 * stream with `AgUiCodec`, as a transport would, and reads it to the end, as `ChatModel` does. It
 * folds the events into a reply with the kit's `ChatStreamReducer`, and checks the fixture's expectations against the events delivered and the
 * reply. A fixture passes, or fails exactly the checks its entry in `agUiKnownGaps.ts` names. A gap
 * that closes fails the run until its entry leaves the list, so the list is always current.
 *
 * The runner applies the corpus's own rules for a client other than the official ones - see
 * `README.md` here: it skips the SHOULD-level `warnings` and `noWarnings` checks, drops the
 * `expectOverrides.dotnet` blocks, and lists the fixtures that do not apply in `NOT_APPLICABLE`.
 * It applies the `expectOverrides.typescript` blocks, as the kit runs the official TypeScript
 * client's checks.
 */
describe('AG-UI 1.0 conformance', () => {
    // The checks warn on what they strip or drop. Keep the test output quiet.
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('holds every fixture its manifest lists, and no others', () => {
        expect(readManifest()).toEqual(FIXTURE_NAMES);
    });

    it('lists gaps only for fixtures that exist and apply', () => {
        expect(Object.keys(KNOWN_GAPS).filter(it => !FIXTURE_NAMES.includes(it))).toEqual([]);
        expect(Object.keys(NOT_APPLICABLE).filter(it => !FIXTURE_NAMES.includes(it))).toEqual([]);
        expect(Object.keys(KNOWN_GAPS).filter(it => has(NOT_APPLICABLE, it))).toEqual([]);
    });

    FIXTURE_NAMES.forEach(name => {
        if (has(NOT_APPLICABLE, name)) {
            it.skip(`${name} - ${NOT_APPLICABLE[name]}`);
            return;
        }

        const gap = KNOWN_GAPS[name];
        it(gap ? `${name} - known gap: ${gap.reason}` : name, async () => {
            const fixture = readFixture(name),
                failed = await failingChecks(fixture);
            expect(
                failed,
                gap
                    ? 'A known gap changed. Update its entry in agUiKnownGaps.ts.'
                    : 'A passing fixture failed.'
            ).toEqual(gap?.checks ?? []);
        });
    });
});

//------------------
// Fixtures
//------------------
const FIXTURE_DIR = path.join(import.meta.dirname, 'ag-ui-1.0'),
    FIXTURE_NAMES = readdirSync(FIXTURE_DIR)
        .filter(it => it.endsWith('.json'))
        .map(it => it.replace(/\.json$/, ''))
        .sort();

function readManifest(): string[] {
    return readFileSync(path.join(FIXTURE_DIR, 'MANIFEST.txt'), 'utf8')
        .split('\n')
        .map(it => it.trim())
        .filter(it => it && !it.startsWith('#'))
        .map(it => it.replace(/\.json$/, ''));
}

function readFixture(name: string): PlainObject {
    return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/** The fixture's expectations for the kit: the TypeScript lane's, less the SHOULD-level checks. */
function getExpectations(fixture: PlainObject): PlainObject {
    const ret = {...fixture.expect, ...omit(fixture.expectOverrides?.typescript, 'intentional')};
    return omit(ret, ['warnings', 'noWarnings']);
}

//------------------
// The kit's run
//------------------
interface KitRun {
    outcome: 'completed' | 'failed';
    error: string;
    delivered: ChatEvent[];
    messages: PlainObject[];
    request: PlainObject;
}

/** Decode the stream as a transport would, and fold what the decoder delivers into a reply. */
async function runFixture(fixture: PlainObject): Promise<KitRun> {
    const codec = new AgUiCodec(),
        decode = codec.createDecoder(),
        delivered: ChatEvent[] = [];
    let error: string = null;
    try {
        fixture.stream.forEach(raw => delivered.push(...decode(raw)));
        delivered.push(...decode.flush());
    } catch (e) {
        error = [e.message, e.cause?.message].filter(Boolean).join(' - ');
    }

    // The reducer failing would fail the turn too.
    let messages: PlainObject[] = [];
    try {
        const reducer = new ChatStreamReducer(0),
            reply = reducer.finish(
                reducer.apply(new ChatMessage({role: 'assistant', status: 'pending'}), delivered)
            );
        messages = [...(fixture.input?.messages ?? []), ...toAgUiMessages(reply)];
    } catch (e) {
        error ??= e.message;
    }

    return {
        outcome: error ? 'failed' : 'completed',
        error,
        delivered,
        messages,
        request: await codec.encodeRequest(runRequest())
    };
}

/**
 * The kit's reply as the AG-UI messages a client would hold, so that the corpus's message checks
 * apply. It groups the parts into messages, with the server's ids, as `AgUiCodec` does for the
 * history it sends - see `groupAgUiMessages()`. Each message then takes the content the corpus
 * checks, with the metadata that `AgUiCodec` sends:
 *
 *  - reasoning - the reasoning text.
 *  - assistant - the text, if any, and each tool call, whether or not it has a result.
 *  - tool - the call's output as the reducer parsed it, or the error text of a failed call.
 *  - activity - the data part's type and data.
 */
function toAgUiMessages(reply: ChatMessage): PlainObject[] {
    return groupAgUiMessages(reply.parts, reply.id).map(group => {
        const {id, role} = group;
        switch (group.role) {
            case 'reasoning':
                return omitBy(
                    {id, role, content: group.part.text, metadata: group.part.metadata},
                    isNil
                );
            case 'assistant':
                return omitBy(
                    {
                        id,
                        role,
                        content: isEmpty(group.texts) ? null : getAgUiAssistantText(group),
                        toolCalls: isEmpty(group.calls)
                            ? null
                            : group.calls.map(call =>
                                  omitBy(
                                      {
                                          id: call.id,
                                          type: 'function',
                                          function: {
                                              name: call.toolName,
                                              arguments: call.inputText
                                          },
                                          metadata: call.metadata
                                      },
                                      isNil
                                  )
                              ),
                        metadata: group.metadata
                    },
                    isNil
                );
            case 'tool': {
                const {call} = group;
                return {
                    id,
                    role,
                    toolCallId: call.id,
                    content: call.state === 'output-available' ? call.output : call.errorText
                };
            }
            case 'activity':
                return {id, role, activityType: group.part.dataType, content: group.part.data};
        }
    });
}

/** A first run of a new thread, for the checks on what the codec sends. */
function runRequest(): ChatRunRequest {
    const message = new ChatMessage({id: 'u1', role: 'user', content: 'Hi'});
    return {
        threadId: 't1',
        runId: 'r1',
        historyMode: 'client',
        trigger: 'submit',
        turnId: message.id,
        stepIndex: 0,
        messages: [message],
        newMessages: [message],
        replacedMessageId: null,
        runOptions: null,
        catalogVersion: null,
        tools: [],
        context: [],
        signal: new AbortController().signal
    };
}

//------------------
// Checks
//------------------
/**
 * The names of the fixture's checks that the kit fails. They are the corpus's `expect` keys, plus
 * `messageIds`, split from `messages`, which compares the messages without their ids.
 */
async function failingChecks(fixture: PlainObject): Promise<string[]> {
    const run = await runFixture(fixture),
        {delivered} = run,
        ret: string[] = [];
    const check = (key: string, ok: boolean) => {
        if (!ok) ret.push(key);
    };

    Object.entries(getExpectations(fixture)).forEach(([key, want]) => {
        switch (key) {
            case 'outcome':
                check(key, run.outcome === want);
                break;
            case 'errorContains':
                check(key, run.outcome === 'failed' && run.error.includes(want));
                break;
            case 'runError': {
                const err = delivered.find(it => it.type === 'RUN_ERROR');
                check(key, !!err && (want === true || !!err.message?.includes(want)));
                break;
            }
            case 'eventTypes':
                check(
                    key,
                    isEqual(
                        delivered.map(it => it.type),
                        want
                    )
                );
                break;
            case 'eventTypesAbsent':
                check(key, !delivered.some(it => want.includes(it.type)));
                break;
            case 'eventPaths':
                check(
                    key,
                    Object.entries(want).every(([p, v]) => isEqual(eventPath(delivered, p), v))
                );
                break;
            case 'eventAbsentPaths':
                check(
                    key,
                    want.every(p => eventPath(delivered, p) === undefined)
                );
                break;
            case 'messageCount':
                check(key, run.messages.length === want);
                break;
            case 'messages':
                check(key, subsetMatch(run.messages, withoutIds(want)));
                if (want.some(it => has(it, 'id'))) {
                    check('messageIds', subsetMatch(run.messages, want));
                }
                break;
            case 'state':
                // The kit keeps no AG-UI state.
                check(key, false);
                break;
            case 'request':
                check(key, subsetMatch(run.request, want));
                break;
            case 'requestAbsentPaths':
                check(
                    key,
                    want.every(p => get(run.request, p) === undefined)
                );
                break;
            default:
                throw new Error(`Unknown expectation '${key}' - update the runner.`);
        }
    });
    return ret;
}

function eventPath(events: ChatEvent[], key: string): unknown {
    const [idx, ...rest] = key.split('.');
    return rest.length ? get(events[Number(idx)], rest.join('.')) : events[Number(idx)];
}

/**
 * The corpus's subset match: arrays match by length and position, objects only on the keys
 * named, and anything else by equality. A string matches a value that serializes to it.
 */
function subsetMatch(actual: any, expected: any): boolean {
    if (Array.isArray(expected)) {
        return (
            Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every((it, idx) => subsetMatch(actual[idx], it))
        );
    }
    if (isPlainObject(expected)) {
        return (
            isPlainObject(actual) &&
            Object.keys(expected).every(k => has(actual, k) && subsetMatch(actual[k], expected[k]))
        );
    }
    if (isString(expected) && !isString(actual) && actual != null) {
        return JSON.stringify(actual) === expected;
    }
    return isEqual(actual, expected);
}

function withoutIds(messages: PlainObject[]): PlainObject[] {
    return messages.map(it => omit(it, 'id'));
}
