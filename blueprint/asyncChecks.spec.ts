import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../test/blueprintFixtures';
import type {BlueprintOp} from './Blueprint';
import {BlueprintModel} from './BlueprintModel';
import {ARCHITECT_TOOLS, ArchitectToolError} from './architect/ArchitectTools';
import {FakeBlueprintDataProvider} from './demo/FakeBlueprintDataProvider';

/**
 * An app widget or variable type can check a blueprint against its server. An edit that waits for
 * its checks runs the synchronous validator, then the checks of what it changed, before it applies.
 */
describe('async checks', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const KNOWN = ['NVDA', 'AAPL'];

    function open() {
        const registry = scenarioRegistry(),
            tickerCheck = vi.fn(async (config: {symbol?: string}) =>
                KNOWN.includes(config.symbol)
                    ? []
                    : [
                          {
                              code: 'acme.unknownSymbol',
                              severity: 'error' as const,
                              path: '/symbol',
                              message: `no symbol '${config.symbol}'`
                          }
                      ]
            ),
            fundCheck = vi.fn(async (value: unknown) =>
                value === 'Closed' ? 'Closed is no longer a fund' : null
            );
        registry.addWidgets({
            name: 'acme.ticker',
            version: 1,
            label: 'Ticker',
            guidance: 'One symbol.',
            category: 'content',
            config: {type: 'object', properties: {symbol: {type: 'string'}}},
            checkAsync: tickerCheck
        });
        registry.addVariableTypes({name: 'acme.fund', matches: 'string', checkAsync: fundCheck});
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p1-one-grid.json'),
            catalog: portfolioCatalog,
            registry,
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            mode: 'design',
            access: 'write'
        });
        onTestFinished(() => model.destroy());
        return {model, tickerCheck, fundCheck};
    }

    const addTicker = (symbol: string): BlueprintOp => ({
        op: 'addElement',
        id: 'ticker',
        element: {component: 'acme.ticker', config: {symbol}},
        parent: 'page'
    });

    it("refuses an edit whose widget fails its check, with the check's issue at its full path", async () => {
        const {model} = open(),
            {version, issues} = await model.applyEditAsync({ops: [addTicker('ZZZZ')]});
        expect(version).toBeUndefined();
        expect(issues).toEqual([
            {
                code: 'acme.unknownSymbol',
                severity: 'error',
                path: '/elements/ticker/config/symbol',
                message: "no symbol 'ZZZZ'"
            }
        ]);
        expect(model.blueprint.elements.ticker).toBeUndefined();

        expect((await model.applyEditAsync({ops: [addTicker('NVDA')]})).version).toBe(2);
        expect(model.blueprint.elements.ticker.config.symbol).toBe('NVDA');
    });

    it('checks the default and listed values of a variable of a type with a check', async () => {
        const {model} = open(),
            fund = (value: unknown, options?: unknown): BlueprintOp => ({
                op: 'set',
                path: '/variables/fund',
                value: {type: 'acme.fund', default: {value}, ...(options ? {options} : {})}
            });
        expect((await model.applyEditAsync({ops: [fund('Closed')]})).issues).toEqual([
            {
                code: 'variable.badValue',
                severity: 'error',
                path: '/variables/fund/default/value',
                message: 'Closed is no longer a fund'
            }
        ]);
        expect(
            (await model.applyEditAsync({ops: [fund('Oak', {values: ['Oak', 'Closed']})]})).issues
        ).toMatchObject([{code: 'variable.badValue', path: '/variables/fund/options/values'}]);
        expect((await model.applyEditAsync({ops: [fund('Oak')]})).version).toBe(2);
    });

    it('checks only what the edit changed, and nothing for an edit the validator refuses', async () => {
        const {model, tickerCheck} = open();
        await model.applyEditAsync({ops: [addTicker('NVDA')]});
        expect(tickerCheck).toHaveBeenCalledTimes(1);

        await model.applyEditAsync({
            ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']}]
        });
        expect(tickerCheck).toHaveBeenCalledTimes(1);

        const {issues} = await model.applyEditAsync({
            ops: [{op: 'set', path: '/elements/ticker/config/symbol', value: 7}]
        });
        expect(issues.map(it => it.code)).toContain('schema.invalid');
        expect(tickerCheck).toHaveBeenCalledTimes(1);
    });

    it('refuses an edit when the blueprint changed while its checks ran', async () => {
        const {model, tickerCheck} = open();
        let release: () => void;
        tickerCheck.mockImplementationOnce(
            () => new Promise(resolve => (release = () => resolve([])))
        );
        const pending = model.applyEditAsync({ops: [addTicker('NVDA')]});
        await Promise.resolve();
        model.applyEdit({
            ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['sector']}]
        });
        release();
        expect((await pending).issues.map(it => it.code)).toEqual(['edit.staleBase']);
    });

    it('reports a check that could not run as an error', async () => {
        const {model, tickerCheck} = open();
        tickerCheck.mockRejectedValueOnce(new Error('server down'));
        expect((await model.applyEditAsync({ops: [addTicker('NVDA')]})).issues).toEqual([
            {
                code: 'check.failed',
                severity: 'error',
                path: '/elements/ticker',
                message: 'its check could not run: server down'
            }
        ]);
    });

    it("runs the checks for the Architect's edit_blueprint", async () => {
        const {model} = open(),
            edit = ARCHITECT_TOOLS.find(it => it.name === 'edit_blueprint'),
            run = (symbol: string) =>
                edit.run(
                    {base: model.version, description: 'Add a ticker', ops: [addTicker(symbol)]},
                    model
                );
        const refused = (await Promise.resolve(run('ZZZZ')).catch(e => e)) as ArchitectToolError;
        expect(refused).toBeInstanceOf(ArchitectToolError);
        expect(refused.result.issues[0].code).toBe('acme.unknownSymbol');
        expect(await run('AAPL')).toMatchObject({applied: true, version: 2});
    });
});
