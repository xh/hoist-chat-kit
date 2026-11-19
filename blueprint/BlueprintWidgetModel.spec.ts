import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../test/blueprintFixtures';
import {BlueprintModel} from './BlueprintModel';
import {BlueprintWidgetModel} from './BlueprintWidgetModel';
import {FakeBlueprintDataProvider} from './FakeBlueprintDataProvider';

/**
 * A widget that shows a value, such as a grouping chooser, is connected to the variable whose
 * `setBy` names it, and sets that variable as a user changes the value.
 */
describe('BlueprintWidgetModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open() {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.variables.grouping = {
            type: 'string[]',
            setBy: {element: 'chooser'},
            default: {value: ['strategy', 'trader']}
        };
        bp.elements.chooser = {
            component: 'groupingChooser',
            config: {dimensions: ['strategy', 'trader', 'sector']}
        };
        bp.elements.dashboard.children.push({id: 'chooser', x: 0, y: 14, w: 4, h: 1});
        bp.elements.posGrid.config.groupBy = {$var: 'grouping'};
        const model = new BlueprintModel({
            blueprint: bp,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog})
        });
        onTestFinished(() => model.destroy());
        return model;
    }

    const widget = (model: BlueprintModel, id: string) => {
        const ret = new BlueprintWidgetModel({
            blueprintModel: model,
            id,
            renderElement: () => null
        });
        onTestFinished(() => ret.destroy());
        return ret;
    };

    it('shows the value of the variable its element sets, and sets it', () => {
        const model = open(),
            chooser = widget(model, 'chooser'),
            grid = widget(model, 'posGrid');

        expect(chooser.valueVariable.name).toBe('grouping');
        expect(chooser.value).toEqual(['strategy', 'trader']);

        chooser.setValue(['sector']);
        expect(model.getVariable('grouping').value).toEqual(['sector']);
        expect(grid.resolvedConfig.groupBy).toEqual(['sector']);
    });

    it('has no value variable when no variable names its element', () => {
        const model = open(),
            grid = widget(model, 'posGrid');
        expect(grid.valueVariable).toBeNull();
        expect(() => grid.setValue(['x'])).toThrow();
    });
});
