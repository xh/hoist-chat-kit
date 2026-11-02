import {logWarn} from '@xh/hoist/utils/js';
import {isArray, isFinite, isString, keyBy} from 'lodash';
import type {ChatArtifact} from '../genui/ChatArtifactRegistry';

/**
 * True for a value with the shape of a {@link ChatArtifact} - an id, columns and a row count.
 * @internal
 */
export function isChatArtifact(value: any): value is ChatArtifact {
    return isString(value?.id) && isArray(value.columns) && isFinite(value.totalRows);
}

/**
 * Artifacts merged by id, the later of two with one id replacing the earlier in its place. Values
 * that are not artifacts - which a backend may send - are dropped, with a warning.
 * @internal
 */
export function mergeArtifacts(current: ChatArtifact[], added: unknown): ChatArtifact[] {
    const list = isArray(added) ? added : [added],
        valid = list.filter(isChatArtifact);
    if (valid.length < list.length) {
        logWarn('Ignored an artifact with no id, columns or totalRows', 'ChatArtifactRegistry');
    }
    if (!valid.length) return current ?? [];

    const byId = keyBy(valid, 'id'),
        kept = (current ?? []).map(it => byId[it.id] ?? it),
        keptIds = new Set(kept.map(it => it.id));
    return [...kept, ...Object.values(byId).filter(it => !keptIds.has(it.id))];
}
