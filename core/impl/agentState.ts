import {compactEvents} from '@ag-ui/client';
import type {BaseEvent, StateSnapshotEvent} from '@ag-ui/core';
import {logWarn, throwIf} from '@xh/hoist/utils/js';
import {isEqual} from 'lodash';

/**
 * Apply a JSON Patch (RFC 6902) to an agent's shared state, and return the state that results.
 *
 * The patch runs through the official AG-UI client's JSON Patch support: its `compactEvents()`
 * folds a snapshot and a delta into one snapshot. The patch applies whole or not at all. For one
 * that does not apply, the client warns in the console, and the state comes back as given. The
 * state given is never mutated, and comes back itself when the patch changes nothing.
 *
 * Never throws. A state that the client cannot copy, such as one that holds a MobX observable,
 * comes back as given, with a warning, as for a patch that does not apply.
 * @internal
 */
export function applyAgentStateDelta(state: any, delta: any[]): any {
    try {
        const [compacted] = compactEvents([
                {type: 'STATE_SNAPSHOT', snapshot: state},
                {type: 'STATE_DELTA', delta}
            ] as BaseEvent[]),
            next = (compacted as StateSnapshotEvent).snapshot;
        return isEqual(next, state) ? state : next;
    } catch (e) {
        logWarn(['Failed to apply a patch to the agent state', e], 'ChatStreamReducer');
        return state;
    }
}

/**
 * A state from the app as the chat holds it: a copy that is plain JSON, apart from its source, so
 * that no MobX observable or class instance reaches the patch, the request or a reader. Null is
 * an empty object, as the chat holds no null state.
 * @internal
 */
export function toAgentState(state: any): any {
    if (state == null) return {};
    const json = JSON.stringify(state);
    throwIf(json === undefined, 'The agent state must be a JSON value.');
    return JSON.parse(json);
}
