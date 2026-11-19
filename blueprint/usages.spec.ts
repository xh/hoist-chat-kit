import {describe, expect, it} from 'vitest';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry,
    weatherCatalog
} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {BlueprintRegistry} from './BlueprintRegistry';
import {fieldUsages, registryUsages} from './usages';

/**
 * Which fields and registry entries a blueprint uses, and where: what a panel marks as used, and
 * what the Architect's find_usages answers.
 */
describe('usages', () => {
    const p3 = loadBlueprint('p3-morning-report.json'),
        w2 = loadBlueprint('w2-two-cities.json'),
        usedNames = (usages: ReturnType<typeof fieldUsages>, dataset: string) =>
            Object.keys(usages[dataset] ?? {}).sort();

    describe('fields', () => {
        const usages = fieldUsages(p3, portfolioCatalog);

        it("marks each widget's fields on its source's dataset", () => {
            expect(usedNames(usages, 'positions')).toEqual(
                expect.arrayContaining(['mktVal', 'pnlDay', 'pnlMtd', 'pnlYtd', 'sector', 'region'])
            );
            expect(usedNames(usages, 'prices')).toEqual(['close', 'day']);
        });

        it('records every place a field is used', () => {
            expect(usages.positions.pnlDay.map(it => it.path)).toEqual(
                expect.arrayContaining([
                    '/elements/headline/config/cards/1/field',
                    '/elements/sectorChart/config/y/0'
                ])
            );
        });

        it('follows variables to the dataset that reads them', () => {
            expect(usedNames(usages, 'positions')).toEqual(
                expect.arrayContaining(['fund', 'strategy', 'trader', 'symbol'])
            );
            expect(usedNames(usages, 'orders')).not.toContain('sector');
            expect(usages.positions.symbol.map(it => it.path)).toContain(
                '/variables/symbol/setBy/field'
            );
        });

        it('marks a field instance on its base field', () => {
            expect(usages.positions.return).toEqual([
                expect.objectContaining({
                    path: '/sources/positions/fields/retYtd',
                    instance: 'retYtd'
                })
            ]);
        });

        it('marks fields across sources over the same dataset', () => {
            const weather = fieldUsages(w2, weatherCatalog);
            expect(usedNames(weather, 'weather')).toEqual(
                expect.arrayContaining(['precipProbability', 'temp', 'time'])
            );
            expect(weather.weather.temp.length).toBeGreaterThan(1);
        });

        it('marks nothing for no blueprint', () => {
            expect(fieldUsages(null, portfolioCatalog)).toEqual({});
        });

        it('finds no field through a name an object inherits', () => {
            const bp = {
                root: 'g',
                sources: {s: {dataset: 'positions', params: {asOf: '2026-11-19'}}},
                elements: {g: {component: 'cubeGrid', config: {source: 's', groupBy: ['toString']}}}
            } as Blueprint;
            expect(fieldUsages(bp, portfolioCatalog)).toEqual({});
        });
    });

    describe('registry entries', () => {
        const registry = scenarioRegistry(),
            usages = registryUsages(p3, registry, portfolioCatalog);

        it('marks the widgets each element is', () => {
            expect(usages['widget:statCardStrip']).toEqual(['/elements/headline/component']);
            expect(Object.keys(usages).filter(it => it.startsWith('widget:'))).toEqual(
                expect.arrayContaining(['widget:cubeGrid', 'widget:chart', 'widget:tabContainer'])
            );
        });

        it('marks resolvers, actions and variable types', () => {
            expect(usages['resolver:userFund']).toEqual(['/variables/fund/default/resolver']);
            expect(usages['variableType:fund']).toEqual(['/variables/fund/type']);
            expect(Object.keys(usages).some(it => it.startsWith('action:'))).toBe(true);
            expect(usages['action:openUrl']).toBeUndefined();
        });

        it('marks a renderer through the fields that use it', () => {
            const weather = registryUsages(w2, registry, weatherCatalog);
            expect(weather['renderer:weatherIcon']).toEqual(
                expect.arrayContaining(['weather.conditions'])
            );
        });

        it('marks a presentation an element draws with', () => {
            const bp = {
                root: 'c',
                sources: {s: {dataset: 'positions', params: {asOf: '2026-11-19'}}},
                elements: {
                    c: {
                        component: 'chart',
                        config: {source: 's', x: 'sector', y: ['pnlDay'], presentation: 'card'}
                    }
                }
            } as Blueprint;
            expect(
                registryUsages(bp, new BlueprintRegistry(), portfolioCatalog)[
                    'presentation:chart.card'
                ]
            ).toEqual(['/elements/c/config/presentation']);
        });
    });
});
