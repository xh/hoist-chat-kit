import {HoistBase, type PlainObject} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {castArray, isArray, isFinite, isString} from 'lodash';
import {CHAT_DATA_ROW_ID, type ChatDataColumn, type ChatDataFrame} from './ChatData';

/**
 * A result set that a tool produced, for a component to show by reference. The model names the
 * artifact by its id, and never writes the rows. The first rows may come inline, and a
 * {@link ChatDataSource} loads the rest on demand.
 *
 * This is the value of an `xh.chat.artifact` event, and the shape of each entry under
 * `metadata.artifacts` of a tool result or a stored message.
 */
export interface ChatArtifact {
    /** Id the model refers to the artifact by, unique within the chat. */
    id: string;

    /** The columns, in display order. */
    columns: ChatDataColumn[];

    /** The first rows of the result, if sent inline. */
    rows?: PlainObject[];

    /** Number of rows in the whole result. */
    totalRows: number;

    /** App data about the artifact, such as the query that produced it. */
    metadata?: PlainObject;
}

/** A request for a page of an artifact's rows - see {@link ChatDataSource}. */
export interface ChatDataLoadSpec {
    /** Id of the artifact. */
    artifactId: string;

    /** Index of the first row to load. */
    offset: number;

    /** Number of rows to load - never past the end of the result. */
    limit: number;

    /** Aborts when the registry is destroyed. */
    signal: AbortSignal;
}

/**
 * Loads the rows of artifacts that are not yet in the browser, a page at a time - typically from
 * the app's server, which keeps the result sets its tools produce. Return a column-oriented
 * response through {@link fromColumnar}.
 */
export interface ChatDataSource {
    loadAsync(spec: ChatDataLoadSpec): Promise<ChatDataFrame>;
}

/**
 * The state of the data behind a reference prop:
 *
 *  - `waiting` - no artifact has that id yet, and the reply is still streaming, so it may arrive.
 *  - `loading` - the first page of rows is loading from the data source.
 *  - `ready` - the first page of rows is in `frame`.
 *  - `missing` - no artifact has that id, and the reply is over.
 *  - `tooLarge` - the artifact has more rows than the component can show.
 *  - `failed` - the first page failed to load, with the reason in `error`.
 */
export type ChatDataHandleState =
    'waiting' | 'loading' | 'ready' | 'missing' | 'tooLarge' | 'failed';

/**
 * The data behind one reference prop of a component - see {@link ChatUiComponentSpec.dataProps}.
 * The catalog resolves each reference prop to a handle, passed to the component in
 * `context.data`, and loads its first page. A component renders by `state`, and pages through
 * the rest with `loadRangeAsync`.
 */
export interface ChatDataHandle {
    /** Id of the artifact, as the model wrote it. */
    artifactId: string;

    /** Where the data is - see {@link ChatDataHandleState}. */
    state: ChatDataHandleState;

    /** The artifact, once known - its columns and metadata. Else null. */
    artifact: ChatArtifact;

    /** The first page of rows, once `ready`. Else null. */
    frame: ChatDataFrame;

    /** Number of rows in the whole result, once the artifact is known. Else null. */
    totalRows: number;

    /** Why the first page failed to load, if `failed`. Else null. */
    error: unknown;

    /** Load a range of rows, as {@link ChatArtifactRegistry.loadRangeAsync}. */
    loadRangeAsync(offset: number, limit: number): Promise<ChatDataFrame>;
}

/** Options for {@link ChatArtifactRegistry.getHandle}. */
export interface ChatDataHandleOptions {
    /** Rows in the first page. Default 100. */
    pageSize?: number;

    /** Most rows the component can show. A larger result is `tooLarge`. Default no limit. */
    maxRows?: number;

    /** True while the reply that refers to the artifact streams. Default false. */
    isStreaming?: boolean;
}

/** Configuration for a {@link ChatArtifactRegistry}. */
export interface ChatArtifactRegistryConfig {
    /** Loads rows that are not yet in the browser. Without one, only inline rows show. */
    dataSource?: ChatDataSource;

