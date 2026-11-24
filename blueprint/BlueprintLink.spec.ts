import type {PlainObject} from '@xh/hoist/core';
import {type ToastSpec, XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {portfolioCatalog, scenarioRegistry} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {blueprintLinkParams, blueprintLinkUrl, parseBlueprintLink} from './BlueprintLink';
import {BlueprintModel} from './BlueprintModel';
import type {BlueprintRegistry} from './BlueprintRegistry';
import {FakeBlueprintDataProvider} from './FakeBlueprintDataProvider';
import {BlueprintDocumentModel} from './repository/BlueprintDocumentModel';
import {InMemoryBlueprintRepository} from './repository/InMemoryBlueprintRepository';
import {validateBlueprint} from './validateBlueprint';

/**
 * A link opens one blueprint, at one version, with presets and variable values from its query
 * params. Anyone can write a link, so every param is untrusted: a value that does not fit is
 * dropped and named, and the rest of the link still opens.
 */
describe('BlueprintLink', () => {
    beforeAll(() => initTestAppAsync());

    describe('parseBlueprintLink', () => {
        const parse = (params: PlainObject, registry = scenarioRegistry()) =>
            parseBlueprintLink(params, BLUEPRINT, registry);

        it('opens the latest publish, a publish by number, or the draft', () => {
            expect(parseBlueprintLink({id: 'b1'})).toMatchObject({
                id: 'b1',
                open: {as: 'publish'},
                problems: []
            });
            expect(parseBlueprintLink({id: 'b1', version: '3'}).open).toEqual({
                as: 'publish',
                version: 3
            });
            expect(parseBlueprintLink({id: 'b1', draft: null}).open).toEqual({as: 'draft'});
            expect(parseBlueprintLink({id: 'b1', draft: ''}).open).toEqual({as: 'draft'});
        });

        it.each([
            [{version: '0'}, 'version'],
            [{version: '1.5'}, 'version'],
            [{version: ['1', '2']}, 'version'],
            [{version: '2', draft: ''}, 'draft']
        ])('opens the latest publish for %o, and names the problem', (params, word) => {
            const ret = parseBlueprintLink({id: 'b1', ...params});
            expect(ret.open).toEqual({as: 'publish'});
            expect(ret.problems.join()).toContain(word);
        });

        it.each<[string, string, unknown, unknown]>([
            ['string', 'region', 'EU', 'EU'],
            ['int', 'top', '25', 25],
            ['negative int', 'top', '-3', -3],
            ['number', 'shock', '-0.25', -0.25],
            ['bool', 'showAll', 'true', true],
            ['localDate', 'asOf', '2026-11-20', '2026-11-20'],
            ['date', 'at', '2026-11-20T14:30:00.000Z', Date.UTC(2026, 10, 20, 14, 30)],
            ['period', 'window', '3M', '3M'],
            ['dateRange preset', 'range', 'mtd', 'mtd'],
            [
                'dateRange from..to',
                'range',
                '2026-01-01..2026-03-31',
                {kind: 'custom', start: '2026-01-01', end: '2026-03-31'}
            ],
            ['list, repeated', 'symbols', ['AAPL', 'MSFT'], ['AAPL', 'MSFT']],
            ['list of one', 'symbols', 'AAPL', ['AAPL']],
            ['app type of a field type', 'fund', 'Oak Mount', 'Oak Mount']
        ])('reads a %s', (_, name, text, expected) => {
            const ret = parse({id: 'b1', [name]: text});
            expect(ret.problems).toEqual([]);
            expect(ret.values[name]).toEqual(expected);
        });

        it.each<[string, unknown]>([
            ['top', '1.5'],
            ['top', ''],
            ['top', '1e3'],
            ['shock', '1e3'],
            ['shock', 'NaN'],
            ['showAll', 'yes'],
            ['asOf', '2026-13-01'],
            ['asOf', '2026-02-30'],
            ['at', 'yesterday'],
            ['window', '0M'],
            ['range', 'nope'],
            ['range', '2026-03-31..2026-01-01'],
            ['region', 'APAC'],
            ['region', ['US', 'EU']]
        ])('drops %s=%o and names it', (name, text) => {
            const ret = parse({id: 'b1', [name]: text});
            expect(ret.values).not.toHaveProperty(name);
            expect(ret.problems).toHaveLength(1);
            expect(ret.problems[0]).toContain(name);
        });

        it('sets only the variables a link may set', () => {
            const ret = parse({
                id: 'b1',
                picked: 'x',
                prior: '2026-01-01',
                fixed: 'y',
                where: '{}',
                book: '{}'
            });
            expect(ret.values).toEqual({});
            expect(ret.problems).toHaveLength(5);
            ['picked', 'prior', 'fixed', 'where', 'book'].forEach(name =>
                expect(ret.problems.some(it => it.includes(`'${name}'`))).toBe(true)
            );
        });

        it("sets an app type with no field type through its type's urlCodec", () => {
            const registry = scenarioRegistry();
            registry.variableTypes['toolbox.portfolio'] = {
                ...registry.variableTypes['toolbox.portfolio'],
                urlCodec: {
                    parse: text => ({holdings: text.split('|').map(symbol => ({symbol}))}),
                    format: v => (v as PlainObject).holdings.map(it => it.symbol).join('|')
                }
            };
            const ret = parse({id: 'b1', book: 'AAPL|MSFT'}, registry);
            expect(ret.problems).toEqual([]);
            expect(ret.values.book).toEqual({holdings: [{symbol: 'AAPL'}, {symbol: 'MSFT'}]});
        });

        it("names a value an app type's urlCodec cannot read", () => {
            const registry = scenarioRegistry();
            registry.variableTypes['toolbox.portfolio'] = {
                ...registry.variableTypes['toolbox.portfolio'],
                urlCodec: {
                    parse: () => {
                        throw new Error('bad');
                    },
                    format: () => ''
                }
            };
            expect(parse({id: 'b1', book: 'x'}, registry).problems[0]).toContain("'book'");
        });

        it('leaves params it does not know to the host', () => {
            expect(parse({id: 'b1', tab: 'risk', utm_source: 'mail'})).toMatchObject({
                values: {},
                problems: []
            });
        });

        it('finds nothing through inherited names, and pollutes nothing', () => {
            const params = JSON.parse(
                '{"id": "b1", "__proto__": {"polluted": "yes"}, "constructor": "x", "toString": "y", "preset": "__proto__:x"}'
            );
            const ret = parse(params);
            expect(ret.values).toEqual({});
            expect(({} as PlainObject).polluted).toBeUndefined();
            expect(Object.getPrototypeOf(ret.values)).toBe(Object.prototype);
            expect(ret.presets).toEqual({});
        });

        it('drops a value past 1,000 characters and a list past 100 items', () => {
            const ret = parse({
                id: 'b1',
                region: 'x'.repeat(1001),
                symbols: Array.from({length: 101}, (_, i) => `S${i}`)
            });
            expect(ret.values).toEqual({});
            expect(ret.problems).toHaveLength(2);
        });

        it('drops every value past 8,000 characters of params', () => {
            const params: PlainObject = {id: 'b1', asOf: '2026-11-20'};
            for (let i = 0; i < 10; i++) params[`host${i}`] = 'x'.repeat(900);
            params.top = '5';
            const ret = parse(params);
            expect(ret.values).toEqual({asOf: '2026-11-20'});
            expect(ret.problems.join()).toContain('top');
        });

        it('reads presets as group:item, and names one the blueprint lacks', () => {
            expect(parse({id: 'b1', preset: 'view:bySymbol'})).toMatchObject({
                presets: {view: 'bySymbol'},
                problems: []
            });
            const ret = parse({id: 'b1', preset: ['view:byNothing', 'colors:dark', 'oops']});
            expect(ret.presets).toEqual({});
            expect(ret.problems).toHaveLength(3);
        });
    });

    describe('reserved names', () => {
        it.each(['id', 'version', 'draft', 'preset'])('refuses a variable named %s', name => {
            const issues = validateBlueprint(
                {...BLUEPRINT, variables: {...BLUEPRINT.variables, [name]: {type: 'string'}}},
                {catalog: portfolioCatalog, registry: scenarioRegistry()}
            );
            expect(issues).toContainEqual(
                expect.objectContaining({
                    code: 'variable.reservedName',
                    path: `/variables/${name}`
                })
            );
        });
    });

    describe('applyLinkState', () => {
        it('applies presets, then values, before the first load, and loads once', async () => {
            const provider = new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                load = vi.spyOn(provider, 'subscribe'),
                model = open(provider),
                problems = model.applyLinkState(
                    parseBlueprintLink(
                        {id: 'b1', preset: 'view:bySymbol', asOf: '2026-10-30', fund: 'Oak Mount'},
                        model.blueprint,
                        model.registry
                    )
                );
            await wait(50);

            expect(problems).toEqual([]);
            expect(model.getActivePreset('view')).toBe('bySymbol');
            expect(model.getVariable('asOf').value).toBe('2026-10-30');
            expect(load).toHaveBeenCalledTimes(1);
            expect(load.mock.calls[0][0].params).toMatchObject({
                asOf: '2026-10-30',
                fund: 'Oak Mount'
            });
        });

        it('sets values as transient state, not as a user action', () => {
            const model = open();
            model.applyLinkState(
                parseBlueprintLink({id: 'b1', top: '3'}, model.blueprint, model.registry)
            );
            expect(model.getVariable('top').value).toBe(3);
            expect(model.userActedAt).toBeNull();
            expect(model.blueprint.variables.top.default).toEqual({value: 10});
        });
    });

    describe('blueprintLinkParams', () => {
        it('holds the presets and values that differ from their defaults, and reads back', async () => {
            const {doc, model, id} = await openDocument('write');
            await doc.openAsync(id, {as: 'publish'});
            model.setPreset('view', 'bySymbol');
            model.setVariable('asOf', '2026-10-30');
            model.setVariable('symbols', ['AAPL', 'MSFT']);
            model.setVariable('range', {kind: 'custom', start: '2026-01-01', end: '2026-03-31'});
            model.setVariable('top', 10);

            const params = blueprintLinkParams(doc);
            expect(params).toEqual({
                id,
                preset: ['view:bySymbol'],
                asOf: '2026-10-30',
                symbols: ['AAPL', 'MSFT'],
                range: '2026-01-01..2026-03-31'
            });
            expect(parseBlueprintLink(params, model.blueprint, model.registry)).toMatchObject({
                presets: {view: 'bySymbol'},
                values: {
                    asOf: '2026-10-30',
                    symbols: ['AAPL', 'MSFT'],
                    range: {kind: 'custom', start: '2026-01-01', end: '2026-03-31'}
                },
                problems: []
            });
        });

        it('names the draft, or a publish other than the latest', async () => {
            const {doc, id} = await openDocument('write');
            await doc.openAsync(id, {as: 'draft'});
            expect(blueprintLinkParams(doc)).toEqual({id, draft: ''});
            await doc.openAsync(id, {as: 'publish', version: 1});
            expect(blueprintLinkParams(doc)).toEqual({id, version: '1'});
            await doc.openAsync(id, {as: 'publish'});
            expect(blueprintLinkParams(doc)).toEqual({id});
        });
    });

    describe('blueprintLinkUrl', () => {
        it("builds an absolute URL on the app's route, with the id in its path", async () => {
            XH.routerModel.addRoutes([{name: 'linkSpec', path: '/linkSpec/:id'}]);
            const {doc, model, id} = await openDocument('write');
            await doc.openAsync(id, {as: 'publish'});
            model.setVariable('symbols', ['A&B', 'C']);
            model.setVariable('top', 3);

            expect(blueprintLinkUrl(doc, 'linkSpec')).toBe(
                `${window.location.origin}/linkSpec/${id}?top=3&symbols=A%26B&symbols=C`
            );
        });

        it('is null for a route the app does not have', async () => {
            const {doc, id} = await openDocument('write');
            await doc.openAsync(id, {as: 'publish'});
            expect(blueprintLinkUrl(doc, 'noSuchRoute')).toBeNull();
        });
    });

    describe('BlueprintDocumentModel.openLinkAsync', () => {
        // A draft saved over the one openDocument leaves, at version 3.
        const draft = (blueprint: Blueprint) => ({blueprint, base: 3, renames: []});

        it('opens the version a link names, with its values', async () => {
            const {doc, model, id} = await openDocument('write');
            const ret = await doc.openLinkAsync({id, version: '1', top: '4'});
            expect(ret.issues).toEqual([]);
            expect(doc.document).toMatchObject({kind: 'publish', version: 1});
            expect(model.getVariable('top').value).toBe(4);
        });

        it("opens the latest publish for a reader's draft link, and says so", async () => {
            const toast = vi.spyOn(XH, 'warningToast').mockReturnValue(null),
                {doc, id} = await openDocument('read');
            const ret = await doc.openLinkAsync({id, draft: ''});
            expect(ret.issues).toEqual([]);
            expect(doc.document).toMatchObject({kind: 'publish', version: 2});
            expect((toast.mock.calls[0][0] as ToastSpec).message).toContain(
                'latest published version'
            );
        });

        it('says why a draft link opened the publish when the draft fails to validate', async () => {
            const toast = vi.spyOn(XH, 'warningToast').mockReturnValue(null),
                warn = vi.spyOn(console, 'warn').mockReturnValue(null),
                {doc, id, repository} = await openDocument('write'),
                broken = structuredClone(BLUEPRINT) as any;
            onTestFinished(() => warn.mockRestore());
            broken.elements.posGrid.config.stripeRows = 'yes';
            expect((await repository.saveDraftAsync(id, draft(broken))).issues).toEqual([]);

            const ret = await doc.openLinkAsync({id, draft: ''});
            expect(ret.issues).toEqual([]);
            expect(doc.document).toMatchObject({kind: 'publish', version: 2});
            const message = String((toast.mock.calls[0][0] as ToastSpec).message);
            expect(message).toMatch(/^The draft did not open: /);
            expect(message).toContain('/elements/posGrid/config/stripeRows');
            expect(message).not.toContain('may not open');
            expect(warn).toHaveBeenCalled();
        });

        it('names ignored values in one notice', async () => {
            const toast = vi.spyOn(XH, 'warningToast').mockReturnValue(null),
                {doc, id} = await openDocument('write');
            const ret = await doc.openLinkAsync({id, top: 'lots', region: 'APAC'});
            expect(ret.problems).toHaveLength(2);
            expect(toast).toHaveBeenCalledTimes(1);
            expect(String((toast.mock.calls[0][0] as ToastSpec).message)).toMatch(
                /top.*region|region.*top/s
            );
        });

        it('opens nothing, and reveals nothing, for a blueprint the user may not read', async () => {
            const {doc, model} = await openDocument('write');
            const ret = await doc.openLinkAsync({id: 'nope', asOf: '2026-10-30'});
            expect(ret.issues.map(it => it.severity)).toEqual(['error']);
            expect(model.blueprint).toBeNull();
        });
    });
});

//------------------
// Test data
//------------------
// Each shows in a variableInput, in a toolbar over the grid.
const PROMPTED = [
    'asOf',
    'fund',
    'region',
    'top',
    'showAll',
    'window',
    'range',
    'at',
    'symbols',
    'where',
    'book'
];

const BLUEPRINT: Blueprint = {
    schema: {
        blueprint: 1,
        widgets: {box: 1, cubeGrid: 1, presetSelector: 1, toolbar: 1, variableInput: 1},
        resolvers: {today: 1}
    },
    variables: {
        asOf: {type: 'localDate', label: 'As of', setBy: 'prompt', default: {value: '2026-11-20'}},
        fund: {type: 'toolbox.fund', label: 'Fund', setBy: 'prompt'},
        region: {type: 'string', setBy: 'prompt', options: {values: ['US', 'EU']}},
        top: {type: 'int', setBy: 'prompt', default: {value: 10}},
        shock: {type: 'number', setBy: 'action'},
        showAll: {type: 'bool', setBy: 'prompt', default: {value: false}},
        window: {type: 'period', setBy: 'prompt'},
        range: {type: 'dateRange', setBy: 'prompt'},
        at: {type: 'date', setBy: 'prompt'},
        symbols: {type: 'string[]', setBy: 'prompt'},
        where: {type: 'filter', setBy: 'prompt'},
        book: {type: 'toolbox.portfolio', setBy: 'prompt'},
        picked: {type: 'filter', setBy: {element: 'posGrid', output: 'selection'}},
        prior: {type: 'localDate', setBy: 'resolver', compute: {resolver: 'today'}},
        fixed: {type: 'string', default: {value: 'x'}}
    },
    presets: {
        view: {
            controls: [{path: '/elements/posGrid/config/columnState'}],
            default: 'bySector',
            items: {
                bySector: {set: {elements: {posGrid: {config: {columnState: ['mktVal']}}}}},
                bySymbol: {set: {elements: {posGrid: {config: {columnState: ['pnlDay']}}}}}
            }
        }
    },
    sources: {
        positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}, fund: {$var: 'fund'}}}
    },
    root: 'page',
    elements: {
        page: {
            component: 'box',
            config: {direction: 'column'},
            children: [{id: 'inputs'}, {id: 'views'}, {id: 'posGrid'}]
        },
        inputs: {component: 'toolbar', children: PROMPTED.map(it => ({id: `${it}Input`}))},
        ...Object.fromEntries(
            PROMPTED.map(it => [`${it}Input`, {component: 'variableInput', config: {variable: it}}])
        ),
        views: {component: 'presetSelector', config: {group: 'view'}},
        posGrid: {
            component: 'cubeGrid',
            config: {source: 'positions', groupBy: ['sector']}
        }
    }
} as Blueprint;

function open(dataProvider = new FakeBlueprintDataProvider({catalog: portfolioCatalog})) {
    const ret = new BlueprintModel({
        blueprint: BLUEPRINT,
        catalog: portfolioCatalog,
        registry: scenarioRegistry(),
        dataProvider
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

// A blueprint with two publishes, open to a user with the access given.
async function openDocument(access: 'read' | 'write') {
    let grant = {access: 'write' as const, canPublish: true} as PlainObject;
    const repository = new InMemoryBlueprintRepository({
            type: 'acme.dashboard',
            canCreate: true,
            accessOf: () => ({...grant}) as any
        }),
        {id} = await repository.createAsync({name: 'Linked', blueprint: BLUEPRINT});
    await repository.publishAsync(id, {base: 1});
    await repository.publishAsync(id, {base: 2});
    grant = {access, canPublish: access === 'write'};
    const model = new BlueprintModel({
            catalog: portfolioCatalog,
            registry: scenarioRegistry() as BlueprintRegistry,
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog})
        }),
        doc = new BlueprintDocumentModel({blueprintModel: model, repository});
    onTestFinished(() => {
        doc.destroy();
        model.destroy();
    });
    return {doc, model, id, repository};
}
