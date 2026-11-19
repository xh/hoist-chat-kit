import type {LoadSpec, PlainObject} from '@xh/hoist/core';
import type {FilterSpec, SuppliedAggregate} from '@xh/hoist/data';

/** What a source asks its data provider for: one dataset, with every widget's demand merged. */
export interface BlueprintDataRequest {
    dataset: string;
    /** The dataset's parameters, as resolved values. Never bindings. */
    params: Record<string, unknown>;
    /** Each field by name, or a field instance, whose `name` is its column key in each row. */
    fields: (string | BlueprintFieldInstance)[];
    /**
     * The grouping sets that need values from the server, for the source's `"server"` fields: each
     * a sorted list of dimensions, and `[]` for the grand total. Empty if the request names no
     * server field.
     */
    groupBy: string[][];
    /** The source filter, as a Hoist filter in JSON form, with bindings resolved. */
    filter?: FilterSpec;
}

/** An instance of a parameterized field, such as a return over a period. */
export interface BlueprintFieldInstance {
    name: string;
    field: string;
    params: Record<string, unknown>;
}

/**
 * A change to a source's rows and server roll-ups. `replace` swaps every row, and its `aggregates`
 * replace every supplied value. Otherwise `aggregates` merge into those already held, field by
 * field. Rows carry an `id`, stable across updates, which `update` matches and `remove` lists.
 */
export interface BlueprintDataUpdate {
    replace?: PlainObject[];
    add?: PlainObject[];
    update?: PlainObject[];
    remove?: string[];
    aggregates?: SuppliedAggregate[];
}

/** The rows of a request, with the server's roll-ups for its grouping sets. */
export interface BlueprintDataResult {
    rows: PlainObject[];
    aggregates?: SuppliedAggregate[];
}

/**
 * The rows of the artifacts a chat answer reads, such as the results of the Architect's queries.
 * The chat that holds the answer supplies it.
 */
export interface BlueprintArtifactProvider {
    /**
     * An artifact's rows, keyed by the field names of its dataset, and the size of the result. A
     * provider that caps what it delivers returns fewer rows than `totalRows`, and the source then
     * shows the result as too large. Null for an artifact whose rows are no longer available.
     */
    loadArtifactAsync(id: string): Promise<{rows: PlainObject[]; totalRows: number} | null>;
}

/**
 * The app's data layer, as blueprint sources see it. Everything behind a dataset belongs to the
 * app: queries, joins, server aggregation and caching.
 */
export interface BlueprintDataProvider {
    /** Load leaf rows for a request. Used when the provider cannot `subscribe`. */
    loadAsync(req: BlueprintDataRequest, loadSpec?: LoadSpec): Promise<BlueprintDataResult>;

    /**
     * Stream a request's rows. The first update is `{replace: rows}`, the whole snapshot, and
     * changes follow. A provider may send `replace` again at any time, as after a reconnect. A
     * source with a subscribing provider never calls `loadAsync`.
     *
     * @returns a function that ends the subscription.
     */
    subscribe?(req: BlueprintDataRequest, onUpdate: (u: BlueprintDataUpdate) => void): () => void;

    /**
     * Load the server's roll-ups for more grouping sets of a request already loaded or subscribed:
     * `req.groupBy` lists only the new sets. A subscribing provider adds them to the live pushes of
     * its subscription for the request. Without this method, a source loads its request again.
     */
    loadAggregatesAsync?(
        req: BlueprintDataRequest,
        loadSpec?: LoadSpec
    ): Promise<{aggregates: SuppliedAggregate[]}>;
}
