import {compactEvents} from '@ag-ui/client';
import type {BaseEvent, StateSnapshotEvent} from '@ag-ui/core';
import {isEqual} from 'lodash';

/**
 * Apply a JSON Patch (RFC 6902) to an agent's shared state, and return the state that results.
 *
 * The patch runs through the official AG-UI client's JSON Patch support: its `compactEvents()`
 * folds a snapshot and a delta into one snapshot. The patch applies whole or not at all. For one
 * that does not apply, the client warns in the console, and the state comes back as given. The
 * state given is never mutated, and comes back itself when the patch changes nothing.
 * @internal
 */
export function applyAgentStateDelta(state: any, delta: any[]): any {
    const [compacted] = compactEvents([
            {type: 'STATE_SNAPSHOT', snapshot: state},
            {type: 'STATE_DELTA', delta}
        ] as BaseEvent[]),
        next = (compacted as StateSnapshotEvent).snapshot;
    return isEqual(next, state) ? state : next;
}
