import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, omit} from 'lodash';
import {
    type Blueprint,
    type BlueprintArtifactProvider,
    DataCatalog,
    type DataCatalogJson,
    type FieldDef
} from '../../blueprint';
import type {ChatArtifact, ChatArtifactRegistry} from '../ChatArtifactRegistry';
import {CHAT_DATA_ROW_ID, type ChatDataColumn} from '../ChatData';
import {toFieldFormat} from './answerBlueprint';

/**
 * Most rows an answer loads from one artifact into a source. A larger artifact shows as too large:
 * part of it would give wrong totals in a chart or a grouped grid.
 */
export const ANSWER_MAX_ARTIFACT_ROWS = 5_000;

/**
 * The rows of the chat's artifacts, for an answer's artifact sources. An artifact the chat holds
 * whole loads from its registry. One kept without its rows, as a query's result is, runs the
 * query's request again through `query`, so its rows are current. Any other that the registry
 * cannot load, or one the chat no longer holds, is no longer available. A result of more than
 * `maxRows` rows loads none, and shows as too large.
 */
export function chatArtifactProvider(
    registry: ChatArtifactRegistry,
    opts: {
        query?: (request: PlainObject) => Promise<{rows: PlainObject[]}>;
        maxRows?: number;
    }
): BlueprintArtifactProvider {
    const {query, maxRows = ANSWER_MAX_ARTIFACT_ROWS} = opts;
    return {
        async loadArtifactAsync(id: string) {
            const artifact = registry.get(id);
            if (!artifact) return null;
            if (artifact.totalRows > maxRows) return {rows: [], totalRows: artifact.totalRows};

            const isWhole = (artifact.rows?.length ?? 0) >= artifact.totalRows,
                request = artifact.metadata?.request;
            if (!isWhole && isPlainObject(request) && query) {
                const {rows} = await query(request);
                return rows.length > maxRows
                    ? {rows: [], totalRows: rows.length}
                    : {rows, totalRows: rows.length};
            }
            try {
                const {rows} = await registry.loadRangeAsync(id, 0, artifact.totalRows);
                // A registry with no source of its own for the rows gives fewer than it holds.
                if (rows.length < artifact.totalRows) return null;
                return {
                    rows: rows.map(it => omit(it, CHAT_DATA_ROW_ID)),
                    totalRows: artifact.totalRows
                };
            } catch {
                return null;
            }
        }
    };
}

/**
 * The datasets an answer reads, and the dataset behind each of its artifacts. An artifact whose
 * metadata names one of the app's datasets reads through it. Any other takes a dataset of its own
 * columns, named `artifact:<id>`, local to the answer. An artifact the chat does not hold yet maps
 * to nothing, and its source reports it as unknown.
 */
export function answerDataFor(
    blueprint: Blueprint,
    ctx: {dataCatalog: DataCatalog; registry: ChatArtifactRegistry}
): {dataCatalog: DataCatalog; artifacts: Record<string, string>} {
    const {dataCatalog, registry} = ctx,
        artifacts: Record<string, string> = {},
        own: DataCatalogJson['datasets'] = {};

    Object.values(blueprint?.sources ?? {}).forEach((it: PlainObject) => {
        const artifact = typeof it?.artifact === 'string' ? registry.get(it.artifact) : null;
        if (!artifact) return;
        const named = artifact.metadata?.dataset;
        if (typeof named === 'string' && dataCatalog.getDataset(named)) {
            artifacts[artifact.id] = named;
        } else {
            const name = `artifact:${artifact.id}`;
            artifacts[artifact.id] = name;
            own[name] = toDataset(artifact);
        }
    });

    if (!Object.keys(own).length) return {dataCatalog, artifacts};
    const {json} = dataCatalog;
    return {
        dataCatalog: new DataCatalog({...json, datasets: {...json.datasets, ...own}}),
        artifacts
    };
}

//------------------
// Implementation
//------------------
function toDataset(artifact: ChatArtifact): DataCatalogJson['datasets'][string] {
    return {
        label: artifact.id,
        params: {},
        fields: artifact.columns.map(toField)
    };
}

function toField(column: ChatDataColumn): FieldDef {
    const type = COLUMN_TYPES[column.type] ?? 'string';
    return {
        name: column.name,
        ...(column.label ? {label: column.label} : {}),
        type,
        ...(type === 'number' ? toFieldFormat(column.format, column.decimals, false) : {})
    } as FieldDef;
}

const COLUMN_TYPES: Record<string, string> = {
    string: 'string',
    number: 'number',
    integer: 'int',
    date: 'localDate',
    datetime: 'date',
    boolean: 'bool'
};
