import {render} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../../blueprint';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {elementInspector, ElementInspectorModel, NEW_VARIABLE} from './ElementInspector';

/**
 * The selected element's config, an editor per property of its widget's schema. Each commit is
 * one edit by the user, and a refused one leaves the blueprint as it was, with its issues shown.
 */
describe('ElementInspector', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(file = 'p3-morning-report.json', select = 'posGrid') {
        const model = new BlueprintModel({
                blueprint: loadBlueprint(file),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            inspector = new ElementInspectorModel(design);
        design.select({kind: 'element', id: select});
        onTestFinished(() => {
            inspector.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, inspector};
    }

    it("edits the selected element's config, one property per edit, and removes a cleared one", () => {
        const {model, inspector} = open();
        expect(inspector.nodes.map(it => it.key)).toContain('title');

        inspector.commit('title', 'Positions');
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
        expect(model.history.at(-1)).toMatchObject({author: 'user', description: 'Grid: title'});

        inspector.commit('title', undefined);
        expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('title');
        model.undo();
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
    });

    it("edits where an element sits in its container, from the container's child schema", () => {
        const {model, inspector} = open('p3-morning-report.json', 'posGrid');
        expect(inspector.placementNodes.map(it => it.key)).toEqual(['x', 'y', 'w', 'h']);
        expect(inspector.placementValues).toMatchObject({x: 0, y: 1, w: 8, h: 9});

        inspector.commitPlacement('w', 6);
        expect(model.blueprint.elements.positions.children.find(it => it.id === 'posGrid')).toEqual(
            {id: 'posGrid', x: 0, y: 1, w: 6, h: 9}
        );
        expect(model.history.at(-1).description).toMatch(/posGrid: placement/);

        inspector.commitPlacement('h', undefined);
        expect(inspector.issuesFor('$placement.h')[0].message).toMatch(/required/);
        expect(inspector.placementValues.h).toBe(9);
    });

    it('picks the variable an input sets, or makes a new one named for it', () => {
        const {model, design, inspector} = open();
        expect(inspector.setsOptions).toBeNull();

        const {id} = design.addWidget('dateInput', 'positions');
        design.select({kind: 'element', id});
        expect(inspector.setsVariable).toBeNull();
        expect(inspector.setsOptions.map(it => it.value)).toEqual(
            expect.arrayContaining(['asOf', NEW_VARIABLE])
        );

        inspector.setSets(NEW_VARIABLE);
        expect(model.blueprint.variables[id]).toMatchObject({
            type: 'localDate',
            setBy: {element: id}
        });
        expect(inspector.setsVariable).toBe(id);
    });

    it('badges a property that presets control with its group and active preset', () => {
        const {model, design, inspector} = open();
        expect(inspector.badgeFor('columnState')).toBe('Preset: Columns › P&L view');
        expect(inspector.badgeFor('title')).toBeNull();
        model.setPreset('posViews', 'risk');
        expect(inspector.badgeFor('columnState')).toBe('Preset: Columns › Risk view');

        const {container} = render(elementInspector({designModel: design}) as ReactElement);
        expect(container.querySelector('.xh-blueprint-element-inspector__badge')?.textContent).toBe(
            'Preset: Columns › Risk view'
        );
    });

    it('shows and edits the active preset for a path that presets control', () => {
        const {model, inspector} = open();
        expect(inspector.values.columnState).toEqual(['mktVal', 'pnlDay', 'pnlMtd', 'pnlYtd']);

        inspector.commit('columnState', ['mktVal']);
        const {presets, elements} = model.blueprint;
        expect(presets.posViews.items.pnl.set.elements.posGrid.config.columnState).toEqual([
            'mktVal'
        ]);
        expect(elements.posGrid.config).not.toHaveProperty('columnState');
    });

    it('keeps the blueprint as it was after a refused edit, with the issues at the property', () => {
        const {model, inspector} = open(),
            before = model.blueprint;
        inspector.commit('sizingMode', 'huge');
        expect(model.blueprint).toBe(before);
        expect(inspector.issuesFor('sizingMode').length).toBeGreaterThan(0);
        expect(inspector.issuesFor('title')).toEqual([]);

        inspector.refuse('columns', 'Not valid JSON.');
        expect(inspector.issuesFor('columns')).toMatchObject([{message: 'Not valid JSON.'}]);
        inspector.commit('title', 'Fine');
        expect(inspector.issuesFor('columns')).toEqual([]);
    });

    it('starts a new list item from the schema, with fields of the widget source not yet used', () => {
        const {inspector} = open('p2-linked-dashboard.json', 'posGrid'),
            item = {
                type: 'object',
                required: ['field'],
                properties: {field: {type: 'string', 'x-field': 'measure'}}
            },
            used: string[] = [];
        JSON.stringify(inspector.values, (_, v) => (typeof v === 'string' && used.push(v), v));
        const added = inspector.newValue(item) as {field: string};
        expect(added.field).toEqual(expect.any(String));
        expect(used).not.toContain(added.field);
    });

    it('is read-only outside design mode', () => {
        const {model, inspector} = open();
        expect(inspector.readOnly).toBe(false);
        model.setMode('run');
        expect(inspector.readOnly).toBe(true);
    });

    describe('sources, fields and bindings', () => {
        const nodeOf = (inspector: ElementInspectorModel, key: string) =>
            inspector.nodes.find(it => it.key === key);

        it("offers the blueprint's sources", () => {
            const {inspector} = open('p2-linked-dashboard.json', 'headline');
            expect(inspector.sourceOptions.map(it => it.value)).toEqual(['positions', 'orders']);
        });

        it("offers the element source's fields of the role asked, with their labels", () => {
            const {model, inspector} = open('p2-linked-dashboard.json', 'headlinePnlDay'),
                fields = model.getSource('positions').fields,
                dims = inspector.fieldOptions('dimension'),
                measures = inspector.fieldOptions('measure');
            expect(dims.length).toBeGreaterThan(0);
            dims.forEach(it => expect(fields[it.value].isDimension).toBe(true));
            measures.forEach(it => expect(fields[it.value].isDimension).toBeFalsy());
            expect(measures.find(it => it.value === 'mktVal').label).toBe('Market Value');
            expect(inspector.fieldOptions('any').length).toBe(Object.keys(fields).length);
        });

        it('offers the variables whose type the property takes', () => {
            const {inspector} = open();
            expect(inspector.variablesFor(nodeOf(inspector, 'groupBy'))).toEqual(['grouping']);
            expect(inspector.variablesFor(nodeOf(inspector, 'filter'))).toEqual([
                'pnlFilter',
                'selection'
            ]);
            expect(inspector.variablesFor(nodeOf(inspector, 'title'))).toEqual(
                expect.arrayContaining(['symbol', 'fund'])
            );
            expect(inspector.variablesFor(nodeOf(inspector, 'title'))).not.toContain('asOf');
        });

        it('binds a property to a variable, and back to a value', () => {
            const {model, inspector} = open();
            inspector.commit('title', {$var: 'symbol'});
            expect(model.blueprint.elements.posGrid.config.title).toEqual({$var: 'symbol'});
            inspector.commit('groupBy', inspector.unboundValue(nodeOf(inspector, 'groupBy')));
            expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('groupBy');
        });

        it('draws a variable picker for a bound property, and a field picker for a field', () => {
            const {design} = open(),
                {container} = render(elementInspector({designModel: design}) as ReactElement);
            expect(container.textContent).not.toContain('Bound to variable');
            expect(
                container.querySelectorAll('.xh-blueprint-element-inspector__bound').length
            ).toBe(2);
        });
    });

    describe('grouping, filters and columns', () => {
        it("offers a filter each field of the element's source, with values for dimensions", async () => {
            const {model, inspector} = open();
            await model.loadAsync();
            const specs = inspector.filterFieldSpecs(),
                region = specs.find(it => it.field === 'region'),
                mktVal = specs.find(it => it.field === 'mktVal');
            expect(region.displayName).toBe('Region');
            expect(region.values.length).toBeGreaterThan(0);
            expect(region.values.length).toBeLessThanOrEqual(1000);
            expect(mktVal.values).toBeUndefined();
        });

        it('draws a grouping chooser, a filter chooser with bound clauses as chips, and a column list', () => {
            const {design, inspector} = open();
            inspector.commit('groupBy', ['region']);
            inspector.commit('filter', {
                op: 'AND',
                filters: [
                    {field: 'fund', op: '=', value: {$var: 'fund'}},
                    {field: 'region', op: '=', value: 'EMEA'}
                ]
            });
            const {container} = render(elementInspector({designModel: design}) as ReactElement),
                chips = container.querySelectorAll('.xh-blueprint-element-inspector__chip');
            expect(container.querySelector('.xh-grouping-chooser')).not.toBeNull();
            expect(container.querySelector('.xh-filter-chooser')).not.toBeNull();
            expect([...chips].map(it => it.textContent)).toEqual(['Fund = fund']);
            expect(
                container.querySelectorAll('.xh-blueprint-element-inspector__column').length
            ).toBe(4);
        });
    });

    describe('formats, renderers and actions', () => {
        it("offers the catalog's named formats, and marks those the blueprint redefines", () => {
            const {inspector} = open(),
                byValue = Object.fromEntries(
                    inspector.formatOptions.map(it => [it.value, it.label])
                );
            expect(byValue.pnl).toBe('pnl');
            expect(byValue.mv).toBe('mv (redefined here)');
        });

        it("offers the registry's renderers and actions, with each one's options", () => {
            const {inspector} = open();
            expect(inspector.rendererOptions.map(it => it.value)).toEqual(
                expect.arrayContaining(['bar', 'badge', 'delta'])
            );
            expect(inspector.actionOptions.map(it => it.value)).toEqual(
                expect.arrayContaining(['refresh', 'setVariable', 'toolbox.publishToPmPack'])
            );
            expect(inspector.actionSpec('toolbox.publishToPmPack').params.required).toEqual([
                'fund',
                'asOf'
            ]);
        });

        it('leaves out actions for chat answers only', () => {
            const {model, inspector} = open();
            model.registry.addActions({
                name: 'acme.send',
                params: {type: 'object'},
                allowedIn: ['answers']
            });
            expect(inspector.actionOptions.map(it => it.value)).not.toContain('acme.send');
        });

        it('starts a step with no placeholders: required params bound to fitting variables', () => {
            const {model, inspector} = open();
            model.registry.addActions({
                name: 'acme.publishDated',
                params: {
                    type: 'object',
                    required: ['asOf', 'note'],
                    properties: {
                        asOf: {type: 'string', format: 'date'},
                        note: {type: 'string'},
                        extra: {type: 'string'}
                    }
                }
            });
            expect(inspector.stepStart('acme.publishDated')).toEqual({
                type: 'acme.publishDated',
                asOf: {$var: 'asOf'},
                note: {$var: 'fund'}
            });
            expect(inspector.defaultActionType).toBe('refresh');
        });

        it('starts a step that sets a variable with the first variable an action may set', () => {
            const {inspector} = open();
            expect(inspector.settableVariables.map(it => it.value)).toContain('pnlFilter');
            expect(inspector.settableVariables.map(it => it.value)).not.toContain('selection');
            expect(inspector.stepStart('setVariable')).toEqual({
                type: 'setVariable',
                variable: inspector.settableVariables[0].value
            });
        });

        it('locks confirm on for an action that changes data', () => {
            const {inspector} = open();
            expect(inspector.confirmLocked('toolbox.publishToPmPack')).toBe(true);
            expect(inspector.confirmLocked('refresh')).toBe(false);
        });

        it('describes a step as its tooltip will', () => {
            const {inspector} = open();
            expect(inspector.describeStep({type: 'refresh'})).toEqual(expect.any(String));
            expect(inspector.describeStep({type: 'nope'})).toEqual(expect.any(String));
        });

        it('draws a format picker, a renderer picker and an action editor', () => {
            const {model, design} = open('p2-linked-dashboard.json', 'posGrid');
            design.setConfig('posGrid', '/columns', {
                mktVal: {format: {name: 'mv', precision: 2}, renderer: 'bar'}
            });
            const {container} = render(elementInspector({designModel: design}) as ReactElement);
            expect(
                container.querySelectorAll('.xh-blueprint-element-inspector__format').length
            ).toBe(1);
            expect(
                container.querySelectorAll('.xh-blueprint-element-inspector__renderer').length
            ).toBe(1);

            const buttons = design.addWidget('buttonGroup');
            design.select({kind: 'element', id: buttons.id});
            const again = render(elementInspector({designModel: design}) as ReactElement);
            expect(
                again.container.querySelectorAll('.xh-blueprint-element-inspector__step').length
            ).toBeGreaterThan(0);
            expect(model.blueprint.elements[buttons.id].config.buttons[0].action).toEqual({
                type: 'refresh'
            });

            design.setConfig(buttons.id, '/buttons', [
                {
                    label: 'Publish',
                    action: {type: 'toolbox.publishToPmPack', fund: 'A', asOf: '2026-11-20'}
                }
            ]);
            const locked = render(elementInspector({designModel: design}) as ReactElement),
                confirm = [
                    ...locked.container.querySelectorAll('.xh-blueprint-element-inspector__row')
                ]
                    .find(it => it.firstElementChild?.textContent === 'Confirm')
                    .querySelector('input');
            expect([confirm.checked, confirm.disabled]).toEqual([true, true]);
        });
    });

    describe('removing, and tabs', () => {
        it('removes the element and what is inside it in one edit, once the user confirms', async () => {
            const {model, inspector} = open('p3-morning-report.json', 'positions'),
                confirm = vi.spyOn(XH, 'confirm').mockResolvedValueOnce(false);
            onTestFinished(() => confirm.mockRestore());

            await inspector.removeAsync();
            expect(model.blueprint.elements).toHaveProperty('positions');
            expect(confirm.mock.calls[0][0].message).toMatch(
                /Remove positions, and the 4 elements in it\? Variable grouping goes too\./
            );

            confirm.mockResolvedValueOnce(true);
            await inspector.removeAsync();
            expect(model.blueprint.elements).not.toHaveProperty('positions');
            expect(model.history.at(-1).description).toBe('Remove Dashboard');
        });

        it("lists a tab container's tabs, to retitle, reorder, add and remove", async () => {
            const {model, inspector} = open('p3-morning-report.json', 'tabs'),
                ids = () => model.blueprint.elements.tabs.children.map(it => it.id),
                [first, second] = ids();
            expect(inspector.tabs.map(it => it.id)).toEqual(ids());

            inspector.retitle(second, 'Book');
            expect(inspector.tabs[1].title).toBe('Book');
            inspector.moveTab(second, 0);
            expect(ids().slice(0, 2)).toEqual([second, first]);
            inspector.addTab();
            expect(model.blueprint.elements[ids().at(-1)].component).toBe('dashCanvas');
            expect(inspector.designModel.selectedElementId).toBe('tabs');
        });

        it('draws no tabs for an element whose children have no titles', () => {
            const {inspector} = open('p2-linked-dashboard.json', 'dashboard');
            expect(inspector.tabs).toBeNull();
        });
    });

    it('shows an unset property at its default, without writing it', () => {
        const {model, design} = open(),
            before = model.blueprint,
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = (label: string) =>
                [...container.querySelectorAll('.xh-blueprint-element-inspector__row')].find(
                    it => it.firstElementChild?.textContent === label
                );
        expect(row('Stripe rows').querySelector('input').checked).toBe(true);
        expect(row('Show hover').querySelector('input').checked).toBe(false);
        expect(row('Tree style').textContent).toContain('Default (highlights)');
        expect(row('Sizing mode').textContent).toContain('Default');
        expect(row('Sizing mode').textContent).not.toContain('Select');
        expect(model.blueprint).toBe(before);
    });

    it('draws a labelled editor per property', () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            labels = [...container.querySelectorAll('.xh-blueprint-element-inspector__label')].map(
                it => it.textContent
            );
        expect(labels).toEqual(expect.arrayContaining(['Source *', 'Title', 'Sizing mode']));
        expect(container.textContent).not.toContain('No model found');
    });
});