    /** Artifacts to start with. */
    artifacts?: ChatArtifact[];
}

/**
 * The artifacts of one chat, by id, and the rows loaded for them. Components that take data by
 * reference read it here, through a {@link ChatDataHandle}, so that large results stay out of the
 * model's context and the user sees numbers straight from the source.
 *
 * Add artifacts as tools produce them, and as stored messages restore. Rows load through the
 * app's {@link ChatDataSource}. Each range loads once: a second request for a range in flight
 * shares the first, and a loaded range is kept for the life of the registry. An artifact's rows
 * must not change once added.
 *
 * Give a {@link ChatUiCatalog} the registry of each chat with its `artifacts` config.
 */
export class ChatArtifactRegistry extends HoistBase {
    /** Loads rows that are not yet in the browser, or null. */
    readonly dataSource: ChatDataSource;

    constructor(config: ChatArtifactRegistryConfig = {}) {
        super();
        this.dataSource = config.dataSource ?? null;
        if (config.artifacts) this.add(config.artifacts);
    }

    /**
     * Add artifacts, or replace those with the same ids. Rows already loaded for an id are kept.
     */
    @action
    add(artifacts: ChatArtifact | ChatArtifact[]) {
        const added = castArray(artifacts);
        added.forEach(it =>
            throwIf(
                !isString(it?.id) || !isArray(it.columns) || !isFinite(it.totalRows),
                'A ChatArtifact requires an id, columns and totalRows.'
            )
        );
        this.artifacts = {
            ...this.artifacts,
            ...Object.fromEntries(added.map(it => [it.id, it]))
        };
    }

    /** An artifact by id, or null. Observable. */
    get(id: string): ChatArtifact {
        return this.artifacts[id] ?? null;
    }

    /**
     * Load a range of an artifact's rows. Rows sent inline with the artifact need no load, nor do
     * any rows without a data source - the range then holds the inline rows it covers. Else the
     * data source loads the range, once: a request for a range in flight or loaded returns its
     * result.
     *
     * @param id - id of the artifact.
     * @param offset - index of the first row.
     * @param limit - number of rows. The range stops at the end of the result.
     * @returns the rows, each with a synthetic id in {@link CHAT_DATA_ROW_ID}, with the artifact's
     *      columns and total row count. Rejects for an unknown artifact, or a failed load. A failed
     *      range loads again on the next request.
     */
    async loadRangeAsync(id: string, offset: number, limit: number): Promise<ChatDataFrame> {
        const artifact = this.get(id);
        throwIf(!artifact, `Unknown artifact '${id}'.`);

        const range = this.getRange(artifact, offset, limit);
        if (range.isInline) return this.getInlineFrame(artifact, range);

        let load = this.loads.get(range.key);
        if (!load) {
            load = this.fetchRangeAsync(artifact, range);
            this.loads.set(range.key, load);
        }
        return load;
    }

    /**
     * The data behind a reference prop - the artifact's state and first page of rows. Reads
     * observable state only, and loads nothing, so that a component may call it as it renders.
     * Load the first page of a handle in `loading` state with its `loadRangeAsync(0, pageSize)`.
     *
     * @param id - id of the artifact.
     * @param opts - the first page size and row limit of the component, and whether the reply
     *      still streams.
     */
    getHandle(id: string, opts: ChatDataHandleOptions = {}): ChatDataHandle {
        const {pageSize = DEFAULT_PAGE_SIZE, maxRows = null, isStreaming = false} = opts,
            artifact = this.get(id),
            handle: ChatDataHandle = {
                artifactId: id,
                state: null,
                artifact,
                frame: null,
                totalRows: artifact?.totalRows ?? null,
                error: null,
                loadRangeAsync: (offset, limit) => this.loadRangeAsync(id, offset, limit)
            };

        if (!artifact) return {...handle, state: isStreaming ? 'waiting' : 'missing'};
        if (maxRows != null && artifact.totalRows > maxRows) return {...handle, state: 'tooLarge'};

        const range = this.getRange(artifact, 0, pageSize);
        if (range.isInline) {
            return {...handle, state: 'ready', frame: this.getInlineFrame(artifact, range)};
        }

        const load = this.loadStates[range.key];
        if (load?.frame) return {...handle, state: 'ready', frame: load.frame};
        if (load?.error) return {...handle, state: 'failed', error: load.error};
        return {...handle, state: 'loading'};
    }

