import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {autorun} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../../blueprint';
import {
    bandsOf,
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

    it("offers the repository's blueprints of the host's type for an openBlueprint target", async () => {
        const {model, inspector} = open();
        model.drillInRepository = {
            type: 'acme.dashboard',
            listAsync: async () => [
                {id: 'detail', name: 'Symbol detail'},
                {id: 'risk', name: 'Risk'}
            ]
        } as any;
        expect(inspector.blueprintOptions).toBeNull();
        await inspector.loadBlueprintOptionsAsync();
        expect(inspector.blueprintOptions).toEqual([
            {value: 'detail', label: 'Symbol detail'},
            {value: 'risk', label: 'Risk'}
        ]);
    });

    it('keeps each editor node across an edit, so the rows that did not change draw nothing new', () => {
        const {inspector} = open();
        let nodes: typeof inspector.nodes = [];
        // Observed, as the Inspector's render observes them.
        const dispose = autorun(() => (nodes = inspector.nodes));
        onTestFinished(dispose);
        const before = nodes;
        inspector.commit('title', 'Positions');
        expect(nodes.map(it => it.key)).toEqual(before.map(it => it.key));
        nodes.forEach((it, idx) => expect(it).toBe(before[idx]));
    });

    it('leaves what a row reads alone on an edit to another property, so the row skips drawing', () => {
        const {inspector} = open();
        const node = inspector.nodes.find(it => it.key === 'groupBy');
        let runs = 0;
        const dispose = autorun(() => {
            runs++;
            inspector.isPersonalizable('groupBy');
            inspector.variablesFor(node);
            inspector.sourceName;
            inspector.presets;
        });
        onTestFinished(dispose);
        inspector.commit('title', 'Positions');
        expect(runs).toBe(1);
    });

    it("edits the selected element's config, one property per edit, and removes a cleared one", () => {
        const {model, inspector} = open();
        expect(inspector.nodes.map(it => it.key)).toContain('title');

        inspector.commit('title', 'Positions');
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
        expect(model.history.at(-1)).toMatchObject({author: 'user', description: 'posGrid: title'});

        inspector.commit('title', undefined);
        expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('title');
        model.undo();
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
    });

    it("groups a grid's properties in sections, its style folded until opened", () => {
        const {inspector} = open('p3-morning-report.json', 'posGrid'),
            sections = () => inspector.sections.map(it => [it.label, it.collapsed]);
        expect(sections()).toEqual([
            ['Data', false],
            ['Display', false],
            ['Columns', false],
            ['Interaction', false],
            ['Style', true]
        ]);
        expect(inspector.sections[4].nodes.map(it => it.key)).toContain('treeStyle');
        expect(inspector.sections[0].nodes[0].key).toBe('source');
        inspector.toggleSection('Style');
        expect(inspector.sections[4].collapsed).toBe(false);
    });

    it('opens one column of a field list at a time, in a drawer', () => {
        const {inspector} = open('p3-morning-report.json', 'posGrid');
        expect(inspector.isItemOpen('columnState', 'pnlDay#1')).toBe(false);
        inspector.toggleItem('columnState', 'pnlDay#1');
        expect(inspector.isItemOpen('columnState', 'pnlDay#1')).toBe(true);
        inspector.toggleItem('columnState', 'pnlMtd#1');
        expect(inspector.isItemOpen('columnState', 'pnlDay#1')).toBe(false);
        expect(inspector.isItemOpen('columnState', 'pnlMtd#1')).toBe(true);
    });

    it("opens a property's preset group from its badge, for the host to show", () => {
        const {design, inspector} = open('p3-morning-report.json', 'posGrid'),
            shown: string[] = [];
        expect(inspector.canShowPresetGroups).toBe(false);
        inspector.onShowPresetGroup = name => shown.push(name);
        expect(inspector.canShowPresetGroups).toBe(true);
        inspector.showPresetGroupFor('columnState');
        expect(design.selection).toEqual({kind: 'preset', id: 'posViews'});
        expect(shown).toEqual(['posViews']);
    });

    it('renames the selected element, keeping it selected, or says why not', () => {
        const {model, design, inspector} = open('p3-morning-report.json', 'posGrid');
        inspector.rename('positionsGrid');
        expect(model.blueprint.elements).toHaveProperty('positionsGrid');
        expect(design.selectedElementId).toBe('positionsGrid');
        inspector.rename('priceChart');
        expect(inspector.issuesFor('$id')[0].message).toMatch(/priceChart/);
    });

    it("moves an element between its container's slots that take it", () => {
        const {model, inspector} = open('p3-morning-report.json', 'posViewsSelector'),
            cell = (id: string) =>
                model.blueprint.elements.positions.children.find(it => it.id === id);
        expect(inspector.slot).toBe('headerItems:posGrid');
        expect(inspector.slotOptions.map(it => it.value)).toEqual(
            expect.arrayContaining(['children', 'headerItems:priceChart'])
        );
        expect(inspector.placementNodes).toEqual([]);

        inspector.moveToSlot('headerItems:priceChart');
        expect(cell('priceChart').headerItems).toEqual([{id: 'posViewsSelector'}]);
        expect(cell('posGrid').headerItems).toEqual([{id: 'groupChooser'}]);

        inspector.moveToSlot('children');
        expect(inspector.slot).toBe('children');
        expect(inspector.placementValues).toMatchObject({w: expect.any(Number)});
    });

    it("offers no placement for a panel's toolbar, which takes its own size", () => {
        const model = new BlueprintModel({
                blueprint: {
                    schema: {blueprint: 1},
                    root: 'positionsPanel',
                    elements: {
                        positionsPanel: {
                            component: 'panel',
                            tbar: [{id: 'positionsToolbar'}],
                            children: [{id: 'note'}]
                        },
                        positionsToolbar: {component: 'toolbar', children: []},
                        note: {component: 'markdown', config: {text: 'Inside'}}
                    }
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            inspector = new ElementInspectorModel(design);
        onTestFinished(() => {
            inspector.destroy();
            design.destroy();
            model.destroy();
        });
        design.select({kind: 'element', id: 'positionsToolbar'});
        expect(inspector.slot).toBe('tbar');
        expect(inspector.placementNodes).toEqual([]);
        expect(inspector.placementValues).toEqual({});
    });

    it("edits where an element sits in its container, from the container's child schema", () => {
        const {model, inspector} = open('p3-morning-report.json', 'posGrid');
        expect(inspector.placementNodes.map(it => it.key)).toEqual([
            'x',
            'y',
            'w',
            'h',
            'title',
            'hideHeader'
        ]);
        expect(inspector.placementValues).toMatchObject({x: 0, y: 1, w: 8, h: 9});

        inspector.commitPlacement('w', 6);
        // A change of placement keeps the cell's header items.
        expect(model.blueprint.elements.positions.children.find(it => it.id === 'posGrid')).toEqual(
            {
                id: 'posGrid',
                x: 0,
                y: 1,
                w: 6,
                h: 9,
                headerItems: [{id: 'groupChooser'}, {id: 'posViewsSelector'}]
            }
        );
        expect(model.history.at(-1).description).toBe('posGrid view: w');

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

        it('shows each bound property as its variable', () => {
            const {design} = open(),
                {container} = render(elementInspector({designModel: design}) as ReactElement);
            expect(container.textContent).not.toContain('Bound to variable');
            expect(
                [...container.querySelectorAll('.xh-blueprint-element-inspector__var-chip')].map(
                    it => it.textContent
                )
            ).toEqual(['grouping', 'pnlFilter']);
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
                container.querySelectorAll('.xh-blueprint-element-inspector__columns [data-field]')
                    .length
            ).toBe(4);
        });
    });

    it('removes the column a row names, after another row goes, though that row drew nothing new', () => {
        const {model, design} = open('p2-linked-dashboard.json', 'posGrid');
        design.setConfig('posGrid', '/columnState', ['mktVal', 'pnlDay', 'pnlMtd']);
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            remove = (field: string) =>
                fireEvent.click(
                    container
                        .querySelector(`[data-field="${field}"]`)
                        .querySelector('[title="Remove"]')
                ),
            columns = () => model.blueprint.elements.posGrid.config.columnState;
        remove('mktVal');
        expect(columns()).toEqual(['pnlDay', 'pnlMtd']);
        remove('pnlMtd');
        expect(columns()).toEqual(['pnlDay']);
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

        it("folds a format's options in a card under its row until one is set, and sums up those set", () => {
            const {design} = open('p2-linked-dashboard.json', 'posGrid');
            design.setConfig('posGrid', '/columns', {mktVal: {format: 'mv'}});
            const {container} = render(elementInspector({designModel: design}) as ReactElement),
                card = () =>
                    container.querySelector(
                        '[data-config-key="format"] > .xh-blueprint-element-inspector__format-options'
                    );
            fireEvent.click(chevronOf(container.querySelector('[data-field="mktVal"]')));
            expect(card().classList).toContain('xh-card--collapsed');
            expect(card().textContent).toBe('Format options');

            // An override opens it, with the options set named in its title.
            design.setConfig('posGrid', '/columns', {mktVal: {format: {name: 'mv', precision: 1}}});
            const {container: set} = render(
                elementInspector({designModel: design}) as ReactElement
            );
            fireEvent.click(chevronOf(set.querySelector('[data-field="mktVal"]')));
            const opened = set.querySelector(
                '[data-config-key="format"] > .xh-blueprint-element-inspector__format-options'
            );
            expect(opened.classList).toContain('xh-card--expanded');
            expect(
                opened.querySelector('.xh-blueprint-element-inspector__format-summary').textContent
            ).toBe('precision 1');
            // A number format offers a number's options, and no date's.
            expect(
                [...opened.querySelectorAll('[data-config-key]')].map(it =>
                    it.getAttribute('data-config-key')
                )
            ).toEqual(['precision', 'scale', 'ledger', 'colorSpec', 'label', 'nullDisplay']);
        });

        it("offers a date column's format only a date's options, before any is set", () => {
            const {design} = open('p2-linked-dashboard.json', 'posGrid'),
                grid = design.addWidget('cubeGrid');
            design.setConfig(grid.id, '/source', 'orders');
            design.setConfig(grid.id, '/columnState', ['time']);
            design.select({kind: 'element', id: grid.id});
            const {container} = render(elementInspector({designModel: design}) as ReactElement);
            fireEvent.click(chevronOf(container.querySelector('[data-field="time"]')));
            const card = container.querySelector(
                '[data-config-key="format"] > .xh-blueprint-element-inspector__format-options'
            );
            fireEvent.click(card.querySelector('.xh-card__collapsible-header'));
            expect(
                [...card.querySelectorAll('[data-config-key]')].map(it =>
                    it.getAttribute('data-config-key')
                )
            ).toEqual(['date', 'pattern', 'nullDisplay']);
        });

        it("reads a date field's typed filter value as that day, west of UTC too", () => {
            const {design, inspector} = open('p2-linked-dashboard.json', 'posGrid'),
                grid = design.addWidget('cubeGrid'),
                tz = process.env.TZ;
            design.setConfig(grid.id, '/source', 'orders');
            design.select({kind: 'element', id: grid.id});
            process.env.TZ = 'America/New_York';
            onTestFinished(() => {
                process.env.TZ = tz;
            });
            const {valueParser} = inspector
                    .filterFieldSpecs()
                    .find(it => it.field === 'time') as any,
                day = valueParser('2026-11-22');
            expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 10, 22]);
            expect(valueParser('Nov 22')).toBeNull();
        });

        it('draws a format picker, a renderer picker and an action editor', () => {
            const {model, design} = open('p2-linked-dashboard.json', 'posGrid');
            design.setConfig('posGrid', '/columns', {
                mktVal: {format: {name: 'mv', precision: 2}, renderer: 'bar'}
            });
            const {container} = render(elementInspector({designModel: design}) as ReactElement);
            fireEvent.click(chevronOf(container.querySelector('[data-field="mktVal"]')));
            expect(container.querySelectorAll('[data-config-key="format"]').length).toBe(1);
            expect(
                container.querySelectorAll('.xh-blueprint-element-inspector__renderer').length
            ).toBe(1);

            const buttons = design.addWidget('buttonGroup');
            design.select({kind: 'element', id: buttons.id});
            const again = render(elementInspector({designModel: design}) as ReactElement);
            // A list item's editor opens in its drawer.
            fireEvent.click(
                again.container.querySelector(
                    '[data-config-key="buttons"] .xh-sortable-list__expander'
                )
            );
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
            const locked = render(elementInspector({designModel: design}) as ReactElement);
            fireEvent.click(
                locked.container.querySelector(
                    '[data-config-key="buttons"] .xh-sortable-list__expander'
                )
            );
            const confirm = [
                ...locked.container.querySelectorAll('.xh-blueprint-element-inspector__row')
            ]
                .find(it => it.firstElementChild?.textContent === 'Confirm')
                .querySelector<HTMLButtonElement>('[aria-checked="true"]');
            expect([confirm.textContent, confirm.disabled]).toEqual(['On', true]);
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
                /Remove positions, and the 5 elements in it\? Variable grouping goes too\./
            );

            confirm.mockResolvedValueOnce(true);
            await inspector.removeAsync();
            expect(model.blueprint.elements).not.toHaveProperty('positions');
            expect(model.history.at(-1).description).toBe('Remove positions');
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
            expect(model.blueprint.elements[ids().at(-1)].component).toBe('dashboard');
            expect(inspector.designModel.selectedElementId).toBe('tabs');
        });

        it('draws no tabs for an element whose children have no titles', () => {
            const {inspector} = open('p2-linked-dashboard.json', 'dashboard');
            expect(inspector.tabs).toBeNull();
        });
    });

    it('draws a boolean as two segments, positive first, which one click anywhere flips as one edit', () => {
        const {model, design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = () => container.querySelector('[data-config-key="hideHeaders"]'),
            segments = () => [...row().querySelectorAll('[aria-checked]')];
        fireEvent.click(screen.getByText('Style'));
        expect(row().firstElementChild.textContent).toBe('Column headers');
        expect(segments().map(it => [it.textContent, it.getAttribute('aria-checked')])).toEqual([
            ['Show', 'true'],
            ['Hide', 'false']
        ]);
        const before = model.history.length;
        fireEvent.click(segments()[0]);
        expect(model.blueprint.elements.posGrid.config.hideHeaders).toBe(true);
        expect(model.history.length).toBe(before + 1);
        expect(row().querySelector('.bp6-switch')).toBeNull();
    });

    it('puts a choice of pictures under its label, as it wraps over several lines', () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = container.querySelector('[data-config-key="showSummary"]');
        expect(row.firstElementChild.textContent).toBe('Summary row');
        expect(row.className).not.toContain('__row--inline');
    });

    it('counts in each card header only the settings set there, a binding or preset included', () => {
        const {design} = open(),
            id = design.addWidget('markdown', 'overview').id;
        act(() => design.select({kind: 'element', id}));
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            countOf = (title: string) =>
                [...container.querySelectorAll('.xh-blueprint-element-inspector__card-header')]
                    .find(it => it.textContent.startsWith(title))
                    ?.querySelector('.xh-blueprint-element-inspector__card-count');
        expect(countOf('Data')).toBeNull();
        act(() => {
            design.setConfig(id, '/source', 'positions');
        });
        expect(countOf('Data').classList).toContain('xh-badge');
        expect(countOf('Data').textContent).toBe('1');
        expect(countOf('Data').getAttribute('title')).toBe('1 setting set');
        // A bound value is set too.
        act(() => {
            design.setConfig(id, '/source', {$var: 'fund'});
        });
        expect(countOf('Data').textContent).toBe('1');
    });

    it("shows a dashboard's and a panes widget's rearranging locked by default", () => {
        for (const [file, id] of [
            ['p2-linked-dashboard.json', 'dashboard'],
            ['p3-morning-report.json', 'positions']
        ]) {
            const {model, design} = open(file, id),
                {container} = render(elementInspector({designModel: design}) as ReactElement),
                row = container.querySelector('[data-config-key="layoutLocked"]'),
                checked = row.querySelector('[aria-checked="true"]');
            expect(model.blueprint.elements[id].config?.layoutLocked).toBeUndefined();
            expect(checked.textContent).toBe('Locked');
            expect(row.querySelector('.xh-blueprint-element-inspector__implied')).not.toBeNull();
        }
    });

    it('shows an unset property at its default, without writing it', () => {
        const {model, design} = open(),
            before = model.blueprint,
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = (label: string) =>
                [...container.querySelectorAll('.xh-blueprint-element-inspector__row')].find(
                    it => it.firstElementChild?.textContent === label
                );
        expect(row('Stripe rows')).toBeUndefined();
        fireEvent.click(screen.getByText('Style'));
        expect(row('Stripe rows').querySelector('[aria-checked="true"]').textContent).toBe('On');
        expect(row('Show hover').querySelector('[aria-checked="true"]').textContent).toBe('Off');
        // Its default marked more quietly than a value set.
        expect(
            row('Stripe rows').querySelector('.xh-blueprint-element-inspector__implied')
        ).not.toBeNull();
        // A choice names its default, and one that falls back to something else says so.
        expect(row('Tree style').textContent).toContain('Highlights (default)');
        expect(row('Sizing mode').textContent).toContain("The app's sizing mode");
        expect(row('Sizing mode').textContent).not.toContain('Select');
        // A number shows its default as its placeholder.
        expect(row('Group row height').querySelector('input').placeholder).toBe('By sizing mode');
        expect(model.blueprint).toBe(before);
    });

    // Alt+arrow on the handle that has focus, as a keyboard user presses it twice.
    const altDown = async (first: Element) => {
        fireEvent.keyDown(first, {key: 'ArrowDown', altKey: true});
        await wait();
        fireEvent.keyDown(document.activeElement, {key: 'ArrowDown', altKey: true});
    };

    it('moves a column two places with Alt+Down twice, as focus follows it, with its drawer', async () => {
        const {design, model} = open('p2-linked-dashboard.json', 'posGrid'),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            fields = () =>
                (model.blueprint.elements.posGrid.config.columnState as unknown[]).map(it =>
                    typeof it === 'string' ? it : (it as any).field
                ),
            [a, b, c, ...rest] = fields();
        fireEvent.click(chevronOf(container.querySelector(`[data-field="${a}"]`)));
        await altDown(
            container.querySelector(
                '.xh-blueprint-element-inspector__columns .xh-sortable-list__handle'
            )
        );
        expect(fields()).toEqual([b, c, a, ...rest]);
        // The open drawer stays under the column it opened for.
        const openRow = container.querySelector('.xh-blueprint-element-inspector__column--open');
        expect(openRow.getAttribute('data-field')).toBe(a);
    });

    it("opens a column's settings from a click on its row or its one chevron, one at a time", () => {
        const {design} = open('p2-linked-dashboard.json', 'posGrid'),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            header = (field: string) => container.querySelector(`[data-field="${field}"]`),
            isOpen = (field: string) =>
                chevronOf(header(field)).getAttribute('aria-expanded') === 'true',
            [a, b] = [
                ...container.querySelectorAll(
                    '.xh-blueprint-element-inspector__columns [data-field]'
                )
            ].map(it => it.getAttribute('data-field'));
        expect(
            header(a)
                .closest('.xh-sortable-list__item')
                .querySelectorAll('.xh-sortable-list__expander')
        ).toHaveLength(1);
        expect(isOpen(a)).toBe(false);

        fireEvent.click(header(a).querySelector('.xh-blueprint-element-inspector__column-label'));
        expect(isOpen(a)).toBe(true);
        expect(header(a).classList).toContain('xh-blueprint-element-inspector__column--open');

        fireEvent.click(chevronOf(header(b)));
        expect([isOpen(a), isOpen(b)]).toEqual([false, true]);
        fireEvent.click(chevronOf(header(b)));
        expect(isOpen(b)).toBe(false);
    });

    it("keeps a column's settings open while its section folds and unfolds", () => {
        const {design} = open('p2-linked-dashboard.json', 'posGrid'),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            band = () =>
                [
                    ...container.querySelectorAll('.xh-blueprint-element-inspector__card-header')
                ].find(it => it.textContent.startsWith('Columns')),
            fold = () =>
                fireEvent.click(
                    band().querySelector('.xh-blueprint-element-inspector__card-chevron')
                ),
            first = () =>
                container.querySelector('.xh-blueprint-element-inspector__columns [data-field]');
        const field = first().getAttribute('data-field');
        fireEvent.click(chevronOf(first()));
        fold();
        expect(first()).toBeNull();
        fold();
        expect(first().getAttribute('data-field')).toBe(field);
        expect(chevronOf(first()).getAttribute('aria-expanded')).toBe('true');
    });

    it("counts a column's settings in its summary", () => {
        const {design} = open('p2-linked-dashboard.json', 'posGrid');
        design.setConfig('posGrid', '/columns', {mktVal: {format: 'mv', headerName: 'Value'}});
        const {container} = render(elementInspector({designModel: design}) as ReactElement);
        expect(
            container.querySelector(
                '[data-field="mktVal"] .xh-blueprint-element-inspector__column-meta'
            ).textContent
        ).toMatch(/^mv.* · 2 set$/);
    });

    it('shows every step of an action open, with no chevron to fold one', () => {
        const {design} = open('p2-linked-dashboard.json');
        design.setConfig('posGrid', '/rowActions', [
            {label: 'A', action: [{type: 'refresh', sources: ['positions']}, {type: 'refresh'}]}
        ]);
        const {container} = render(elementInspector({designModel: design}) as ReactElement);
        fireEvent.click(
            container.querySelector('[data-config-key="rowActions"] .xh-sortable-list__expander')
        );
        const steps = container.querySelector('.xh-blueprint-element-inspector__steps');
        expect(steps.querySelectorAll('.xh-blueprint-element-inspector__step')).toHaveLength(2);
        expect(steps.querySelector('.xh-sortable-list__expander')).toBeNull();
    });

    it("moves an action's step and a list's item two places with Alt+Down twice", async () => {
        const {design, model} = open('p2-linked-dashboard.json');
        design.setConfig('posGrid', '/rowActions', [
            {
                label: 'A',
                action: [
                    {type: 'refresh', sources: ['positions']},
                    {type: 'refresh'},
                    {type: 'refresh', sources: ['orders']}
                ]
            },
            {label: 'B', action: {type: 'refresh'}},
            {label: 'C', action: {type: 'refresh'}}
        ]);
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            actions = () => model.blueprint.elements.posGrid.config.rowActions as any[];
        fireEvent.click(
            container.querySelector('[data-config-key="rowActions"] .xh-sortable-list__expander')
        );
        await altDown(
            container.querySelector(
                '.xh-blueprint-element-inspector__steps .xh-sortable-list__handle'
            )
        );
        expect(actions()[0].action).toEqual([
            {type: 'refresh'},
            {type: 'refresh', sources: ['orders']},
            {type: 'refresh', sources: ['positions']}
        ]);
        await altDown(
            container.querySelector(
                '[data-config-key="rowActions"] .xh-blueprint-element-inspector__columns .xh-sortable-list__handle'
            )
        );
        expect(actions().map(it => it.label)).toEqual(['B', 'C', 'A']);
    });

    it('keeps an open drawer on its item through a reorder and its undo', async () => {
        const {design, model} = open('p2-linked-dashboard.json');
        design.setConfig('posGrid', '/rowActions', [
            {label: 'A', action: {type: 'refresh'}},
            {label: 'B', action: {type: 'refresh'}},
            {label: 'C', action: {type: 'refresh'}}
        ]);
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            openLabel = () =>
                container.querySelector(
                    '.xh-blueprint-element-inspector__column--open .xh-blueprint-element-inspector__column-label'
                )?.textContent;
        fireEvent.click(
            container.querySelector('[data-config-key="rowActions"] .xh-sortable-list__expander')
        );
        expect(openLabel()).toBe('A');
        fireEvent.keyDown(
            container.querySelector('[data-config-key="rowActions"] .xh-sortable-list__handle'),
            {key: 'ArrowDown', altKey: true}
        );
        await wait();
        expect(openLabel()).toBe('A');
        model.undo();
        await wait();
        expect((model.blueprint.elements.posGrid.config.rowActions as any[])[0].label).toBe('A');
        expect(openLabel()).toBe('A');
    });

    it('draws a column listed twice, as a preset may hold one, for the user to remove', () => {
        const {design, model} = open();
        const bp = structuredClone(model.blueprint) as any;
        bp.presets.posViews.items.pnl.set.elements.posGrid.config.columnState = [
            'mktVal',
            'mktVal'
        ];
        model.setBlueprint(bp);
        const {container} = render(elementInspector({designModel: design}) as ReactElement);
        expect(container.querySelectorAll('[data-field="mktVal"]')).toHaveLength(2);
    });

    it('reorders tabs with a drag or the keyboard, one edit each', () => {
        const {design, model} = open('p3-morning-report.json', 'tabs'),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            ids = () => model.blueprint.elements.tabs.children.map(it => it.id),
            before = ids();
        fireEvent.keyDown(container.querySelector('.xh-sortable-list__handle'), {
            key: 'ArrowDown',
            altKey: true
        });
        expect(ids()).toEqual([before[1], before[0], ...before.slice(2)]);
        expect(model.history.at(-1).description).toBe(`Move ${before[0]} later`);
    });

    it('reorders the columns with a drag or the keyboard, one edit each', () => {
        const {design, model} = open('p2-linked-dashboard.json', 'posGrid'),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            fields = () =>
                (model.blueprint.elements.posGrid.config.columnState as unknown[]).map(it =>
                    typeof it === 'string' ? it : (it as any).field
                ),
            before = fields(),
            edits = model.history.length;
        fireEvent.keyDown(
            container.querySelector(
                '.xh-blueprint-element-inspector__columns .xh-sortable-list__handle'
            ),
            {key: 'ArrowDown', altKey: true}
        );
        expect(fields()).toEqual([before[1], before[0], ...before.slice(2)]);
        expect(model.history.length).toBe(edits + 1);
    });

    it("opens a column's settings below its row: how it shows, from columns, then its state", () => {
        const {design, model, inspector} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            columnRow = (field: string) =>
                [
                    ...container.querySelectorAll(
                        '.xh-blueprint-element-inspector__columns [data-field]'
                    )
                ].find(it => it.getAttribute('data-field') === field),
            labels = () =>
                [
                    ...container.querySelectorAll(
                        '.xh-blueprint-element-inspector__settings > .xh-blueprint-element-inspector__row > .xh-blueprint-element-inspector__label'
                    )
                ].map(it => it.textContent);

        expect(container.querySelector('[data-config-key="columns"]')).toBeNull();
        // A column it leaves unset shows what it takes from the catalog.
        const {format} = inspector.inheritedDisplay('mktVal'),
            formatName = typeof format === 'string' ? format : (format as any)?.name;
        expect(formatName).toBeTruthy();
        expect(
            columnRow('mktVal').querySelector('.xh-blueprint-element-inspector__column-meta')
                .textContent
        ).toContain(formatName);
        fireEvent.click(chevronOf(columnRow('mktVal')));
        expect(container.querySelector('[data-config-key="format"]').textContent).toContain(
            `${formatName} (from the field)`
        );
        // Its header shows the field's label, and its width that the grid sizes it.
        const drawerInput = (key: string) =>
            container.querySelector<HTMLInputElement>(
                `.xh-blueprint-element-inspector__settings [data-config-key="${key}"] input`
            );
        expect(drawerInput('headerName').placeholder).toBe(
            `${inspector.fieldLabel('mktVal')} (from the field)`
        );
        expect(drawerInput('width').placeholder).toBe('Auto');
        expect(labels().slice(0, 6)).toEqual([
            'Header',
            'Format',
            'Renderer',
            'Width',
            'Visible',
            'Pinned'
        ]);

        const before = model.history.length;
        inspector.commitItemSetting('columns', 'mktVal', 'headerName', 'MV');
        expect(model.blueprint.elements.posGrid.config.columns).toEqual({
            mktVal: {headerName: 'MV'}
        });
        inspector.commitItemSetting('columns', 'mktVal', 'headerName', undefined);
        expect(model.blueprint.elements.posGrid.config.columns).toBeUndefined();
        expect(model.history.length).toBe(before + 2);
    });

    it("reorders an action's steps in a sortable list, one edit each", () => {
        const {design, model} = open('p2-linked-dashboard.json');
        design.setConfig('posGrid', '/rowActions', [
            {
                label: 'Refresh',
                action: [{type: 'refresh', sources: ['positions']}, {type: 'refresh'}]
            }
        ]);
        const {container} = render(elementInspector({designModel: design}) as ReactElement);
        fireEvent.click(
            container.querySelector('[data-config-key="rowActions"] .xh-sortable-list__expander')
        );
        const edits = model.history.length;
        fireEvent.keyDown(
            container.querySelector(
                '.xh-blueprint-element-inspector__steps .xh-sortable-list__handle'
            ),
            {key: 'ArrowDown', altKey: true}
        );
        expect(model.blueprint.elements.posGrid.config.rowActions[0].action).toEqual([
            {type: 'refresh'},
            {type: 'refresh', sources: ['positions']}
        ]);
        expect(model.history.length).toBe(edits + 1);
    });

    it("draws an openBlueprint's values as rows, each a variable, a row field or a value", () => {
        const {design, model} = open('p2-linked-dashboard.json');
        design.setConfig('posGrid', '/rowActions', [
            {
                label: 'Open detail',
                action: {
                    type: 'openBlueprint',
                    blueprint: 'symbol-detail',
                    variables: {symbol: {$row: 'symbol'}, asOf: {$var: 'asOf'}, top: 10}
                }
            }
        ]);
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            rows = () =>
                [...container.querySelectorAll('.xh-blueprint-element-inspector__link-value')].map(
                    it => [
                        it.querySelector('.xh-blueprint-element-inspector__label').textContent,
                        it.querySelector('.xh-blueprint-element-inspector__var-chip')
                            ?.textContent ?? it.querySelector('input')?.value
                    ]
                );
        fireEvent.click(
            container.querySelector('[data-config-key="rowActions"] .xh-sortable-list__expander')
        );
        expect(rows()).toEqual([
            ['symbol', 'row · symbol'],
            ['asOf', 'asOf'],
            ['top', '10']
        ]);
        expect(container.querySelector('[data-config-key="rowActions"] .xh-json-input')).toBeNull();

        const before = model.history.length;
        fireEvent.click(
            container.querySelector('.xh-blueprint-element-inspector__link-value [title="Remove"]')
        );
        expect(model.blueprint.elements.posGrid.config.rowActions[0].action.variables).toEqual({
            asOf: {$var: 'asOf'},
            top: 10
        });
        expect(model.history.length).toBe(before + 1);
    });

    it('edits a selected canvas view: its header, the inputs in it, and its place, each one edit', () => {
        const {design, model} = open();
        design.select({kind: 'view', id: 'posGrid', of: 'positions'});
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            titles = bandsOf(container),
            cell = () =>
                model.blueprint.elements.positions.children.find(it => it.id === 'posGrid') as any;
        expect(titles).toEqual(['Header', 'Header items 2', 'Placement in positions']);
        expect(container.textContent).toContain('posViewsSelector');
        expect(
            container.querySelectorAll(
                '.xh-blueprint-element-inspector__placement-row .xh-blueprint-element-inspector__row'
            )
        ).toHaveLength(4);
        // The widget's own config stays in its own inspector.
        expect(container.querySelector('[data-config-key="source"]')).toBeNull();

        const before = model.history.length;
        fireEvent.click(
            [...container.querySelectorAll('[data-config-key="hideHeader"] button')].find(
                it => it.textContent === 'Hide'
            )
        );
        expect(cell().hideHeader).toBe(true);
        expect(cell().headerItems).toEqual([{id: 'groupChooser'}, {id: 'posViewsSelector'}]);
        expect(model.history.length).toBe(before + 1);
        expect(model.history.at(-1).description).toBe('posGrid view: hide header');
        expect(container.querySelector('.xh-blueprint-element-inspector__remove').textContent).toBe(
            'Remove posGrid and its view'
        );
    });

    it("folds a widget's canvas view settings into a section, with a way to select the view", () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement);
        fireEvent.click(screen.getByText('View'));
        expect(container.querySelector('[data-config-key="hideHeader"]')).not.toBeNull();
        fireEvent.click(screen.getByText('Select the view'));
        expect(design.selection).toEqual({kind: 'view', id: 'posGrid', of: 'positions'});
    });

    it('refuses to switch a list to one value its first item does not fit, keeping the list', () => {
        const registry = scenarioRegistry();
        registry.addWidgets({
            name: 'acme.tags',
            label: 'Tags',
            guidance: 'Tags.',
            version: 1,
            category: 'content',
            config: {
                type: 'object',
                properties: {
                    tags: {anyOf: [{enum: ['a', 'b']}, {type: 'array', items: {type: 'string'}}]}
                }
            }
        } as any);
        const model = new BlueprintModel({
                blueprint: {
                    schema: {blueprint: 1},
                    root: 'tags',
                    elements: {tags: {component: 'acme.tags', config: {tags: ['c']}}}
                } as any,
                catalog: portfolioCatalog,
                registry,
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model});
        onTestFinished(() => {
            design.destroy();
            model.destroy();
        });
        design.select({kind: 'element', id: 'tags'});
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = () => container.querySelector('[data-config-key="tags"]');
        fireEvent.click(row().querySelectorAll('.xh-button-group button')[0]);
        expect(model.blueprint.elements.tags.config.tags).toEqual(['c']);
        expect(row().querySelector('.xh-blueprint-element-inspector__issue').textContent).toMatch(
            /cannot take "c"/
        );
    });

    it("sets a dashboard's packing from picture cards and its gap from two numbers, each one edit", () => {
        const {design, model} = open('p3-morning-report.json', 'overview'),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = (key: string) => container.querySelector(`[data-config-key="${key}"]`),
            config = () => model.blueprint.elements.overview.config ?? {};
        expect(row('compact').textContent).toContain('Free');
        expect(row('rowHeight').querySelector('input').placeholder).toBe('50');
        expect(row('compact').querySelectorAll('.xh-blueprint-preview')).toHaveLength(3);
        const inputs = row('margin').querySelectorAll('input');
        expect([...inputs].map(it => it.placeholder)).toEqual(['10', '10']);
        const before = model.history.length;
        fireEvent.focus(inputs[1]);
        fireEvent.change(inputs[1], {target: {value: '4'}});
        fireEvent.blur(inputs[1]);
        expect(config().margin).toEqual([10, 4]);
        expect(model.history.length).toBe(before + 1);
    });

    it("lists a container's children to select, reorder and remove, each one edit, with Add below", async () => {
        const {design, model} = open('p2-linked-dashboard.json', 'posGrid'),
            box = design.addWidget('box').id,
            a = design.addWidget('markdown', box).id,
            b = design.addWidget('markdown', box).id;
        design.select({kind: 'element', id: box});
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            kids = () => model.blueprint.elements[box].children.map(it => it.id),
            rows = () =>
                [...container.querySelectorAll('[data-child]')].map(it =>
                    it.getAttribute('data-child')
                );
        expect(bandsOf(container)).toContain('Children 2');
        expect(rows()).toEqual([a, b]);
        const edits = model.history.length;
        await altDown(
            container
                .querySelector(`[data-child="${a}"]`)
                .closest('.xh-sortable-list__item')
                .querySelector('.xh-sortable-list__handle')
        );
        expect(kids()[kids().length - 1]).toBe(a);
        expect(model.history.length).toBeGreaterThan(edits);
        await vi.waitFor(() => expect(rows()).toEqual([b, a]));
        fireEvent.click(
            container.querySelector(`[data-child="${b}"] .xh-blueprint-element-inspector__child-id`)
        );
        expect(design.selectedElementId).toBe(b);
    });

    it('lists the cells of a dashboard as views without reordering, as their layout places them', () => {
        const {design} = open('p3-morning-report.json', 'positions'),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = container.querySelector<HTMLElement>('[data-child="posGrid"]');
        expect(container.querySelectorAll('[data-child]').length).toBeGreaterThan(1);
        expect(
            container.querySelector('.xh-blueprint-element-inspector__columns--fixed')
        ).not.toBeNull();
        expect(row.querySelector('.xh-blueprint-element-inspector__child-id').textContent).toBe(
            design.blueprintModel.blueprint.elements.posGrid.config?.title ?? 'posGrid'
        );
        expect(row.querySelector('.xh-blueprint-element-inspector__column-meta').textContent).toBe(
            'View'
        );
        fireEvent.click(row.querySelector('.xh-blueprint-element-inspector__child-id'));
        expect(design.selection).toEqual({kind: 'view', id: 'posGrid', of: 'positions'});
    });

    it("edits a selected panes widget view's title, its one setting", () => {
        const model = new BlueprintModel({
                blueprint: {
                    schema: {blueprint: 1},
                    root: 'dock',
                    elements: {
                        dock: {component: 'panes', children: [{id: 'a', title: 'Risk'}]},
                        a: {component: 'markdown', config: {text: 'A'}}
                    }
                },
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            inspector = new ElementInspectorModel(design);
        onTestFinished(() => {
            inspector.destroy();
            design.destroy();
            model.destroy();
        });
        design.select({kind: 'view', id: 'a', of: 'dock'});
        const {container} = render(elementInspector({designModel: design}) as ReactElement);
        expect(bandsOf(container)).toEqual(['Header']);
        expect(container.querySelector('[data-config-key="hideHeader"]')).toBeNull();
        expect(inspector.dashboardId).toBeNull();
        inspector.commitPlacement('title', 'Exposure');
        expect(model.blueprint.elements.dock.children[0]).toEqual({id: 'a', title: 'Exposure'});
        expect(model.history.at(-1).description).toBe('a view: title');
    });

    describe('sort by', () => {
        const setup = (initial: unknown) => {
            const {design, model} = open('p2-linked-dashboard.json');
            design.setConfig('posGrid', '/sortBy', initial);
            const {container} = render(elementInspector({designModel: design}) as ReactElement),
                row = () => container.querySelector('[data-config-key="sortBy"]'),
                keys = () =>
                    [...row().querySelectorAll('[data-sort-field]')].map(it =>
                        it.getAttribute('data-sort-field')
                    ),
                key = (field: string) => row().querySelector(`[data-sort-field="${field}"]`),
                sortBy = () => model.blueprint.elements.posGrid.config.sortBy;
            return {design, model, container, row, keys, key, sortBy};
        };

        // Open a Hoist select, and pick the field with the given name.
        const choose = (selectEl: Element, name: string) => {
            fireEvent.keyDown(selectEl.querySelector('input'), {key: 'ArrowDown', keyCode: 40});
            fireEvent.click(
                [...document.querySelectorAll('.xh-select__option')].find(it =>
                    it.textContent.endsWith(name)
                )
            );
        };

        it('shows its keys as chips with their directions, and no form switch or raw text', () => {
            const {row} = setup(['pnlDay|desc', 'symbol']);
            expect(
                [...row().querySelectorAll('.xh-chip')].map(it => it.getAttribute('aria-label'))
            ).toEqual([
                expect.stringMatching(/, descending$/),
                expect.stringMatching(/, ascending$/)
            ]);
            expect(row().textContent).toContain('pnlDay');
            expect(row().querySelector('.xh-blueprint-element-inspector__one-of')).toBeNull();
            expect(row().querySelector('input[type="text"]')).toBeNull();
        });

        it('adds, flips, reorders and removes keys from its drawer, each one edit', async () => {
            const {model, row, keys, key, sortBy} = setup('pnlDay|desc'),
                edits = () => model.history.length,
                before = edits();
            fireEvent.click(row().querySelector('[title="Settings"]'));
            expect(keys()).toEqual(['pnlDay']);

            fireEvent.click(within(key('pnlDay') as HTMLElement).getByText('Asc'));
            expect(sortBy()).toBe('pnlDay');
            expect(edits()).toBe(before + 1);

            choose(
                row().querySelector('.xh-blueprint-element-inspector__sort-drawer > .xh-select'),
                'mktVal'
            );
            expect(sortBy()).toEqual(['pnlDay', 'mktVal']);
            expect(edits()).toBe(before + 2);

            await altDown(
                key('pnlDay')
                    .closest('.xh-sortable-list__item')
                    .querySelector('.xh-sortable-list__handle')
            );
            expect(sortBy()).toEqual(['mktVal', 'pnlDay']);

            fireEvent.click(within(key('mktVal') as HTMLElement).getByTitle('Remove mktVal'));
            expect(sortBy()).toBe('pnlDay');
        });

        it('keeps a part it has no control for, such as abs, as a tag on its key', () => {
            const {row, key, sortBy} = setup('mktVal|desc|abs');
            fireEvent.click(row().querySelector('[title="Settings"]'));
            expect(
                key('mktVal').querySelector('.xh-blueprint-element-inspector__sort-tag').textContent
            ).toBe('abs');
            fireEvent.click(within(key('mktVal') as HTMLElement).getByText('Asc'));
            expect(sortBy()).toBe('mktVal|abs');
            expect(row().querySelector('.xh-blueprint-element-inspector__issue')).toBeNull();
        });

        it('leaves the sort unset once its last key goes, and reads None', () => {
            const {model, row, keys} = setup('pnlDay');
            fireEvent.click(row().querySelector('[title="Settings"]'));
            fireEvent.click(row().querySelector('[title="Remove pnlDay"]'));
            expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('sortBy');
            expect(keys()).toEqual([]);
            expect(row().textContent).toContain('None');
        });
    });

    it("sets a grid's summary row from cards for Top, Bottom and Off, each one edit", () => {
        const {design, model, inspector} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = container.querySelector('[data-config-key="showSummary"]');
        expect(row.querySelector('.xh-blueprint-element-inspector__label').textContent).toBe(
            'Summary row'
        );
        expect(
            [...row.querySelectorAll('[role=radio] .xh-radio-card-input__label')].map(
                it => it.textContent
            )
        ).toEqual(['Top', 'Bottom', 'Off']);
        // Each card pictures its choice.
        expect(row.querySelectorAll('[role=radio] svg.xh-blueprint-preview')).toHaveLength(3);

        const before = model.history.length;
        inspector.commit('showSummary', 'bottom');
        expect(model.blueprint.elements.posGrid.config.showSummary).toBe('bottom');
        inspector.commit('showSummary', undefined);
        expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('showSummary');
        expect(model.history.length).toBe(before + 2);
    });

    it('draws sections under bands counting what is set, and a one-line value beside its label', () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = (label: string) =>
                [...container.querySelectorAll('.xh-blueprint-element-inspector__row')].find(
                    it => it.firstElementChild?.textContent === label
                );
        // Each band counts what is set in it: posGrid's source, sort, and its bound grouping and
        // filter. A band with nothing set shows no count.
        expect(bandsOf(container)).toEqual([
            'Data 4',
            'Display',
            'Columns 4 Preset · P&L view',
            'Interaction',
            'Style',
            'View'
        ]);
        // A dashboard cell's place sits in its View card, folded until opened.
        expect(
            container.querySelectorAll(
                '.xh-blueprint-element-inspector__placement-row .xh-blueprint-element-inspector__row'
            )
        ).toHaveLength(0);
        // Removing it is a danger action at the very end.
        const remove = container.querySelector('.xh-blueprint-element-inspector__remove');
        expect(remove.textContent).toBe('Remove posGrid');
        expect(remove.className).toMatch(/intent-danger/);
        expect(remove).toBe(container.firstElementChild.lastElementChild);
        expect(row('Title').className).toContain('__row--inline');
        expect(row('Column state').className).not.toContain('__row--inline');
    });

    it('folds a section from anywhere on its band, by click, Enter or Space, and says if it is open', () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            band = () =>
                [
                    ...container.querySelectorAll('.xh-blueprint-element-inspector__card-header')
                ].find(it => it.textContent.startsWith('Style')),
            toggle = () => band().querySelector('.xh-blueprint-element-inspector__card-toggle'),
            styleRow = () => container.querySelector('[data-config-key="stripeRows"]');
        expect(band().getAttribute('role')).toBeNull();
        expect(toggle().getAttribute('role')).toBe('button');
        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(band().querySelector('.xh-blueprint-element-inspector__card-chevron'));
        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(styleRow()).not.toBeNull();
        // Each row is a group named for its property, so its controls read with it.
        expect(styleRow().getAttribute('role')).toBe('group');
        expect(styleRow().getAttribute('aria-label')).toBe('Stripe rows');
        fireEvent.keyDown(toggle(), {key: 'Enter'});
        expect(styleRow()).toBeNull();
        fireEvent.keyDown(toggle(), {key: ' '});
        expect(styleRow()).not.toBeNull();
    });

    it('shows a bound field as its variable with a way to unbind, and offers to bind the rest', async () => {
        const {design, model} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            row = (label: string) =>
                [...container.querySelectorAll('.xh-blueprint-element-inspector__row')].find(
                    it => it.firstElementChild?.textContent === label
                );
        const chip = row('Group by').querySelector('.xh-blueprint-element-inspector__var-chip');
        expect(chip.textContent).toBe('grouping');
        // A bound value is not personalized in its place, but through its variable.
        expect(chip.getAttribute('title')).toMatch(/Set by variable grouping, .* not here/);
        expect(
            [...container.querySelectorAll('.xh-blueprint-element-inspector__bind-button')].map(
                it =>
                    it.closest('.xh-blueprint-element-inspector__row').firstElementChild.textContent
            )
        ).toEqual(['Summary row', 'Title']);
        // The chip says how to unbind, and its visible × or Delete unbinds, in one edit.
        expect(chip.getAttribute('aria-keyshortcuts')).toBe('Delete Backspace');
        expect(chip.getAttribute('aria-label')).toMatch(/Delete unbinds\.$/);
        const edits = model.history.length;
        fireEvent.keyDown(chip, {key: 'Delete'});
        expect(model.history.length).toBe(edits + 1);
        expect(model.blueprint.elements.posGrid.config.groupBy).not.toEqual({$var: 'grouping'});
        // Focus stays in the row, on the editor that took the chip's place.
        await vi.waitFor(() => expect(row('Group by').contains(document.activeElement)).toBe(true));
    });

    it('says where users change a bound value that they could change in its place', () => {
        const {design, model} = open();
        model.applyEdit({
            ops: [
                {
                    op: 'set',
                    path: '/variables/label',
                    value: {type: 'string', setBy: 'prompt', default: {value: 'Book'}}
                },
                {op: 'set', path: '/elements/posGrid/config/title', value: {$var: 'label'}},
                {op: 'set', path: '/elements/posGrid/personalizable', value: ['/config/title']}
            ]
        });
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            note = container.querySelector(
                '[data-config-key="title"] .xh-blueprint-element-inspector__bound-note'
            );
        expect(note.textContent).toBe('Users change this through label');
        fireEvent.click(note.querySelector('[role=button]'));
        expect(design.selection).toEqual({kind: 'variable', id: 'label'});
    });

    it('badges a section that holds a preset path, and selects its group from the badge', () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            badge = container.querySelector('.xh-blueprint-element-inspector__card-badge');
        expect(badge.closest('.xh-blueprint-element-inspector__card-header').textContent).toContain(
            'Columns'
        );
        // The badge sits beside the band's toggle, not inside it.
        expect(badge.closest('[role="button"][aria-expanded]')).toBeNull();
        expect(badge.textContent).toBe('Preset · P&L view');
        fireEvent.click(badge);
        expect(design.selection).toEqual({kind: 'preset', id: 'posViews'});
    });

    it('places a tab by its title and icon in one row, with an icon picker', () => {
        const {design} = open();
        design.select({kind: 'element', id: 'overview'});
        const {container} = render(elementInspector({designModel: design}) as ReactElement),
            labels = [
                ...container.querySelectorAll(
                    '.xh-blueprint-element-inspector__placement-row .xh-blueprint-element-inspector__label'
                )
            ].map(it => it.textContent);
        expect(labels).toEqual(['Title*', 'Icon']);
        expect(container.querySelector('[data-config-key="icon"] .xh-icon-picker')).toBeTruthy();
    });

    it('draws a labelled editor per property', () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            labels = [...container.querySelectorAll('.xh-blueprint-element-inspector__label')].map(
                it => it.textContent
            );
        expect(labels).toEqual(expect.arrayContaining(['Source*', 'Title', 'Group by']));
        expect(container.textContent).not.toContain('No model found');
    });
});

// The chevron that opens a list item's settings, from anything in its row.
function chevronOf(el: Element): HTMLElement {
    return el.closest('.xh-sortable-list__item').querySelector('.xh-sortable-list__expander');
}
