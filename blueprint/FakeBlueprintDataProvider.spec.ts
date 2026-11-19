import {initTestAppAsync} from '@xh/hoist/test-support';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {portfolioCatalog} from '../test/blueprintFixtures';
import type {BlueprintDataRequest, BlueprintDataUpdate} from './BlueprintDataProvider';
import {FakeBlueprintDataProvider} from './FakeBlueprintDataProvider';

/**
 * The fake provider lets the library and apps run blueprints before a real data layer exists. It
 * must honor the provider contract: stable ids, the requested fields, and a subscription that
 * starts with the whole snapshot.
 */
describe('FakeBlueprintDataProvider', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const provider = new FakeBlueprintDataProvider({
            catalog: portfolioCatalog,
            updateInterval: 100
        }),
        request = (
            asOf: string,
            extra: Partial<BlueprintDataRequest> = {}
        ): BlueprintDataRequest => ({
            dataset: 'positions',
            params: {asOf},
            fields: ['mktVal', 'pnlDay'],
            groupBy: [['sector']],
            ...extra
        });

    it('returns the same rows for the same request, each with an id', async () => {
        const {rows: a} = await provider.loadAsync(request('2026-07-01')),
            {rows: b} = await provider.loadAsync(request('2026-07-01')),
            {rows: c} = await provider.loadAsync(request('2026-07-02'));
        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
        expect(new Set(a.map(it => it.id)).size).toBe(a.length);
    });

    it('returns the requested fields only, plus id', async () => {
        const {rows} = await provider.loadAsync(request('2026-07-01'));
        expect(Object.keys(rows[0]).sort()).toEqual(['id', 'mktVal', 'pnlDay']);
    });

    it('applies the source filter', async () => {
        const {rows} = await provider.loadAsync(
            request('2026-07-01', {
                fields: ['sector', 'mktVal'],
                filter: {field: 'sector', op: '=', value: 'Energy'}
            })
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every(it => it.sector === 'Energy')).toBe(true);
    });

    it('returns a field instance under its name', async () => {
        const {rows} = await provider.loadAsync(
            request('2026-07-01', {
                fields: [{name: 'down10', field: 'shockedPnl', params: {shock: -0.1}}]
            })
        );
        expect(rows[0]).toHaveProperty('down10');
        expect(rows[0]).not.toHaveProperty('shockedPnl');
    });

    it('starts a subscription with the snapshot, then updates rows live for today', async () => {
        vi.useFakeTimers();
        const updates: BlueprintDataUpdate[] = [],
            stop = provider.subscribe(request(LocalDate.currentAppDay().isoString), u =>
                updates.push(u)
            );

        await vi.advanceTimersByTimeAsync(250);
        expect(updates[0].replace.length).toBeGreaterThan(0);
        expect(updates.length).toBeGreaterThan(1);
        expect(updates[1].update.length).toBeGreaterThan(0);

        stop();
        const count = updates.length;
        await vi.advanceTimersByTimeAsync(500);
        expect(updates).toHaveLength(count);
    });

    it('sends no updates for a past date', async () => {
        vi.useFakeTimers();
        const updates: BlueprintDataUpdate[] = [],
            stop = provider.subscribe(request('2026-07-01'), u => updates.push(u));
        await vi.advanceTimersByTimeAsync(500);
        expect(updates).toHaveLength(1);
        stop();
    });

    describe('server roll-ups', () => {
        const varRequest = (groupBy: string[][]) =>
            request('2026-07-01', {fields: ['sector', 'var95', 'mktVal'], groupBy});

        it("supplies values of the request's server fields for each grouping set", async () => {
            const {rows, aggregates} = await provider.loadAsync(varRequest([[], ['sector']])),
                energy = rows.filter(it => it.sector === 'Energy');

            expect(aggregates.find(it => Object.keys(it.dims).length === 0)).toBeTruthy();
            const supplied = aggregates.find(it => it.dims.sector === 'Energy');
            expect(Object.keys(supplied.values)).toEqual(['var95']);
            expect(supplied.values.var95).toBeCloseTo(
                energy.reduce((total, it) => total + it.var95, 0) * 0.8
            );
        });

        it('supplies nothing for a request with no server field', async () => {
            const {aggregates} = await provider.loadAsync(
                request('2026-07-01', {groupBy: [['sector']]})
            );
            expect(aggregates).toEqual([]);
        });

        it('adds the sets it is asked for to the live pushes of a subscription', async () => {
            vi.useFakeTimers();
            const req = {
                    ...varRequest([[]]),
                    params: {asOf: LocalDate.currentAppDay().isoString}
                },
                updates: BlueprintDataUpdate[] = [],
                stop = provider.subscribe(req, u => updates.push(u));
            await vi.advanceTimersByTimeAsync(0);
            expect(updates[0].aggregates.map(it => it.dims)).toEqual([{}]);

            await provider.loadAggregatesAsync({...req, groupBy: [['sector']]});
            await vi.advanceTimersByTimeAsync(150);
            const pushed = updates.at(-1).aggregates;
            expect(pushed.some(it => 'sector' in it.dims)).toBe(true);
            stop();
        });
    });
});
