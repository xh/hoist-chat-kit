import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry,
    weatherCatalog
} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import type {BlueprintDataProvider} from './BlueprintDataProvider';
import {BlueprintModel, type BlueprintModelConfig} from './BlueprintModel';
import {isAllowedUrl} from '../impl/UrlUtils';

/**
 * Actions are typed and checked. A list runs as steps, all checked before the first runs, each
 * after the one before finishes. Every action describes itself, and runs with the values it
 * describes.
 */
describe('BlueprintModel actions', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const provider: BlueprintDataProvider = {
        loadAsync: async () => ({rows: []}),
        subscribe: vi.fn(() => () => {})
    };

    function open(
        blueprint: Blueprint = loadBlueprint('p3-morning-report.json'),
        config: Partial<BlueprintModelConfig> = {}
    ) {
        const ret = new BlueprintModel({
            blueprint,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider,
            ...config
        });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    function stubToasts() {
        const toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null);
        onTestFinished(() => toast.mockRestore());
        return toast;
    }

    const winners = {
        type: 'setVariable',
        variable: 'pnlFilter',
        value: {field: 'pnlDay', op: '>', value: 0}
    };

    it('runs a step that sets a variable, and describes it', async () => {
        const model = open();
        expect(model.describeAction(winners)).toBe('Set pnlFilter to pnlDay > 0');
        expect(await model.runActionsAsync(winners)).toBe(true);
        expect(model.getVariable('pnlFilter').value).toEqual(winners.value);
    });

    it('runs a list of steps in order', async () => {
        const model = open();
        await model.runActionsAsync([winners, {type: 'resetVariable', variable: 'pnlFilter'}]);
        expect(model.getVariable('pnlFilter').value).toBeNull();
    });

    it('checks every step before the first runs, and says why it refused', async () => {
        const toast = stubToasts(),
            model = open();
        expect(
            await model.runActionsAsync([
                winners,
                {type: 'setVariable', variable: 'selection', value: null}
            ])
        ).toBe(false);
        expect(model.getVariable('pnlFilter').value).toBeNull();
        expect(toast).toHaveBeenCalledWith(expect.stringMatching(/selection/));
    });

    it('refuses a route the app does not have, before any step runs', async () => {
        stubToasts();
        const model = open(),
            hasRoute = vi.spyOn(XH, 'hasRoute').mockReturnValue(false),
            navigate = vi.spyOn(XH, 'navigate').mockReturnValue(null);
        onTestFinished(() => {
            hasRoute.mockRestore();
            navigate.mockRestore();
        });
        expect(await model.runActionsAsync([winners, {type: 'navigate', route: 'nope'}])).toBe(
            false
        );
        expect(model.getVariable('pnlFilter').value).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
    });

    describe('openUrl', () => {
        const run = async (url: string) => {
            stubToasts();
            const model = open(undefined, {urlAllowList: ['https://a.com/reports']}),
                opener = vi.spyOn(window, 'open').mockReturnValue(null);
            onTestFinished(() => opener.mockRestore());
            const ok = await model.runActionsAsync({type: 'openUrl', url});
            return {ok, opener};
        };

        it('opens a URL under an allowed origin and path, with noopener', async () => {
            const {ok, opener} = await run('https://a.com/reports/daily');
            expect(ok).toBe(true);
            expect(opener).toHaveBeenCalledWith(
                'https://a.com/reports/daily',
                '_blank',
                'noopener'
            );
        });

        it.each([
            ['another host that starts the same', 'https://a.com.evil.com/reports'],
            ['another path on the origin', 'https://a.com/other'],
            ['a path that only starts with the allowed one', 'https://a.com/reportsX'],
            ['another scheme', 'http://a.com/reports'],
            ['a URL that does not parse', 'not a url']
        ])('refuses %s', async (_, url) => {
            const {ok, opener} = await run(url);
            expect(ok).toBe(false);
            expect(opener).not.toHaveBeenCalled();
        });

        it('takes an origin alone as any path on that origin, and no other host', () => {
            expect(isAllowedUrl('https://a.com/any/path', ['https://a.com'])).toBe(true);
            expect(isAllowedUrl('https://a.com.evil.com/x', ['https://a.com'])).toBe(false);
            expect(isAllowedUrl('https://evil.com/?https://a.com', ['https://a.com'])).toBe(false);
        });

        it('opens only http and https, even when an entry would match another scheme', () => {
            expect(isAllowedUrl('data:text/html,<script>x</script>', ['data:text/'])).toBe(false);
            expect(isAllowedUrl('javascript:alert(1)', ['javascript:'])).toBe(false);
            expect(isAllowedUrl('file:///etc/passwd', ['file:///'])).toBe(false);
            expect(isAllowedUrl('http://a.com/x', ['http://a.com'])).toBe(true);
        });

        it('refuses an allow-list entry that is not an http or https URL', () => {
            expect(() => open(undefined, {urlAllowList: ['data:text/']})).toThrow(/data:text/);
        });

        it('opens nothing with no allow list', async () => {
            stubToasts();
            const model = open();
            expect(
                await model.runActionsAsync({type: 'openUrl', url: 'https://a.com/reports'})
            ).toBe(false);
        });
    });

    it('confirms an action with side effects, and runs an app action with resolved values', async () => {
        const model = open(),
            run = vi.fn(),
            confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true);
        onTestFinished(() => confirm.mockRestore());
        model.registry.addActions({
            name: 'toolbox.publishToPmPack',
            params: {
                type: 'object',
                properties: {fund: {type: ['string', 'null']}, asOf: {type: 'string'}}
            },
            sideEffects: true,
            describe: p => `Publish ${p.fund} for ${p.asOf}`,
            run
        });
        model.setVariable('asOf', '2026-07-01');

        const action = {
            type: 'toolbox.publishToPmPack',
            fund: {$var: 'fund'},
            asOf: {$var: 'asOf'}
        };
        expect(await model.runActionsAsync(action)).toBe(true);
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({message: 'Publish null for 2026-07-01'})
        );
        expect(run).toHaveBeenCalledWith(
            {fund: null, asOf: '2026-07-01'},
            expect.objectContaining({blueprintModel: model})
        );

        confirm.mockResolvedValue(false);
        expect(await model.runActionsAsync(action)).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("reads a row's field in a row action", async () => {
        const model = open();
        await model.runActionsAsync(
            {
                type: 'setVariable',
                variable: 'pnlFilter',
                value: {field: 'symbol', op: '=', value: {$row: 'symbol'}}
            },
            {row: {symbol: 'NVDA'}}
        );
        expect(model.getVariable('pnlFilter').value).toEqual({
            field: 'symbol',
            op: '=',
            value: 'NVDA'
        });
    });

    it('refreshes every source, or the ones it names', async () => {
        const model = open(),
            reload = vi.spyOn(model.getSource('orders'), 'reloadAsync'),
            others = vi.spyOn(model.getSource('positions'), 'reloadAsync');
        await model.runActionsAsync({type: 'refresh', sources: ['orders']});
        expect(reload).toHaveBeenCalledOnce();
        expect(others).not.toHaveBeenCalled();
    });

    it('finds no source, action or preset named after an inherited member', async () => {
        const toast = stubToasts(),
            model = open();
        expect(model.getSource('toString')).toBeNull();
        expect(await model.runActionsAsync({type: 'refresh', sources: ['toString']})).toBe(false);
        expect(await model.runActionsAsync({type: 'toString'})).toBe(false);
        expect(toast).toHaveBeenCalledTimes(2);
        expect(() => model.setPreset('toString', 'valueOf')).toThrow();
        expect(model.getActivePreset('toString')).toBeNull();
    });

    describe('parameter checks', () => {
        it('refuses a step whose resolved parameters fail its schema, before any step runs', async () => {
            const toast = stubToasts(),
                model = open();
            expect(await model.runActionsAsync([winners, {type: 'navigate', route: 5}])).toBe(
                false
            );
            expect(model.getVariable('pnlFilter').value).toBeNull();
            expect(toast).toHaveBeenCalledWith(expect.stringMatching(/route/));
        });

        it("refuses a value that does not match its variable's type or options", async () => {
            stubToasts();
            const model = open(loadBlueprint('w1-one-city.json'), {catalog: weatherCatalog});
            expect(
                await model.runActionsAsync({
                    type: 'setVariable',
                    variable: 'city',
                    value: 'Atlantis'
                })
            ).toBe(false);
            expect(
                await model.runActionsAsync({type: 'setVariable', variable: 'city', value: 7})
            ).toBe(false);
            expect(model.getVariable('city').value).toBe('London');
            expect(() => model.setVariable('city', 'Atlantis')).toThrow(/Atlantis/);
            expect(
                await model.runActionsAsync({type: 'setVariable', variable: 'city', value: 'Paris'})
            ).toBe(true);
        });

        it('checks an app action against its schema, with values resolved', async () => {
            stubToasts();
            const model = open(),
                run = vi.fn();
            model.registry.addActions({
                name: 'toolbox.publishToPmPack',
                params: {
                    type: 'object',
                    required: ['fund', 'asOf'],
                    properties: {fund: {type: 'string'}, asOf: {type: 'string'}}
                },
                run
            });
            expect(
                await model.runActionsAsync({
                    type: 'toolbox.publishToPmPack',
                    fund: {$var: 'fund'},
                    asOf: {$var: 'asOf'}
                })
            ).toBe(false);
            expect(run).not.toHaveBeenCalled();
        });

        it('refuses to register an action with no parameter schema', () => {
            const model = open();
            expect(() =>
                model.registry.addActions({name: 'acme.bad', params: null} as any)
            ).toThrow(/schema/);
        });
    });
});
