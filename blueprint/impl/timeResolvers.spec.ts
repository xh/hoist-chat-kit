import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {portfolioCatalog} from '../../test/blueprintFixtures';
import {BlueprintModel} from '../BlueprintModel';
import {BlueprintRegistry} from '../BlueprintRegistry';

/**
 * A date range resolves to its start and end against an as-of date, and a period shifts a date by
 * business days, or by calendar days on request.
 */
describe('time resolvers', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const registry = new BlueprintRegistry(),
        run = (name: string, args: object) => registry.resolvers[name].resolve(args, {registry});

    it("gives a date range's first and last days as of a date", () => {
        const range = {kind: 'preset', token: 'mtd'};
        expect(run('rangeStart', {range, asOf: '2026-03-18'})).toBe('2026-03-01');
        expect(run('rangeEnd', {range, asOf: '2026-03-18'})).toBe('2026-03-18');
        expect(run('rangeStart', {range: 'prevMonth', asOf: '2026-03-18'})).toBe('2026-02-01');
    });

    it('resolves an app preset the registry holds', () => {
        const reg = new BlueprintRegistry();
        reg.addDateRangePresets({
            token: 'acme.sinceFeb',
            label: 'Since Feb',
            resolve: ctx => ({
                start: ctx.anchorDate.startOfYear().add(1, 'months'),
                end: ctx.anchorDate
            })
        });
        expect(
            reg.resolvers.rangeStart.resolve(
                {range: 'acme.sinceFeb', asOf: '2026-03-18'},
                {registry: reg}
            )
        ).toBe('2026-02-01');
    });

    it('shifts a date back by a period, landing on a business day, or forward with +', () => {
        // 2026-03-16 is a Monday.
        expect(run('periodStart', {asOf: '2026-03-16', period: '5D'})).toBe('2026-03-09');
        expect(run('periodStart', {asOf: '2026-03-16', period: '1M'})).toBe('2026-02-16');
        expect(run('periodEnd', {asOf: '2026-03-13', period: '+1D'})).toBe('2026-03-16');
        expect(run('periodStart', {asOf: '2026-03-16', period: '5D', calendar: 'calendar'})).toBe(
            '2026-03-11'
        );
    });

    it("counts in a bound period variable's calendar, unless the call names one", () => {
        const model = new BlueprintModel({
            blueprint: {
                schema: {blueprint: 1},
                variables: {
                    window: {type: 'period', default: {value: '5D'}, calendar: 'calendar'}
                },
                root: 'note',
                elements: {note: {component: 'markdown', config: {text: 'x'}}}
            },
            catalog: portfolioCatalog,
            registry,
            dataProvider: null
        });
        const call = (args: object) =>
            model.runResolver({
                resolver: 'periodStart',
                args: {asOf: '2026-03-16', period: {$var: 'window'}, ...args}
            });
        expect(call({})).toBe('2026-03-11');
        expect(call({calendar: 'business'})).toBe('2026-03-09');
        model.destroy();
    });

    it('gives null for a range or period it cannot read', () => {
        expect(run('rangeStart', {range: 'nope', asOf: '2026-03-18'})).toBeNull();
        expect(run('periodStart', {asOf: '2026-03-16', period: '3m'})).toBeNull();
    });
});
