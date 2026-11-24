import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {type Blueprint, BlueprintModel} from '../../../blueprint';
import {FakeBlueprintDataProvider} from '../../../blueprint/demo';
import {BlueprintDesignModel} from '../../../blueprint/design/BlueprintDesignModel';
import {presetSelectorWidget, PresetSelectorWidgetModel} from './PresetSelectorWidget';

/**
 * A `presetSelector` shows a preset group's presets and switches the active one. Selectors for one
 * group agree, as they read the group's active preset.
 */
describe('presetSelector', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function withSelectors(display = 'segmented'): Blueprint {
        const bp = loadBlueprint('p3-morning-report.json');
        bp.elements.viewsA = {component: 'presetSelector', config: {group: 'posViews', display}};
        bp.elements.viewsB = {
            component: 'presetSelector',
            config: {group: 'posViews', display: 'select'}
        };
        bp.elements.positions.children.push(
            {id: 'viewsA', x: 0, y: 10, w: 2, h: 1},
            {id: 'viewsB', x: 2, y: 10, w: 2, h: 1}
        );
        return bp;
    }

    function open(blueprint: Blueprint, mode: 'run' | 'design' = 'run') {
        const model = new BlueprintModel({
            blueprint,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            mode,
            access: 'write'
        });
        onTestFinished(() => model.destroy());
        return model;
    }

    const widget = (model: BlueprintModel, id: string) => {
        const ret = new PresetSelectorWidgetModel({
            blueprintModel: model,
            id,
            renderElement: () => null
        });
        onTestFinished(() => ret.destroy());
        return ret;
    };

    it("lists its group's presets and switches the active one, and selectors agree", () => {
        const model = open(withSelectors()),
            a = widget(model, 'viewsA'),
            b = widget(model, 'viewsB');
        expect(a.items).toEqual([
            {value: 'pnl', label: 'P&L view'},
            {value: 'risk', label: 'Risk view'}
        ]);
        expect([a.active, b.active]).toEqual(['pnl', 'pnl']);
        a.choose('risk');
        expect(model.getActivePreset('posViews')).toBe('risk');
        expect(b.active).toBe('risk');
    });

    it('draws as a segmented control, buttons, a select or a toggle', () => {
        for (const display of ['segmented', 'buttonGroup', 'select', 'toggle']) {
            const {container} = render(
                presetSelectorWidget({
                    model: widget(open(withSelectors(display)), 'viewsA')
                }) as ReactElement
            );
            expect(container.textContent).toContain(
                display === 'select' ? 'P&L view' : 'Risk view'
            );
        }
    });

    it('refuses a group that does not exist, and a toggle for other than two presets', () => {
        const bp = withSelectors();
        bp.elements.viewsA.config.group = 'nope';
        bp.presets.posViews.items.extra = {label: 'Extra', set: bp.presets.posViews.items.pnl.set};
        bp.elements.viewsB.config.display = 'toggle';
        const issues = open(withSelectors())
            .validate(bp)
            .map(it => [it.code, it.path]);
        expect(issues).toEqual(
            expect.arrayContaining([
                ['preset.unknownGroup', '/elements/viewsA/config/group'],
                ['presetSelector.toggleNeedsTwo', '/elements/viewsB/config/display']
            ])
        );
    });

    it('starts on a group with no selector yet, displayed by how many presets it has', () => {
        const design = new BlueprintDesignModel({
                blueprintModel: open(loadBlueprint('p3-morning-report.json'), 'design')
            }),
            {blueprintModel: model} = design;
        onTestFinished(() => design.destroy());
        const {id} = design.addWidget('presetSelector', 'positions');
        expect(model.blueprint.elements[id].config).toEqual({group: 'posViews', display: 'toggle'});

        const empty = new BlueprintDesignModel({
            blueprintModel: open(loadBlueprint('p2-linked-dashboard.json'), 'design')
        });
        onTestFinished(() => empty.destroy());
        expect(empty.addWidget('presetSelector', 'dashboard').issues[0].message).toMatch(
            /Add a preset group first/
        );
    });
});
