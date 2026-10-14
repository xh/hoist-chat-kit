import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {range} from 'lodash';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type ChatArtifact,
    ChatArtifactRegistry,
    type ChatArtifactRegistryConfig,
    type ChatDataLoadSpec
} from './ChatArtifactRegistry';
import {CHAT_DATA_ROW_ID, type ChatDataFrame} from './ChatData';

/**
 * The artifact registry holds the result sets a chat's components show by reference. Apps rely on
 * it to load each range of rows once, however many components ask, to give every row an id that
 * a Hoist store can trust, and to report each artifact's state so a component can render it.
 */
describe('ChatArtifactRegistry', () => {
    beforeAll(() => initTestAppAsync());

    describe('add and get', () => {
        it('holds artifacts by id, and replaces one added again', () => {
            const registry = createRegistry({artifacts: [artifact('a', 3)]});
            registry.add([artifact('b', 1), {...artifact('a', 5), metadata: {v: 2}}]);

            expect(registry.get('a')).toMatchObject({totalRows: 5, metadata: {v: 2}});
            expect(registry.get('b').totalRows).toBe(1);
            expect(registry.get('c')).toBeNull();
        });

        it('refuses an artifact with no id, columns or row count', () => {
            const registry = createRegistry();
            expect(() => registry.add({id: 'x', columns: []} as any)).toThrow('totalRows');
            expect(() => registry.add({columns: [], totalRows: 1} as any)).toThrow('an id');
        });
    });

    describe('add again', () => {
        it("reads a replaced artifact's inline rows afresh", () => {
            const registry = createRegistry({artifacts: [{...artifact('a', 1), rows: rows(1)}]});
            expect(registry.getHandle('a').frame.rows).toHaveLength(1);

            registry.add({...artifact('a', 3), rows: rows(3)});

            expect(registry.getHandle('a').frame.rows).toHaveLength(3);
        });

        it("never takes a name inherited by every object as an artifact's id", () => {
            expect(createRegistry().get('constructor')).toBeNull();
            expect(createRegistry().getHandle('toString').state).toBe('missing');
        });
    });

    describe('isComplete', () => {
        it('is true only when the first page holds every row, for views over the whole result', () => {
            const registry = createRegistry({
                artifacts: [
                    {...artifact('small', 3), rows: rows(3)},
                    {...artifact('big', 300), rows: rows(300)}
                ]
            });
            expect(registry.getHandle('small').isComplete).toBe(true);
            expect(registry.getHandle('big').isComplete).toBe(false);
            expect(registry.getHandle('big', {pageSize: 300}).isComplete).toBe(true);
        });
    });

    describe('loadRangeAsync', () => {
        it('serves inline rows with no load, with a synthetic id per row', async () => {
            const loadAsync = vi.fn(),
                registry = createRegistry({
                    dataSource: {loadAsync},
                    artifacts: [{...artifact('a', 3), rows: rows(3)}]
                });

            const frame = await registry.loadRangeAsync('a', 1, 5);

            expect(frame.rows).toEqual([
                {n: 1, [CHAT_DATA_ROW_ID]: 1},
                {n: 2, [CHAT_DATA_ROW_ID]: 2}
            ]);
            expect(frame.totalRows).toBe(3);
            expect(loadAsync).not.toHaveBeenCalled();
        });

        it('loads rows past the inline ones from the data source, ending at the last row', async () => {
            const {dataSource, specs} = fakeSource(),
                registry = createRegistry({
                    dataSource,
                    artifacts: [{...artifact('a', 10), rows: rows(2)}]
                });

            const frame = await registry.loadRangeAsync('a', 5, 100);

            expect(specs).toMatchObject([{artifactId: 'a', offset: 5, limit: 5}]);
            expect(frame.rows.map(it => it[CHAT_DATA_ROW_ID])).toEqual([5, 6, 7, 8, 9]);
        });

        it('shares a load in flight, and caches it once loaded', async () => {
            const {dataSource, specs} = fakeSource(),
                registry = createRegistry({dataSource, artifacts: [artifact('a', 50)]});

            const [first, second] = await Promise.all([
                registry.loadRangeAsync('a', 0, 10),
                registry.loadRangeAsync('a', 0, 10)
            ]);
            const third = await registry.loadRangeAsync('a', 0, 10),
                other = await registry.loadRangeAsync('a', 10, 10);

            expect(specs.map(it => it.offset)).toEqual([0, 10]);
            expect(second).toBe(first);
            expect(third).toBe(first);
            expect(other.rows[0][CHAT_DATA_ROW_ID]).toBe(10);
        });

        it('loads a failed range again on the next request', async () => {
            let fail = true;
            const loadAsync = vi.fn(async (spec: ChatDataLoadSpec): Promise<ChatDataFrame> => {
                    if (fail) throw new Error('Server down');
                    return page(spec);
                }),
                registry = createRegistry({dataSource: {loadAsync}, artifacts: [artifact('a', 5)]});

            await expect(registry.loadRangeAsync('a', 0, 5)).rejects.toThrow('Server down');
            fail = false;
            await expect(registry.loadRangeAsync('a', 0, 5)).resolves.toMatchObject({totalRows: 5});
            expect(loadAsync).toHaveBeenCalledTimes(2);
        });

        it('overwrites a column that uses the reserved row id name', async () => {
            const registry = createRegistry({
                artifacts: [
                    {
                        ...artifact('a', 2),
                        rows: [{[CHAT_DATA_ROW_ID]: 'x'}, {[CHAT_DATA_ROW_ID]: 'x'}]
                    }
                ]
            });
            const {rows: loaded} = await registry.loadRangeAsync('a', 0, 2);
            expect(loaded.map(it => it[CHAT_DATA_ROW_ID])).toEqual([0, 1]);
        });

        it('keeps an id column of the data as it is', async () => {
            const registry = createRegistry({
                artifacts: [{...artifact('a', 2), rows: [{id: 7}, {id: 7}]}]
            });
            const {rows: loaded} = await registry.loadRangeAsync('a', 0, 2);
            expect(loaded).toEqual([
                {id: 7, [CHAT_DATA_ROW_ID]: 0},
                {id: 7, [CHAT_DATA_ROW_ID]: 1}
            ]);
        });

        it('serves only the inline rows when there is no data source', async () => {
            const registry = createRegistry({artifacts: [{...artifact('a', 100), rows: rows(3)}]}),
                frame = await registry.loadRangeAsync('a', 0, 10);
            expect(frame.rows).toHaveLength(3);
            expect(frame.totalRows).toBe(100);
        });

        it('rejects for an unknown artifact', async () => {
            await expect(createRegistry().loadRangeAsync('nope', 0, 1)).rejects.toThrow(
                "Unknown artifact 'nope'."
            );
        });

        it('aborts loads in flight when destroyed', async () => {
            let signal: AbortSignal;
            const registry = new ChatArtifactRegistry({
                dataSource: {
                    loadAsync: spec => {
                        signal = spec.signal;
                        return new Promise(() => {});
                    }
                },
                artifacts: [artifact('a', 5)]
            });

            void registry.loadRangeAsync('a', 0, 5);
            await Promise.resolve();
            registry.destroy();

            expect(signal.aborted).toBe(true);
        });
    });

    describe('getHandle', () => {
        it.each<[string, ChatArtifactRegistryConfig, PlainObject, PlainObject]>([
            ['missing, once the reply is over', {}, {}, {state: 'missing', totalRows: null}],
            ['waiting, while the reply streams', {}, {isStreaming: true}, {state: 'waiting'}],
            [
                'ready, with inline rows',
                {artifacts: [{...artifact('a', 3), rows: rows(3)}]},
                {pageSize: 2},
                {state: 'ready', totalRows: 3}
            ],
            [
                'loading, for rows not yet loaded',
                {dataSource: fakeSource().dataSource, artifacts: [artifact('a', 3)]},
                {},
                {state: 'loading', frame: null}
            ],
            [
                'too large, past the row limit',
                {artifacts: [artifact('a', 3000)]},
                {maxRows: 1000},
                {state: 'tooLarge', totalRows: 3000}
            ]
        ])('reports an artifact %s', (_, config, opts, expected) => {
            expect(createRegistry(config).getHandle('a', opts)).toMatchObject({
                artifactId: 'a',
                ...expected
            });
        });

        it('returns the same frame of inline rows on every call', () => {
            const registry = createRegistry({artifacts: [{...artifact('a', 3), rows: rows(3)}]});
            expect(registry.getHandle('a').frame).toBe(registry.getHandle('a').frame);
        });

        it('turns ready once its first page loads, or failed with the error', async () => {
            let fail = false;
            const registry = createRegistry({
                dataSource: {
                    loadAsync: async spec => {
                        if (fail) throw new Error('No access');
                        return page(spec);
                    }
                },
                artifacts: [artifact('a', 30), artifact('b', 30)]
            });

            await registry.getHandle('a', {pageSize: 10}).loadRangeAsync(0, 10);
            expect(registry.getHandle('a', {pageSize: 10})).toMatchObject({state: 'ready'});
            expect(registry.getHandle('a', {pageSize: 10}).frame.rows).toHaveLength(10);

            fail = true;
            await expect(
                registry.getHandle('b', {pageSize: 10}).loadRangeAsync(0, 10)
            ).rejects.toThrow();
            expect(registry.getHandle('b', {pageSize: 10})).toMatchObject({
                state: 'failed',
                error: expect.objectContaining({message: 'No access'})
            });
        });
    });

    describe('clear', () => {
        it('removes artifacts and loaded rows', async () => {
            const {dataSource, specs} = fakeSource(),
                registry = createRegistry({dataSource, artifacts: [artifact('a', 5)]});
            await registry.loadRangeAsync('a', 0, 5);

            registry.clear();
            expect(registry.get('a')).toBeNull();

            registry.add(artifact('a', 5));
            await registry.loadRangeAsync('a', 0, 5);
            expect(specs).toHaveLength(2);
        });
    });
});

//------------------
// Helpers
//------------------
function createRegistry(config: ChatArtifactRegistryConfig = {}): ChatArtifactRegistry {
    const ret = new ChatArtifactRegistry(config);
    onTestFinished(() => ret.destroy());
    return ret;
}

function artifact(id: string, totalRows: number): ChatArtifact {
    return {id, columns: [{name: 'n', type: 'integer'}], totalRows};
}

function rows(count: number): PlainObject[] {
    return range(count).map(n => ({n}));
}

function page({offset, limit}: ChatDataLoadSpec): ChatDataFrame {
    return {
        columns: [{name: 'n', type: 'integer'}],
        rows: range(offset, offset + limit).map(n => ({n})),
        totalRows: offset + limit
    };
}

function fakeSource() {
    const specs: ChatDataLoadSpec[] = [];
    return {
        specs,
        dataSource: {
            loadAsync: async (spec: ChatDataLoadSpec) => {
                specs.push(spec);
                return page(spec);
            }
        }
    };
}
