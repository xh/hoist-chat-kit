import {initTestAppAsync} from '@xh/hoist/test-support';
import {cloneDeep, isString} from 'lodash';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import portfolioJson from '../../docs/planning/blueprints/catalogs/portfolio.json';
import {blueprintContextProvider} from '../../genui/architect/blueprintContextProvider';
import {loadBlueprint, scenarioRegistry} from '../../test/blueprintFixtures';
import type {Blueprint} from '../Blueprint';
import {BlueprintModel} from '../BlueprintModel';
import {DataCatalog, type DataCatalogJson} from '../DataCatalog';
import {FakeBlueprintDataProvider} from '../demo/FakeBlueprintDataProvider';
import {variablesForModel} from './modelValues';

/**
 * A variable's value that comes from data the model may not read, such as a grid selection over a
 * closed field, reaches the model only as a marker that something is set, with its type.
 */
describe('variable values the model sees', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    // Positions reads rows, but for its trader, which is schema only. Orders is schema only.
    const catalog = (() => {
        const json = cloneDeep(portfolioJson) as DataCatalogJson,
            {positions} = json.datasets;
        json.modelAccess = 'schema';
        positions.modelAccess = 'rows';
        positions.fields = positions.fields.map(it => {
            const f = isString(it) ? json.fields.find(sf => sf.name === it) : it;
            return f.name === 'trader' ? {...f, modelAccess: 'schema'} : it;
        });
        return new DataCatalog(json);
    })();

    function open(blueprint: Blueprint) {
        const ret = new BlueprintModel({
            blueprint,
            catalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog}),
            mode: 'design',
            access: 'write'
        });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    it('withholds a grid selection that names a field the model may not read, and sends any other', () => {
        const model = open(loadBlueprint('p2-linked-dashboard.json')),
            open1 = {field: 'strategy', op: '=', value: 'Credit'},
            closed = {
                op: 'AND',
                filters: [open1, {field: 'trader', op: '=', value: 'Fred Corn'}]
            };
        model.setOutput('posGrid', 'selection', open1);
        expect(variablesForModel(model).selection).toEqual(open1);

        model.setOutput('posGrid', 'selection', closed);
        expect(variablesForModel(model).selection).toEqual({withheld: true, type: 'filter'});

        model.setOutput('posGrid', 'selection', null);
        expect(variablesForModel(model).selection).toBeNull();
    });

    it("withholds an output's field the model may not read", () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.variables.who = {
            type: 'string',
            setBy: {element: 'posGrid', output: 'selected', field: 'trader'}
        };
        bp.variables.what = {
            type: 'string',
            setBy: {element: 'posGrid', output: 'selected', field: 'strategy'}
        };
        const model = open(bp);
        model.setOutput('posGrid', 'selected', {strategy: 'Credit', trader: 'Fred Corn'});
        expect(variablesForModel(model)).toMatchObject({
            who: {withheld: true, type: 'string'},
            what: 'Credit'
        });
    });

    it('withholds a value chosen from the values of a closed field, as a link may set it', () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.variables.who = {
            type: 'string',
            setBy: 'prompt',
            options: {source: 'positions', field: 'trader'}
        };
        bp.variables.desk = {
            type: 'string',
            setBy: 'prompt',
            options: {source: 'positions', field: 'strategy'}
        };
        const model = open(bp);
        model.setVariable('who', 'Fred Corn');
        model.setVariable('desk', 'Credit');
        expect(variablesForModel(model)).toMatchObject({
            who: {withheld: true, type: 'string'},
            desk: 'Credit'
        });
    });

    it('withholds a value a resolver computes from a withheld one', () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.variables.who = {
            type: 'string',
            setBy: {element: 'posGrid', output: 'selected', field: 'trader'}
        };
        bp.variables.whoAgain = {
            type: 'string',
            default: {resolver: 'acme.echo', args: {value: {$var: 'who'}}}
        };
        const registry = scenarioRegistry();
        registry.addResolvers({
            name: 'acme.echo',
            returns: 'string',
            args: {value: 'string'},
            resolve: args => args.value
        });
        const model = new BlueprintModel({
            blueprint: bp,
            catalog,
            registry,
            dataProvider: new FakeBlueprintDataProvider({catalog}),
            mode: 'design',
            access: 'write'
        });
        onTestFinished(() => model.destroy());
        model.setOutput('posGrid', 'selected', {trader: 'Fred Corn'});
        expect(variablesForModel(model).whoAgain).toEqual({withheld: true, type: 'string'});
    });

    it("sends the Architect's blueprint context with the markers in place", () => {
        const model = open(loadBlueprint('p2-linked-dashboard.json'));
        model.setOutput('posGrid', 'selection', {field: 'trader', op: '=', value: 'Fred Corn'});
        const {variables} = blueprintContextProvider(model).getContext({} as any) as any;
        expect(variables.selection).toEqual({withheld: true, type: 'filter'});
        expect(JSON.stringify(variables)).not.toContain('Fred Corn');
    });
});
