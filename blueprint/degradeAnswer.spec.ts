import {describe, expect, it} from 'vitest';
import {ARTIFACTS, portfolioCatalog, scenarioRegistry} from '../test/blueprintFixtures';
import {ARCHITECT_TOOLS} from './architect/ArchitectTools';
import {architectPrompt} from './architect/architectPrompt';
import type {Blueprint} from './Blueprint';
import {degradeAnswer} from './degradeAnswer';
import {validateBlueprint} from './validateBlueprint';

/**
 * A chat answer renders element by element: an element still arriving shows as a placeholder, and
 * one with errors as a fallback once the answer is complete, while the rest renders as written.
 */
describe('degradeAnswer', () => {
    const registry = scenarioRegistry(),
        ctx = {catalog: portfolioCatalog, registry, artifacts: ARTIFACTS, isAnswer: true},
        degrade = (bp: unknown, isComplete: boolean, maxPasses?: number) =>
            degradeAnswer(bp, {...ctx, isComplete, maxPasses}),
        componentsOf = (bp: Blueprint) =>
            Object.fromEntries(Object.entries(bp.elements).map(([id, it]) => [id, it.component]));

    /** A stack of two charts over an inline source, and a grid over an artifact. */
    const answer = (): Blueprint => ({
        sources: {
            pnl: {
                inline: {
                    fields: [
                        {name: 'trader', type: 'string', isDimension: true},
                        {name: 'pnlDay', type: 'number'}
                    ],
                    rows: [
                        {trader: 'Ann', pnlDay: -5},
                        {trader: 'Bo', pnlDay: 3}
                    ]
                }
            },
            tech: {artifact: 'art_7f2'}
        },
        root: 'tabs',
        elements: {
            tabs: {
                component: 'tabContainer',
                children: [
                    {id: 'chartA', title: 'A'},
                    {id: 'chartB', title: 'B'},
                    {id: 'grid', title: 'Grid'}
                ]
            },
            chartA: {
                component: 'chart',
                config: {source: 'pnl', type: 'bar', x: 'trader', y: ['pnlDay']}
            },
            chartB: {
                component: 'chart',
                config: {source: 'pnl', type: 'bar', x: 'trader', y: ['pnlDay']}
            },
            grid: {
                component: 'cubeGrid',
                config: {source: 'tech', groupBy: ['trader'], columnState: ['pnlDay']}
            }
        }
    });

    it('leaves a valid answer as it is, once complete', () => {
        const bp = answer();
        expect(validateBlueprint(bp, ctx)).toEqual([]);
        expect(degrade(bp, true)).toEqual(bp);
    });

    describe('while streaming and once complete', () => {
        it('shows an element with errors as a placeholder while streaming, and a fallback once complete', () => {
            const bp = answer();
            bp.elements.chartB.config.y = ['bogus'];

            const streaming = degrade(bp, false);
            expect(componentsOf(streaming)).toMatchObject({chartA: 'chart', chartB: 'placeholder'});

            const done = degrade(bp, true),
                {config} = done.elements.chartB;
            expect(done.elements.chartB.component).toBe('fallback');
            expect(config.errors.join()).toMatch(/bogus/);
            expect(JSON.parse(config.input)).toEqual(bp.elements.chartB);
            expect(done.elements.chartA).toEqual(bp.elements.chartA);
        });

        it('stands in for a child or a root that has not arrived', () => {
            const bp = answer();
            delete bp.elements.grid;
            expect(degrade(bp, false).elements.grid.component).toBe('placeholder');
            expect(degrade(bp, true).elements.grid.component).toBe('fallback');

            const noRoot = {root: 'tabs', elements: {}};
            expect(componentsOf(degrade(noRoot, false))).toEqual({tabs: 'placeholder'});
        });

        it('drops the last row of an inline source while streaming, as it may be incomplete', () => {
            const bp = answer();
            expect(degrade(bp, false).sources.pnl.inline.rows).toEqual([
                {trader: 'Ann', pnlDay: -5}
            ]);
            expect(degrade(bp, true).sources.pnl.inline.rows).toHaveLength(2);
        });
    });

    describe('errors that are not on an element', () => {
        it('replaces only the elements that read a broken source', () => {
            const bp = answer();
            bp.sources.tech = {artifact: 'art_unknown'};
            const ret = degrade(bp, true);
            expect(componentsOf(ret)).toEqual({
                tabs: 'tabContainer',
                chartA: 'chart',
                chartB: 'chart',
                grid: 'fallback'
            });
            expect(ret.sources.tech).toBeUndefined();
            expect(validateBlueprint(ret, {...ctx, allowReserved: true})).toEqual([]);
        });

        it('replaces only the elements that read a broken variable', () => {
            const bp = answer();
            bp.variables = {who: {type: 'nope'}} as any;
            bp.elements.chartB.config.filter = {field: 'trader', op: '=', value: {$var: 'who'}};
            const ret = degrade(bp, true);
            expect(componentsOf(ret)).toMatchObject({chartA: 'chart', chartB: 'fallback'});
            expect(ret.variables.who).toBeUndefined();
        });

        it('shows the whole answer as a fallback for an error it cannot place', () => {
            const bp = {...answer(), extra: 1} as any,
                ret = degrade(bp, true);
            expect(componentsOf(ret)).toEqual({root: 'fallback'});
            expect(ret.root).toBe('root');
            expect(degrade(bp, false).elements.root.component).toBe('placeholder');
            expect(degrade('not a blueprint', true).elements.root.component).toBe('fallback');
        });

        it('replaces until the answer is valid, and gives up on the whole after a few passes', () => {
            const bp = answer();
            bp.variables = {who: {type: 'string', setBy: {element: 'chartA', output: 'nope'}}};
            bp.elements.chartB.config.filter = {field: 'trader', op: '=', value: {$var: 'who'}};
            bp.elements.chartA.config.y = ['bogus'];

            const ret = degrade(bp, true);
            expect(componentsOf(ret)).toMatchObject({chartA: 'fallback', chartB: 'fallback'});
            expect(validateBlueprint(ret, {...ctx, allowReserved: true})).toEqual([]);
            expect(componentsOf(degrade(bp, true, 1))).toEqual({root: 'fallback'});
        });
    });

    describe('reserved widgets', () => {
        it('refuses a placeholder or a fallback in an authored blueprint', () => {
            const bp = answer();
            bp.elements.chartB = {component: 'fallback', config: {errors: [], input: 'null'}};
            expect(validateBlueprint(bp, ctx).map(it => it.code)).toEqual(['element.reserved']);
            expect(validateBlueprint(bp, {...ctx, allowReserved: true})).toEqual([]);
            expect(JSON.parse(degrade(bp, true).elements.chartB.config.input)).toEqual(
                bp.elements.chartB
            );
        });

        it('leaves them out of what the Architect sees', () => {
            const describe = ARCHITECT_TOOLS.find(it => it.name === 'describe_registry'),
                target = {registry} as any,
                names = (describe.run({kind: 'widget'}, target) as any[]).map(it => it.name);
            expect(names).toContain('chart');
            expect(names).not.toContain('fallback');
            expect(describe.run({kind: 'widget', names: ['placeholder']}, target)).toEqual({
                placeholder: "unknown widget 'placeholder'"
            });
            expect(architectPrompt({catalogs: [portfolioCatalog], registry})).not.toMatch(
                /placeholder|fallback/
            );
        });
    });
});