    /** Remove all artifacts and loaded rows, and abort loads in flight. */
    @action
    clear() {
        this.abortController.abort();
        this.abortController = new AbortController();
        this.artifacts = {};
        this.loadStates = {};
        this.loads.clear();
        this.inlineFrames.clear();
    }

    override destroy() {
        this.abortController.abort();
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    @observableRef private accessor artifacts: Record<string, ChatArtifact> = {};

    // State of each range loaded from the data source, by range key - observable, for handles.
    @observableRef private accessor loadStates: Record<string, ChatDataLoadState> = {};

    // Loads from the data source, by range key, in flight or done - shared by repeat requests.
    private readonly loads = new Map<string, Promise<ChatDataFrame>>();

    // Frames over inline rows, by range key, so that each render of a handle sees the same frame.
    private readonly inlineFrames = new Map<string, ChatDataFrame>();

    private abortController = new AbortController();

    private getRange(artifact: ChatArtifact, offset: number, limit: number): ChatDataRange {
        const start = Math.max(0, offset),
            end = Math.max(start, Math.min(start + limit, artifact.totalRows)),
            inlineCount = artifact.rows?.length ?? 0;
        return {
            key: `${artifact.id}|${start}|${end}`,
            start,
            end,
            isInline: end <= inlineCount || !this.dataSource
        };
    }

    private getInlineFrame(artifact: ChatArtifact, range: ChatDataRange): ChatDataFrame {
        let ret = this.inlineFrames.get(range.key);
        if (!ret) {
            const rows = (artifact.rows ?? []).slice(range.start, range.end);
            ret = this.createFrame(artifact, artifact.columns, rows, range.start);
            this.inlineFrames.set(range.key, ret);
        }
        return ret;
    }

    private async fetchRangeAsync(
        artifact: ChatArtifact,
        range: ChatDataRange
    ): Promise<ChatDataFrame> {
        const {key, start, end} = range,
            {signal} = this.abortController;

        this.setLoadState(key, {frame: null, error: null});
        try {
            const loaded = await this.dataSource.loadAsync({
                    artifactId: artifact.id,
                    offset: start,
                    limit: end - start,
                    signal
                }),
                frame = this.createFrame(
                    artifact,
                    loaded.columns?.length ? loaded.columns : artifact.columns,
                    loaded.rows ?? [],
                    start
                );
            if (!signal.aborted) this.setLoadState(key, {frame, error: null});
            return frame;
        } catch (e) {
            if (!signal.aborted) {
                this.loads.delete(key);
                this.setLoadState(key, {frame: null, error: e});
            }
            throw e;
        }
    }

    private createFrame(
        artifact: ChatArtifact,
        columns: ChatDataColumn[],
        rows: PlainObject[],
        offset: number
    ): ChatDataFrame {
        return {
            columns,
            rows: rows.map((row, idx) => ({...row, [CHAT_DATA_ROW_ID]: offset + idx})),
            totalRows: artifact.totalRows
        };
    }

    @action
    private setLoadState(key: string, state: ChatDataLoadState) {
        this.loadStates = {...this.loadStates, [key]: state};
    }
}

//------------------
// Implementation
//------------------
const DEFAULT_PAGE_SIZE = 100;

interface ChatDataRange {
    key: string;
    start: number;
    end: number;
    isInline: boolean;
}

interface ChatDataLoadState {
    frame: ChatDataFrame;
    error: unknown;
}
