import {enforceEvents, enforceOutgoingInput, transformChunks, verifyEvents} from '@ag-ui/client';
import type {BaseEvent, RunAgentInput} from '@ag-ui/core';
import type {PlainObject} from '@xh/hoist/core';
import {isArray} from 'lodash';
import {ChatRunError} from '../../core';
import {Subject} from 'rxjs';
import type {ChatDecoder} from '../ChatCodec';
import type {ChatEvent} from '../ChatEvent';

/**
 * Put the official AG-UI client's checks in front of a decoder, in the order its own agents run
 * them:
 *
 *  - enforcement, which drops events of an unknown type and strips unknown fields, each with a
 *    console warning, and fails on a malformed known field.
 *  - chunk expansion, which turns `TEXT_MESSAGE_CHUNK`, `REASONING_MESSAGE_CHUNK` and
 *    `TOOL_CALL_CHUNK` into start, content and end events.
 *  - verification of the event sequence, which fails a stream that breaks AG-UI's ordering rules,
 *    such as one that does not open with `RUN_STARTED`.
 *
 * The checks run synchronously, so each record's events come back from the same call. A
 * violation throws a `ChatRunError` coded `invalid-stream`, which names the broken rule and has
 * the client's own error as its `cause`, and fails the turn. This is the only module of the kit that uses RxJS.
 * @internal
 */
export function withAgUiChecks(decode: ChatDecoder): ChatDecoder {
    const input = new Subject<BaseEvent>(),
        checked: ChatEvent[] = [];
    let error: Error = null,
        lastType: string = null;
    input.pipe(enforceEvents(false), transformChunks(false), verifyEvents(false)).subscribe({
        next: event => checked.push(event as unknown as ChatEvent),
        error: e => {
            error = checkError(
                `Invalid AG-UI stream: ${describeError(e, `${lastType} event`)}`,
                'invalid-stream',
                e
            );
        }
    });

    const drain = (eventName?: string): ChatEvent[] => {
        if (error) throw error;
        return checked.splice(0).flatMap(it => decode(it, eventName));
    };

    const ret: ChatDecoder = (raw, eventName) => {
        lastType = raw?.type;
        input.next(raw as BaseEvent);
        return drain(eventName);
    };
    ret.flush = () => {
        input.complete();
        return [...drain(), ...(decode.flush?.() ?? [])];
    };
    return ret;
}

/**
 * Run the official AG-UI client's check on a request body before it is sent. It strips fields
 * AG-UI does not define, with a console warning. For a malformed field it defines, such as a
 * context value that is not a string, it throws a `ChatRunError` coded `invalid-request`, which
 * fails the turn before the request goes.
 * @internal
 */
export function checkAgUiInput(body: PlainObject): PlainObject {
    try {
        return enforceOutgoingInput(body as RunAgentInput);
    } catch (e) {
        throw checkError(
            `Invalid AG-UI request: ${describeError(e, 'RunAgentInput')}`,
            'invalid-request',
            e
        );
    }
}

//------------------
// Implementation
//------------------
/** A turn error for a failed check, with the client's own error as its `cause`. */
function checkError(message: string, code: string, cause: unknown): ChatRunError {
    const ret = new ChatRunError(message, code);
    ret.cause = cause;
    return ret;
}

/** A check's error as one line: the rule broken, or the fields that failed validation. */
function describeError(e: any, typeName: string): string {
    if (!isArray(e?.issues)) return e?.message ?? String(e);
    const fields = e.issues.map(it => `${it.path?.join('.') || 'root'} - ${it.message}`);
    return `malformed ${typeName}: ${fields.join('; ')}`;
}
