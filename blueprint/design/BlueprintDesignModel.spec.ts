import {initTestAppAsync} from '@xh/hoist/test-support';
import {cloneDeep} from 'lodash';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import type {Blueprint} from '../Blueprint';
import {BlueprintModel} from '../BlueprintModel';
import {FakeBlueprintDataProvider} from '../FakeBlueprintDataProvider';
import {viewTitle} from '../impl/elements';
import {BlueprintDesignModel} from './BlueprintDesignModel';

/**
 * Design mode for people: each change a designer makes is one edit, by the user, with a
 * description, so undo and history work, and the blueprint stays valid.
 */
describe('BlueprintDesignModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(blueprint: Blueprint, opts: {isAnswer?: boolean} = {}) {
        const model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write',
                isAnswer: opts.isAnswer
            }),
            design = new BlueprintDesignModel({blueprintModel: model});
        onTestFinished(() => {
            design.destroy();
            model.destroy();
        });
        return {model, design};
    }
    const errors = (r: {issues: {severity: string}[]}) =>
        r.issues.filter(it => it.severity === 'error');

    it('reveals what an issue names, by its path: an element, a variable, a source or a preset group', () => {
        const {design} = open(loadBlueprint('p3-morning-report.json'));
        design.revealIssue({path: '/elements/posGrid/config/columnState/2'} as any);
        expect(design.selection).toEqual({kind: 'element', id: 'posGrid'});
        design.revealIssue({path: '/variables/asOf/default'} as any);
        expect(design.selection).toEqual({kind: 'variable', id: 'asOf'});
        design.revealIssue({path: '/sources/prices/params/symbol'} as any);
        expect(design.selection).toEqual({kind: 'source', id: 'prices'});
        design.revealIssue({path: '/presets/posViews/items/pnl'} as any);
        expect(design.selection).toEqual({kind: 'preset', id: 'posViews'});
        design.revealIssue({path: '/elements/nope'} as any);
        expect(design.selection).toEqual({kind: 'preset', id: 'posViews'});
    });

    it('selects a dashboard view: the cell that holds an element, which exists while the cell does', () => {
        const {design, model} = open(loadBlueprint('p3-morning-report.json'));
        expect(design.viewOf('posGrid')).toEqual({id: 'posGrid', of: 'positions'});
        // A tab's child and the root sit in no dashboard cell.
        expect(design.viewOf('positions')).toBeNull();
        expect(design.viewOf('tabs')).toBeNull();

        design.select({kind: 'view', id: 'posGrid', of: 'positions'});
        expect(design.selectedViewId).toBe('posGrid');
        expect(design.selectedElementId).toBeNull();

        // Removing the element takes its cell, so the selection goes.
        design.removeElement('posGrid');
        expect(model.blueprint.elements).not.toHaveProperty('posGrid');
        expect(design.selection).toBeNull();
    });

    it('moves an element any number of places in its slot list, as a drag in a list does', () => {
        const {design, model} = open(loadBlueprint('p3-morning-report.json'));
        design.reorder('groupChooser', 2);
        expect(model.blueprint.elements.positions.children.map(it => it.id)).toEqual([
            'pnlButtons',
            'posGrid',
            'groupChooser',
            'priceChart'
        ]);
        design.reorder('groupChooser', -2);
        expect(model.blueprint.elements.positions.children[0].id).toBe('groupChooser');
    });

    describe('editing calls for the dashboard', () => {
        const p3 = () => open(loadBlueprint('p3-morning-report.json'));
        const cellOf = (model: BlueprintModel, id: string) =>
            Object.values(model.blueprint.elements)
                .flatMap(it => it.children ?? [])
                .find(it => it.id === id) as any;

        it('names the elements that read a selected source, variable or preset group', () => {
            const {design} = p3();
            expect(design.readerIds).toEqual([]);
            design.select({kind: 'source', id: 'positions'});
            expect(design.readerIds.sort()).toEqual(
                [
                    'headlineMktVal',
                    'headlinePnlDay',
                    'headlinePnlMtd',
                    'headlinePnlYtd',
                    'posGrid',
                    'regionChart',
                    'sectorChart'
                ].sort()
            );
            const joined = open(loadBlueprint('p8-joined-positions.json')).design;
            joined.select({kind: 'source', id: 'funds'});
            expect(joined.readerIds).toEqual(['posGrid']);
            design.select({kind: 'variable', id: 'grouping'});
            expect(design.readerIds).toContain('posGrid');
            expect(design.readerIds).not.toContain('groupChooser');
            design.select({kind: 'preset', id: 'posViews'});
            expect(design.readerIds).toEqual(
                expect.arrayContaining(['posGrid', 'posViewsSelector'])
            );
        });

        it('names an app widget by the last part of its dotted name, adding or duplicating it', () => {
            const {design} = p3(),
                added = design.addWidget('toolbox.portfolioBuilder', 'overview');
            expect(added.issues.filter(it => it.severity === 'error')).toEqual([]);
            expect(added.id).toBe('portfolioBuilder1');
            const copy = design.duplicateElement('portfolioBuilder1');
            expect(copy.issues.filter(it => it.severity === 'error')).toEqual([]);
            expect(copy.id).toBe('portfolioBuilder2');
        });

        it('copies the active preset values of what it duplicates as plain config', () => {
            const {model, design} = p3(),
                columnState = model.effective.elements.posGrid.config.columnState,
                {id, issues} = design.duplicateElement('posGrid');
            expect(issues.filter(it => it.severity === 'error')).toEqual([]);
            expect(columnState).toBeTruthy();
            expect(model.blueprint.elements[id].config.columnState).toEqual(columnState);
            expect(model.blueprint.presets.posViews.controls).toHaveLength(1);
        });

        it('names the sibling before or after an element in its slot', () => {
            const {design} = p3();
            expect(design.siblingOf('posGrid', 1)).toBe('priceChart');
            expect(design.siblingOf('posGrid', -1)).toBe('pnlButtons');
            expect(design.siblingOf('groupChooser', -1)).toBeNull();
            expect(design.siblingOf('tabs', 1)).toBeNull();
        });

        it('offers the places to add into from an element: its own slots and its cell header', () => {
            const {design, model} = p3(),
                {registry} = model,
                [cellHeader] = design.addPlacesFor('posGrid');
            expect(design.addPlacesFor('posGrid')).toHaveLength(1);
            expect(cellHeader.place).toEqual({
                parent: 'positions',
                slot: 'headerItems',
                of: 'posGrid'
            });
            expect(cellHeader.widgets.length).toBeGreaterThan(0);
            expect(cellHeader.widgets.every(it => registry.widgets[it].category === 'input')).toBe(
                true
            );
            const [children] = design.addPlacesFor('positions');
            expect(children.place).toEqual({parent: 'positions', slot: 'children'});
            expect(children.widgets).toContain('chart');
        });

        it('wraps an element in a panel in one edit, which takes its place, title and cell header', () => {
            const {design, model} = p3();
            design.setConfig('posGrid', '/title', 'Book');
            const {id, issues} = design.wrapInPanel('posGrid'),
                {elements} = model.blueprint,
                cell = elements.positions.children.find(it => it.id === id);
            expect(issues.filter(it => it.severity === 'error')).toEqual([]);
            expect(elements[id]).toMatchObject({
                component: 'panel',
                config: {title: 'Book'},
                children: [{id: 'posGrid'}]
            });
            expect(elements.posGrid.config.title).toBeUndefined();
            expect(cell).toMatchObject({
                x: 0,
                y: 1,
                w: 8,
                h: 9,
                headerItems: [{id: 'posViewsSelector'}]
            });
            expect(design.selectedElementId).toBe(id);
            model.undo();
            expect(model.blueprint.elements[id]).toBeUndefined();
        });

        it('selects the original when an undo takes away the copy selected', () => {
            const {model, design} = p3(),
                {id} = design.duplicateElement('sectorChart');
            expect(design.selectedElementId).toBe(id);
            model.undo();
            expect(design.selectedElementId).toBe('sectorChart');
        });

        it('counts a tab title as a read, both to wash and to refuse a delete', () => {
            const {design} = p3();
            const {issues} = design.setChildTitle('positions', '{fund} book');
            expect(issues.filter(it => it.severity === 'error')).toEqual([]);
            design.select({kind: 'variable', id: 'fund'});
            expect(design.readerIds).toContain('tabs');
            expect(design.removeVariable('fund').issues[0].message).toMatch(/tabs/);
        });

        it('keeps a variable that an element of the same name reads, when its writer goes', () => {
            const {model, design} = p3(),
                {issues} = model.applyEdit({
                    ops: [
                        {
                            op: 'addElement',
                            id: 'noteInput',
                            element: {component: 'textInput', config: {label: 'Note'}},
                            parent: 'positions',
                            child: {x: 0, y: 20, w: 4, h: 1}
                        },
                        {
                            op: 'addElement',
                            id: 'note',
                            element: {component: 'markdown', config: {text: 'Note: {note}'}},
                            parent: 'positions',
                            child: {x: 4, y: 20, w: 4, h: 1}
                        },
                        {
                            op: 'set',
                            path: '/variables/note',
                            value: {type: 'string', setBy: {element: 'noteInput'}}
                        }
                    ]
                });
            expect(issues.filter(it => it.severity === 'error')).toEqual([]);
            expect(design.describeRemoval('noteInput')).toMatchObject({
                removedVariables: [],
                unboundVariables: ['note']
            });
        });

        it('moves into a slot of any container, or says why it cannot, applying nothing', () => {
            const {model, design} = p3(),
                header = {parent: 'positions', slot: 'headerItems', of: 'priceChart'};
            expect(design.canMoveToPlace('posGrid', header).map(it => it.code)).not.toEqual([]);
            expect(design.canMoveToPlace('groupChooser', header)).toEqual([]);
            expect(model.history).toHaveLength(0);
            expect(
                design
                    .moveToPlace('groupChooser', header)
                    .issues.filter(it => it.severity === 'error')
            ).toEqual([]);
            expect(cellOf(model, 'priceChart').headerItems).toEqual([{id: 'groupChooser'}]);
            expect(
                design.canMoveToPlace('positions', {parent: 'posGrid', slot: 'children'})
            ).not.toEqual([]);
        });

        it('tracks the hovered element as view state, never an edit', () => {
            const {model, design} = p3();
            design.setHovered('posGrid');
            expect(design.hoveredId).toBe('posGrid');
            expect(model.history).toHaveLength(0);
        });

        it('dry-runs a move, applying nothing', () => {
            const {model, design} = p3();
            expect(design.canMoveTo('positions', 'posGrid', 'into').map(it => it.code)).toEqual([
                'edit.refused'
            ]);
            expect(design.canMoveTo('priceChart', 'groupChooser', 'before')).toEqual([]);
            expect(model.history).toHaveLength(0);
        });

        it('duplicates an element and its subtree with fresh ids, in one edit, and selects the copy', () => {
            const {model, design} = p3(),
                before = Object.keys(model.blueprint.elements).length,
                headlineKids = model.blueprint.elements.headline.children.length,
                ret = design.duplicateElement('headline');
            expect(ret.issues.filter(it => it.severity === 'error')).toEqual([]);
            const copy = model.blueprint.elements[ret.id];
            expect(copy.component).toBe('tileFrame');
            expect(copy.children).toHaveLength(headlineKids);
            expect(
                copy.children.every(
                    it => !model.blueprint.elements.headline.children.some(o => o.id === it.id)
                )
            ).toBe(true);
            expect(Object.keys(model.blueprint.elements)).toHaveLength(before + 1 + headlineKids);
            expect(model.history).toHaveLength(1);
            expect(design.selection).toEqual({kind: 'element', id: ret.id});
            model.undo();
            expect(model.blueprint.elements[ret.id]).toBeUndefined();
        });

        it('nudges a dashboard cell by whole units, folding repeats within a second into one edit', () => {
            const {model, design} = p3(),
                w = cellOf(model, 'posGrid').w;
            design.nudgeChild('posGrid', {dw: -1});
            design.nudgeChild('posGrid', {dw: -1});
            expect(cellOf(model, 'posGrid').w).toBe(w - 2);
            expect(model.history).toHaveLength(1);
            model.undo();
            expect(cellOf(model, 'posGrid').w).toBe(w);
        });

        it('moves an element one place earlier or later in its slot', () => {
            const {model, design} = p3(),
                order = () => model.blueprint.elements.tabs.children.map(it => it.id);
            design.reorder('positions', -1);
            expect(order()).toEqual(['positions', 'overview', 'orders']);
            design.reorder('positions', 1);
            expect(order()).toEqual(['overview', 'positions', 'orders']);
        });

        it("names an element's ancestors, root first, and what the Architect's last edit touched", () => {
            const {model, design} = p3();
            expect(design.pathTo('posGrid')).toEqual(['tabs', 'positions']);
            model.applyEdit({
                author: 'architect',
                ops: [{op: 'set', path: '/elements/posGrid/config/title', value: 'Held'}]
            });
            expect(design.lastArchitectTouched).toEqual(['posGrid']);
        });
    });

    it('has no design mode for a chat answer', () => {
        expect(() => open(loadBlueprint('w3-segment-1.json'), {isAnswer: true})).toThrow(
            /answer has no design mode/
        );
    });

    it.each([
        'cubeGrid',
        'chart',
        'statCard',
        'groupingChooser',
        'buttonGroup',
        'buttonGroupInput',
        'dashboard',
        'tabContainer',
        'tileFrame',
        'toolbar',
        'select',
        'dateInput',
        'numberInput',
        'textInput',
        'switchInput',
        'slider',
        'filterChooser',
        'treemap',
        'propertyTable',
        'heatmap',
        'panes'
    ])('adds a %s that starts valid, on the first free place of the root canvas', component => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            result = design.addWidget(component);
        expect(errors(result)).toEqual([]);
        expect(model.blueprint.elements[result.id].component).toBe(component);
        const ref = model.blueprint.elements.dashboard.children.find(it => it.id === result.id);
        expect(ref).toMatchObject({x: expect.any(Number), y: expect.any(Number)});
        expect(model.history.at(-1)).toMatchObject({author: 'user'});
    });

    it('starts widgets with configs that show data: distinct values, fields used once, totals', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            config = (component: string) => {
                const {id} = design.addWidget(component);
                return model.blueprint.elements[id].config;
            },
            fields = portfolioCatalog.getDataset('positions').fields,
            totals = (name: string) =>
                ![null, undefined, 'UNIQUE'].includes(fields[name]?.aggregator as string);

        const toggle = config('buttonGroupInput');
        expect(new Set(toggle.options.map(it => it.value)).size).toBe(toggle.options.length);

        const grid = config('cubeGrid');
        expect(grid.columnState.length).toBeGreaterThan(0);
        grid.columnState.forEach(it => {
            expect(grid.groupBy).not.toContain(it);
            expect(totals(it)).toBe(true);
        });

        const chart = config('chart');
        expect(totals(chart.y[0])).toBe(true);

        expect(totals(config('statCard').field)).toBe(true);
    });

    it('starts a widget with no optional extras, numbers at their defaults, and text that says what to write', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            config = (component: string) => {
                const {id} = design.addWidget(component);
                return model.blueprint.elements[id].config;
            };
        const card = config('statCard');
        expect(card).not.toHaveProperty('deltaField');
        expect(card).not.toHaveProperty('trend');
        expect(config('chart')).not.toHaveProperty('groupBy');
        expect(config('treemap')).not.toHaveProperty('heat');
        expect(config('slider')).toMatchObject({min: 0, max: 100});
        expect(config('markdown').text).toMatch(/inspector/);
        expect(config('callout').text).toMatch(/inspector/);
        expect(config('buttonGroup').buttons[0].label).toBe('Refresh');
    });

    it('sets the variable an input shows, an existing one of its type or a new one, in one edit', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            {id} = design.addWidget('dateInput');
        expect(design.inputVariableOptions(id)).toEqual(['asOf']);

        design.setInputVariable(id, 'asOf');
        expect(model.blueprint.variables.asOf.setBy).toEqual({element: id});

        design.setInputVariable(id, 'tradeDate');
        expect(model.blueprint.variables.tradeDate).toEqual({
            type: 'localDate',
            label: 'Trade Date',
            setBy: {element: id}
        });
        expect(model.blueprint.variables.asOf).not.toHaveProperty('setBy');
        model.undo();
        expect(model.blueprint.variables.asOf.setBy).toEqual({element: id});
    });

    it('adds a widget at a place given, moving its siblings in the same edit', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            siblings = model.blueprint.elements.dashboard.children.map(it =>
                it.id === 'ordersGrid' ? {...it, y: 20} : it
            ),
            {id} = design.addWidget('chart', 'dashboard', {
                child: {x: 0, y: 14, w: 4, h: 6},
                siblings
            });
        const {children} = model.blueprint.elements.dashboard;
        expect(children.find(it => it.id === id)).toEqual({id, x: 0, y: 14, w: 4, h: 6});
        expect(children.find(it => it.id === 'ordersGrid').y).toBe(20);
        model.undo();
        expect(
            model.blueprint.elements.dashboard.children.find(it => it.id === 'ordersGrid').y
        ).toBe(9);
    });

    it('adds a widget with other ops that name it, in the same edit', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            version = model.version,
            {id, issues} = design.addWidget('markdown', 'dashboard', {
                child: {x: 0, y: 14, w: 4, h: 2},
                extraOps: newId => [
                    {op: 'set', path: '/elements/dashboard/config/emptyText', value: newId}
                ]
            });
        expect(issues).toEqual([]);
        expect(model.blueprint.elements.dashboard.config.emptyText).toBe(id);
        expect(model.version).toBe(version + 1);
        model.undo();
        expect(model.blueprint.elements[id]).toBeUndefined();
    });

    it('moves an element into a container, or before or after another, as one edit', () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json')),
            ids = (parent: string) => model.blueprint.elements[parent].children.map(it => it.id);

        expect(design.moveTo('priceChart', 'groupChooser', 'before').issues).toEqual([]);
        expect(ids('positions').indexOf('priceChart')).toBe(
            ids('positions').indexOf('groupChooser') - 1
        );
        expect(
            model.blueprint.elements.positions.children.find(it => it.id === 'priceChart')
        ).toMatchObject({
            x: 8,
            y: 1,
            w: 4,
            h: 9
        });

        expect(design.moveTo('sectorChart', 'positions', 'into').issues).toEqual([]);
        const moved = model.blueprint.elements.positions.children.find(
            it => it.id === 'sectorChart'
        );
        expect(moved).toMatchObject({w: expect.any(Number), h: expect.any(Number)});
        expect(ids('overview')).not.toContain('sectorChart');

        expect(design.moveTo('positions', 'posGrid', 'into').issues[0].message).toMatch(/inside/);
        expect(design.moveTo('posGrid', 'priceChart', 'into').issues[0].message).toMatch(
            /holds no/
        );
    });

    describe('slots', () => {
        const withPanel = () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.elements.page = {
                component: 'panel',
                config: {title: 'Page'},
                children: [{id: 'ordersGrid'}]
            };
            bp.elements.dashboard.children = bp.elements.dashboard.children.map(it =>
                it.id === 'ordersGrid' ? {...it, id: 'page'} : it
            );
            return bp;
        };

        it('adds into a named slot, and after an element in the slot that holds it', () => {
            const {model, design} = open(withPanel()),
                {id: rule} = design.addWidget('separator', 'page', {slot: 'bbar'});
            expect(model.blueprint.elements.page.bbar).toEqual([{id: rule}]);
            design.select({kind: 'element', id: rule});
            expect(design.addTarget).toEqual({parent: 'page', slot: 'bbar', after: rule});
            const {id: next} = design.addWidget('spacer');
            expect((model.blueprint.elements.page.bbar as any[]).map(it => it.id)).toEqual([
                rule,
                next
            ]);
        });

        it('moves beside an element into the slot that holds it, and removes what a slot holds with its parent', () => {
            const {model, design} = open(withPanel()),
                {id: bar} = design.addWidget('toolbar', 'page', {slot: 'tbar'}),
                {id: other} = design.addWidget('separator', 'page');
            expect(design.moveTo(other, bar, 'after').issues).toEqual([]);
            expect((model.blueprint.elements.page.tbar as any[]).map(it => it.id)).toEqual([
                bar,
                other
            ]);
            expect(design.describeRemoval('page').elements).toEqual(
                expect.arrayContaining(['page', 'ordersGrid', bar, other])
            );
        });

        it("adds a group's selector to the header of the widget it controls, on a dashboard or in a panel", () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            design.removeElement('posViewsSelector');
            const {id} = design.addPresetSelector('posViews');
            const cell = model.blueprint.elements.positions.children.find(
                it => it.id === 'posGrid'
            );
            expect(cell.headerItems).toEqual([{id}]);
        });
    });

    it('places a widget where it fits, and names it after its widget', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            first = design.addWidget('chart'),
            second = design.addWidget('chart'),
            refs = model.blueprint.elements.dashboard.children;
        expect([first.id, second.id]).toEqual(['chart1', 'chart2']);
        expect(model.history.at(-1).description).toBe('Add Chart');
        const box = (id: string) => refs.find(it => it.id === id) as any;
        const overlaps = (a: any, b: any) =>
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        refs.filter(it => it.id !== 'chart1').forEach(it =>
            expect(overlaps(box('chart1'), it)).toBe(false)
        );
    });

    it('gives a container placed on a dashboard room for widgets of its own', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            place = (component: string) => {
                const {id} = design.addWidget(component, 'dashboard');
                return model.blueprint.elements.dashboard.children.find(it => it.id === id);
            };
        expect(place('dashboard')).toMatchObject({w: 12, h: 8});
        expect(place('tabContainer')).toMatchObject({w: 12, h: 8});
    });

    it('adds into the selected container, a tab with a title', () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json'));
        design.select({kind: 'element', id: 'tabs'});
        const {id} = design.addWidget('dashboard');
        expect(model.blueprint.elements.tabs.children.at(-1)).toEqual({id, title: 'Dashboard'});
    });

    it('adds into a selected box or panel, by its ID alone, and a box into a panel', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            panel = design.addWidget('panel', 'dashboard').id;
        design.select({kind: 'element', id: panel});
        const row = design.addWidget('box').id;
        design.select({kind: 'element', id: row});
        const rule = design.addWidget('separator').id,
            {elements} = model.blueprint;
        expect(elements[panel].children).toEqual([{id: row}]);
        expect(elements[row].children).toEqual([{id: rule}]);
        expect(elements[rule]).toEqual({component: 'separator', config: {}});
    });

    it('adds beside the selected widget in a box, right after it', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
            row = design.addWidget('box', 'dashboard').id;
        ['markdown', 'callout'].forEach(it => design.addWidget(it, row));
        const [first, last] = model.blueprint.elements[row].children.map(it => it.id);
        design.select({kind: 'element', id: first});
        const rule = design.addWidget('separator').id;
        expect(model.blueprint.elements[row].children.map(it => it.id)).toEqual([
            first,
            rule,
            last
        ]);
    });

    it('makes the first widget of an empty blueprint its root', () => {
        const {model, design} = open(undefined),
            result = design.addWidget('dashboard');
        expect(errors(result)).toEqual([]);
        expect(model.blueprint.root).toBe(result.id);
        expect(errors(design.addWidget('cubeGrid'))).toMatchObject([
            {message: 'Add a source for the Grid to read first.'}
        ]);
    });

    it('retitles and reorders a tab, each as one edit', () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json')),
            tabs = () => model.blueprint.elements.tabs.children,
            [first, second] = tabs();
        design.setChildTitle(second.id, 'Book');
        expect(tabs()[1]).toEqual({...second, title: 'Book'});
        expect(model.history.at(-1).description).toBe('Retitle Dashboard');

        design.moveElement(second.id, 'tabs', {index: 0});
        expect(
            tabs()
                .map(it => it.id)
                .slice(0, 2)
        ).toEqual([second.id, first.id]);
        model.undo();
        model.undo();
        expect(tabs()[1]).toEqual(second);
    });

    describe('variables', () => {
        it('adds a variable with a name of its own, and selects it', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                {id, issues} = design.addVariable();
            expect(errors({issues})).toEqual([]);
            expect(id).toBe('variable1');
            expect(model.blueprint.variables.variable1).toEqual({type: 'string', setBy: 'prompt'});
            expect(design.selection).toEqual({kind: 'variable', id: 'variable1'});
            expect(model.history.at(-1).description).toBe('Add variable variable1');
            expect(design.addVariable().id).toBe('variable2');
        });

        it('sets or removes one key of a declaration as one edit', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            design.setVariableDecl('symbol', 'label', 'Ticker');
            expect(model.blueprint.variables.symbol.label).toBe('Ticker');
            expect(model.history.at(-1).description).toBe('Variable symbol: label');
            design.setVariableDecl('symbol', 'label', undefined);
            expect(model.blueprint.variables.symbol).not.toHaveProperty('label');

            const compute = {resolver: 'today'};
            expect(
                errors(design.updateVariableDecl('symbol', {setBy: 'resolver', compute}))
            ).toEqual([]);
            expect(model.blueprint.variables.symbol).toMatchObject({setBy: 'resolver', compute});
            expect(model.history.at(-1).description).toBe('Variable symbol: setBy, compute');
        });

        it('removes a variable nothing reads, and refuses one a widget reads', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            expect(errors(design.removeVariable('grouping'))).toMatchObject([
                {message: 'posGrid uses grouping. Change it first.'}
            ]);
            expect(model.blueprint.variables).toHaveProperty('grouping');
            design.addVariable();
            expect(errors(design.removeVariable('variable1'))).toEqual([]);
            expect(model.blueprint.variables).not.toHaveProperty('variable1');
        });

        it('refuses to remove a variable that a template reads', () => {
            const {design} = open(loadBlueprint('p3-morning-report.json'));
            design.addVariable();
            const {id} = design.addWidget('markdown', 'overview');
            design.setConfig(id, '/text', 'Picked: {variable1}');
            expect(errors(design.removeVariable('variable1'))).toMatchObject([
                {message: `${id} uses variable1. Change it first.`}
            ]);
        });
    });

    describe('sources', () => {
        it('adds a dataset source with its required parameters bound, and selects it', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                {id, issues} = design.addSource('positions');
            expect(errors({issues})).toEqual([]);
            expect(id).toBe('positions1');
            expect(model.blueprint.sources.positions1).toEqual({
                dataset: 'positions',
                params: {asOf: {$var: 'asOf'}}
            });
            expect(design.selection).toEqual({kind: 'source', id: 'positions1'});
            expect(model.history.at(-1).description).toBe('Add source positions1');
            // The first source over a dataset takes its name.
            expect(design.addSource('fundSummary', {addVariables: true}).id).toBe('fundSummary');
        });

        it('refuses a source whose required parameter no variable can take', () => {
            const {design} = open(undefined),
                result = design.addSource('positions');
            expect(errors(result)).toMatchObject([
                {message: expect.stringMatching(/Add a localDate variable for asOf first/)}
            ]);
        });

        it('names the widgets a dataset change would break, and can remove them in the same edit', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                {breaks} = design.describeDatasetChange('positions', 'orders');
            expect(breaks).toEqual(expect.arrayContaining(['posGrid']));
            expect(errors(design.changeSourceDataset('positions', 'orders'))).not.toEqual([]);

            const result = design.changeSourceDataset('positions', 'orders', {
                removeBreaking: true
            });
            expect(errors(result)).toEqual([]);
            expect(model.blueprint.sources.positions.dataset).toBe('orders');
            breaks.forEach(it => expect(model.blueprint.elements).not.toHaveProperty(it));
            model.undo();
            expect(model.blueprint.sources.positions.dataset).toBe('positions');
        });

        it('renames a source named for its old dataset after the new one, and keeps a name a user gave', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json'));
            design.addSource('positions');
            expect(errors(design.changeSourceDataset('positions1', 'orders'))).toEqual([]);
            expect(model.blueprint.sources).not.toHaveProperty('positions1');
            expect(model.blueprint.sources.orders1.dataset).toBe('orders');
            expect(design.selection).toEqual({kind: 'source', id: 'orders1'});

            design.renameId('source', 'orders1', 'myOrders');
            expect(errors(design.changeSourceDataset('myOrders', 'positions'))).toEqual([]);
            expect(model.blueprint.sources.myOrders.dataset).toBe('positions');
        });

        it('sets keys of a declaration together, and removes a source nothing reads', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json'));
            design.addSource('positions');
            expect(
                errors(
                    design.updateSourceDecl('positions1', {
                        fields: {mktVal: {label: 'Value'}}
                    })
                )
            ).toEqual([]);
            expect(model.blueprint.sources.positions1.fields).toEqual({mktVal: {label: 'Value'}});
            expect(errors(design.removeSource('positions'))).not.toEqual([]);
            expect(errors(design.removeSource('positions1'))).toEqual([]);
            expect(model.blueprint.sources).not.toHaveProperty('positions1');
        });
    });

    describe('presets', () => {
        const SORT = '/elements/posGrid/config/sortBy',
            COLUMNS = '/elements/posGrid/config/columnState';

        it("makes a group from an element's preset path, with one preset of its value", () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                {id, issues} = design.addPresetGroup(SORT);
            expect(errors({issues})).toEqual([]);
            expect(id).toBe('group1');
            expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('sortBy');
            expect(model.blueprint.presets.group1).toEqual({
                label: 'Sort by',
                controls: [{path: SORT}],
                default: 'preset1',
                items: {
                    preset1: {
                        label: 'Preset 1',
                        set: {elements: {posGrid: {config: {sortBy: 'pnlDay|desc'}}}}
                    }
                }
            });
            expect(design.selection).toEqual({kind: 'preset', id: 'group1'});
        });

        it('adds a control to every preset of a group, and gives it back to the config', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            expect(errors(design.addPresetControl('posViews', SORT))).toEqual([]);
            const {items} = model.blueprint.presets.posViews;
            Object.values(items).forEach(it =>
                expect(it.set.elements.posGrid.config.sortBy).toBe('pnlDay|desc')
            );

            model.setPreset('posViews', 'risk');
            expect(errors(design.removePresetControl('posViews', COLUMNS))).toEqual([]);
            expect(model.blueprint.elements.posGrid.config.columnState).toEqual(
                items.risk.set.elements.posGrid.config.columnState
            );
            Object.values(model.blueprint.presets.posViews.items).forEach(it =>
                expect(it.set.elements.posGrid.config).not.toHaveProperty('columnState')
            );
        });

        it('duplicates, relabels and removes a preset, keeping a default', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                group = () => model.blueprint.presets.posViews;
            const {id} = design.duplicatePreset('posViews', 'pnl');
            expect(id).toBe('preset1');
            expect(group().items.preset1).toEqual({...group().items.pnl, label: 'P&L view copy'});
            design.setPresetLabel('posViews', 'preset1', 'Mine');
            expect(group().items.preset1.label).toBe('Mine');

            expect(errors(design.removePreset('posViews', 'pnl'))).toEqual([]);
            expect(group().default).toBe('risk');
            design.removePreset('posViews', 'preset1');
            expect(errors(design.removePreset('posViews', 'risk')).length).toBeGreaterThan(0);
        });

        it("makes presets of a variable's default, which edits, renames and removal follow", () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                FUND = '/variables/fund/default';
            design.addVariable();
            design.setVariableDecl('variable1', 'default', {value: 'A'});
            const {id} = design.addPresetGroup('/variables/variable1/default');
            expect(model.blueprint.variables.variable1).not.toHaveProperty('default');
            expect(model.blueprint.presets[id].items.preset1.set).toEqual({
                variables: {variable1: {default: {value: 'A'}}}
            });

            design.setVariableDecl('variable1', 'default', {value: 'B'});
            expect(
                model.blueprint.presets[id].items.preset1.set.variables.variable1.default
            ).toEqual({
                value: 'B'
            });

            design.renameId('variable', 'variable1', 'book');
            expect(model.blueprint.presets[id].controls).toEqual([
                {path: '/variables/book/default'}
            ]);
            expect(errors(design.removeVariable('book'))).toEqual([]);
            expect(model.blueprint.presets ?? {}).not.toHaveProperty(id);

            expect(errors(design.addPresetGroup(FUND))).toEqual([]);
        });

        it('removes a group, giving its paths back to the config at the active preset', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json'));
            model.setPreset('posViews', 'risk');
            const risk = model.blueprint.presets.posViews.items.risk.set.elements.posGrid.config;
            expect(errors(design.removePresetGroup('posViews'))).toEqual([]);
            expect(model.blueprint.presets ?? {}).not.toHaveProperty('posViews');
            expect(model.blueprint.elements.posGrid.config.columnState).toEqual(risk.columnState);
        });
    });

    describe('removing an element', () => {
        it('removes everything inside it, and what names it, in one edit that undoes', () => {
            const {model, design} = open(loadBlueprint('p3-morning-report.json')),
                before = model.blueprint,
                removal = design.describeRemoval('positions');
            expect(removal.elements).toEqual(
                expect.arrayContaining(['positions', 'posGrid', 'groupChooser'])
            );
            expect(removal.presetPaths).toEqual(['/elements/posGrid/config/columnState']);

            const {version} = model;
            expect(errors(design.removeElement('positions'))).toEqual([]);
            expect(model.version).toBe(version + 1);
            removal.elements.forEach(id => expect(model.blueprint.elements[id]).toBeUndefined());
            expect(model.blueprint.presets?.posViews).toBeUndefined();
            removal.removedVariables.forEach(name =>
                expect(model.blueprint.variables[name]).toBeUndefined()
            );
            removal.unboundVariables.forEach(name =>
                expect(JSON.stringify(model.blueprint.variables[name]?.setBy ?? null)).not.toMatch(
                    /posGrid|groupChooser/
                )
            );

            model.undo();
            expect(model.blueprint).toEqual(before);
        });

        it('keeps a variable another element reads, without the removed writer', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                removal = design.describeRemoval('posGrid');
            expect(removal.unboundVariables).toEqual(['selection']);
            expect(errors(design.removeElement('posGrid'))).toEqual([]);
            expect(model.blueprint.variables.selection).toBeDefined();
            expect(model.blueprint.variables.selection.setBy).toBeUndefined();
        });
    });

    it('moves and renames as one edit each, and keeps the selection on a rename', () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json'));
        design.select({kind: 'element', id: 'posGrid'});
        expect(errors(design.renameId('element', 'posGrid', 'positionsGrid'))).toEqual([]);
        expect(design.selection).toEqual({kind: 'element', id: 'positionsGrid'});
        expect(model.history.at(-1).ops).toEqual([
            {op: 'renameId', kind: 'element', from: 'posGrid', to: 'positionsGrid'}
        ]);
        expect(
            errors(design.moveElement('priceChart', 'overview', {child: {x: 0, y: 30, w: 4, h: 4}}))
        ).toEqual([]);
        expect(model.blueprint.elements.overview.children.at(-1).id).toBe('priceChart');
    });

    it("sets an element's config, or the active preset's value for a path presets control", () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json'));
        expect(errors(design.setConfig('posGrid', '/title', 'Positions'))).toEqual([]);
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
        expect(model.history.at(-1).description).toBe('posGrid: title');

        design.setConfig('posGrid', '/columnState', ['mktVal']);
        expect(
            model.blueprint.presets.posViews.items.pnl.set.elements.posGrid.config.columnState
        ).toEqual(['mktVal']);
        design.setConfig('posGrid', '/title', undefined);
        expect(model.blueprint.elements.posGrid.config.title).toBeUndefined();
    });

    it('clears the selection when what it names is gone', () => {
        const {design} = open(loadBlueprint('p2-linked-dashboard.json'));
        design.select({kind: 'element', id: 'sectorChart'});
        design.removeElement('sectorChart');
        expect(design.selection).toBeNull();
    });

    it("rescales a dashboard's cells with its columns, in one edit that one undo restores", () => {
        const {model, design} = open(loadBlueprint('p3-morning-report.json')),
            cells = () =>
                model.blueprint.elements.overview.children.map(({id, x, y, w, h}) => [
                    id,
                    x,
                    y,
                    w,
                    h
                ]),
            before = cells(),
            edits = model.history.length;
        expect(errors(design.setConfig('overview', '/columns', 6))).toEqual([]);
        expect(model.blueprint.elements.overview.config.columns).toBe(6);
        expect(cells()).toEqual([
            ['reportActions', 0, 0, 6, 1],
            ['headline', 0, 1, 6, 2],
            ['sectorChart', 0, 3, 3, 6],
            ['regionChart', 3, 3, 3, 6]
        ]);
        expect(model.history.length).toBe(edits + 1);
        model.undo();
        expect(cells()).toEqual(before);
        expect(model.blueprint.elements.overview.config?.columns).toBeUndefined();
    });

    describe('panes widget views', () => {
        const setup = () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                dc = design.addWidget('panes').id,
                a = design.addWidget('markdown', dc).id,
                b = design.addWidget('markdown', dc).id;
            design.setConfig(dc, '/layout', [
                {
                    type: 'row',
                    content: [
                        {type: 'stack', content: [{type: 'view', id: a}]},
                        {type: 'stack', content: [{type: 'view', id: b}]}
                    ]
                }
            ]);
            const layout = () => model.blueprint.elements[dc].config.layout;
            return {model, design, dc, a, b, layout};
        };

        it('removes a view its layout names, dropping its emptied stack, in one edit undo restores', () => {
            const {model, design, a, b, layout} = setup(),
                before = layout(),
                edits = model.history.length;
            expect(errors(design.removeElement(a))).toEqual([]);
            expect(model.blueprint.elements[a]).toBeUndefined();
            expect(layout()).toEqual([
                {type: 'row', content: [{type: 'stack', content: [{type: 'view', id: b}]}]}
            ]);
            expect(model.history.length).toBe(edits + 1);
            model.undo();
            expect(layout()).toEqual(before);
        });

        it('drops a view from the layout as it moves out, and keeps the layout for a reorder', () => {
            const {design, dc, a, b, layout} = setup();
            expect(errors(design.moveElement(b, dc, {index: 0}))).toEqual([]);
            expect(JSON.stringify(layout())).toContain(`"${a}"`);
            expect(errors(design.moveTo(a, 'dashboard', 'into'))).toEqual([]);
            expect(JSON.stringify(layout())).not.toContain(`"${a}"`);
        });

        it("takes an Architect's raw removal of a view too, leaving the default once none is left", () => {
            const {model, a, b, dc} = setup(),
                result = model.applyEdit({
                    ops: [
                        {op: 'removeElement', id: a},
                        {op: 'removeElement', id: b}
                    ]
                });
            expect(result.issues.filter(it => it.severity === 'error')).toEqual([]);
            expect(model.blueprint.elements[dc].config).not.toHaveProperty('layout');
        });
    });

    describe('drops', () => {
        const setup = () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                box = design.addWidget('box').id,
                a = design.addWidget('markdown', box).id,
                b = design.addWidget('markdown', box).id,
                kids = () => model.blueprint.elements[box].children.map(it => it.id);
            return {model, design, box, a, b, kids};
        };

        it('drops a palette widget into a container at a place, as one edit, and selects it', () => {
            const {model, design, box, a, b, kids} = setup(),
                edits = model.history.length;
            expect(design.canDropAt({widget: 'markdown'}, {container: box, index: 1})).toBeNull();
            expect(model.history.length).toBe(edits);
            expect(design.dropAt({widget: 'markdown'}, {container: box, index: 1})).toBeNull();
            const added = design.selectedElementId;
            expect(kids()).toEqual([a, added, b]);
            expect(model.history.length).toBe(edits + 1);
            model.undo();
            expect(kids()).toEqual([a, b]);
        });

        it('moves an element in, or within its container, by the slot as it stands', () => {
            const {design, box, a, b, kids} = setup();
            expect(design.dropAt({element: a}, {container: box, index: 2})).toBeNull();
            expect(kids()).toEqual([b, a]);
            expect(design.dropAt({element: 'headline'}, {container: box, index: 0})).toBeNull();
            expect(kids()).toEqual(['headline', b, a]);
            expect(design.selectedElementId).toBe('headline');
        });

        it('refuses with a sentence, applying nothing, where the container cannot take it', () => {
            const {model, design, box} = setup(),
                bar = design.addWidget('toolbar', box).id,
                before = model.version,
                reason = design.canDropAt({element: 'posGrid'}, {container: bar});
            expect(reason).toEqual(expect.any(String));
            expect(design.dropAt({element: 'posGrid'}, {container: bar})).toBe(reason);
            expect(design.dropAt({element: box}, {container: bar})).toMatch(/inside itself/);
            expect(model.version).toBe(before);
        });

        it('places a dashboard drop at its footprint', () => {
            const {model, design} = setup();
            expect(
                design.dropAt(
                    {widget: 'markdown'},
                    {container: 'dashboard', cell: {x: 0, y: 40, w: 4, h: 3}}
                )
            ).toBeNull();
            const id = design.selectedElementId;
            expect(
                model.blueprint.elements.dashboard.children.find(it => it.id === id)
            ).toMatchObject({
                x: 0,
                y: 40,
                w: 4,
                h: 3
            });
        });

        it("adds a panes widget's view to its layout in the same edit", () => {
            const {model, design} = setup(),
                dc = design.addWidget('panes').id;
            expect(
                design.dropAt(
                    {widget: 'markdown'},
                    {
                        container: dc,
                        layoutWith: id => [{type: 'stack', content: [{type: 'view', id}]}]
                    }
                )
            ).toBeNull();
            const id = design.selectedElementId;
            expect(model.blueprint.elements[dc].config.layout).toEqual([
                {type: 'stack', content: [{type: 'view', id}]}
            ]);
        });
    });

    it('returns no id for an add the blueprint refuses', () => {
        const {model, design} = open({
            schema: {blueprint: 1},
            root: 'bar',
            elements: {bar: {component: 'toolbar', children: []}}
        });
        const refused = design.addWidget('buttonGroup', 'bar');
        expect(errors(refused)).not.toEqual([]);
        expect(refused.id).toBeUndefined();
        expect(model.blueprint.elements).toEqual({bar: {component: 'toolbar', children: []}});
    });

    describe('design actions', () => {
        it("lists an element's actions in order, with why any cannot run, and none for a reader", () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                ids = (id: string) => design.designActions({kind: 'element', id}).map(it => it.id),
                action = (id: string, actionId: string) =>
                    design.designActions({kind: 'element', id}).find(it => it.id === actionId);
            expect(ids('posGrid')).toEqual(['duplicate', 'wrap', 'delete']);
            expect(ids('dashboard')).toEqual([
                'addWidget',
                'duplicate',
                'wrap',
                'changeType',
                'delete'
            ]);
            expect(action('dashboard', 'duplicate').disabledReason).toMatch(/root/);
            const toolbar = action('posGrid', 'wrap').items.find(it => it.id === 'wrap:toolbar');
            expect(toolbar.disabledReason).toEqual(expect.any(String));
            expect(
                action('posGrid', 'wrap').items.find(it => it.id === 'wrap:panel').disabledReason
            ).toBeNull();
            expect(action('posGrid', 'wrap').items.map(it => it.id)).toContain('wrap:box');
            model.setAccess('read');
            expect(ids('posGrid')).toEqual([]);
        });

        it('wraps an element in a container of any kind, as one edit, selecting the container', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                edits = model.history.length;
            expect(design.wrapIn('posGrid', 'box')).toBeNull();
            const box = design.selectedElementId;
            expect(model.blueprint.elements[box]).toMatchObject({
                component: 'box',
                children: [{id: 'posGrid'}]
            });
            expect(model.blueprint.elements.dashboard.children.some(it => it.id === box)).toBe(
                true
            );
            expect(model.history.length).toBe(edits + 1);
            model.undo();
            expect(model.blueprint.elements[box]).toBeUndefined();
        });

        describe('change type and unwrap', () => {
            const boxPage = (): Blueprint => ({
                schema: {blueprint: 1},
                root: 'page',
                elements: {
                    page: {
                        component: 'box',
                        config: {direction: 'row', gap: 8},
                        children: [{id: 'a', flex: 2}, {id: 'b'}]
                    },
                    a: {component: 'markdown', config: {text: 'A'}},
                    b: {component: 'markdown', config: {text: 'B'}}
                }
            });
            const changeTo = (design: BlueprintDesignModel, id: string, widget: string) =>
                design
                    .designActions({kind: 'element', id})
                    .find(it => it.id === 'changeType')
                    .items.find(it => it.id === `changeType:${widget}`);

            it('changes a box to a dashboard and back, each one undoable edit that keeps its id', () => {
                const {model, design} = open(boxPage()),
                    edits = model.history.length;
                design.select({kind: 'element', id: 'page'});
                const toDashboard = changeTo(design, 'page', 'dashboard');
                // A box's direction and gap, and a child's flex, have no place on a dashboard.
                expect(toDashboard.confirm).toMatch(/direction/);
                expect(toDashboard.confirm).toMatch(/gap/);
                expect(toDashboard.confirm).toMatch(/flex/);
                expect(toDashboard.run()).toBeNull();
                const page = model.blueprint.elements.page;
                expect(page.component).toBe('dashboard');
                expect(page.config).not.toHaveProperty('direction');
                // Packed: each child at the first free place, at its widget's default size.
                expect(page.children.map(it => it.id)).toEqual(['a', 'b']);
                page.children.forEach(it =>
                    expect(it).toEqual({
                        id: it.id,
                        x: expect.any(Number),
                        y: expect.any(Number),
                        w: expect.any(Number),
                        h: expect.any(Number)
                    })
                );
                expect(model.history.length).toBe(edits + 1);
                expect(design.selection).toEqual({kind: 'element', id: 'page'});
                expect(errors({issues: model.issues})).toEqual([]);

                // Back to a box, the dashboard places are dropped.
                const toBox = changeTo(design, 'page', 'box');
                expect(toBox.confirm).toMatch(/x, y, w and h/);
                expect(toBox.run()).toBeNull();
                expect(model.blueprint.elements.page).toMatchObject({
                    component: 'box',
                    children: [{id: 'a'}, {id: 'b'}]
                });

                model.undo();
                model.undo();
                expect(model.blueprint).toEqual(boxPage());
            });

            it('changes a panel to tabs, confirming the settings and the toolbar it drops', () => {
                const {model, design} = open({
                    schema: {blueprint: 1},
                    root: 'panel',
                    elements: {
                        panel: {
                            component: 'panel',
                            config: {title: 'Risk', compactHeader: true},
                            tbar: [{id: 'bar'}],
                            children: [{id: 'a'}, {id: 'b'}]
                        },
                        bar: {component: 'toolbar', children: []},
                        a: {component: 'markdown', config: {text: 'A'}},
                        b: {component: 'markdown', config: {text: 'B'}}
                    }
                });
                const before = cloneDeep(model.blueprint),
                    action = changeTo(design, 'panel', 'tabContainer');
                expect(action.confirm).toMatch(/bar/);
                expect(action.confirm).toMatch(/compactHeader/);
                expect(action.run()).toBeNull();
                const tabs = model.blueprint.elements.panel;
                expect(tabs.component).toBe('tabContainer');
                expect(tabs).not.toHaveProperty('tbar');
                // A tab needs a title: each child takes its widget's label.
                expect(tabs.children).toEqual([
                    {id: 'a', title: expect.any(String)},
                    {id: 'b', title: expect.any(String)}
                ]);
                expect(model.blueprint.elements).not.toHaveProperty('bar');
                model.undo();
                expect(model.blueprint).toEqual(before);
            });

            it('asks nothing for a change that drops nothing, and offers no change to the same type', () => {
                const {design} = open({
                    schema: {blueprint: 1},
                    root: 'page',
                    elements: {
                        page: {component: 'box', children: [{id: 'a'}]},
                        a: {component: 'markdown', config: {text: 'A'}}
                    }
                });
                expect(changeTo(design, 'page', 'panel').confirm).toBeFalsy();
                expect(changeTo(design, 'page', 'box')).toBeUndefined();
            });

            it('unwraps a root container with one child, the child becoming the root, undoably', () => {
                const {model, design} = open({
                        schema: {blueprint: 1},
                        root: 'page',
                        elements: {
                            page: {
                                component: 'panel',
                                config: {title: 'Risk'},
                                children: [{id: 'a'}]
                            },
                            a: {component: 'markdown', config: {text: 'A'}}
                        }
                    }),
                    before = cloneDeep(model.blueprint),
                    unwrap = () =>
                        design
                            .designActions({kind: 'element', id: 'page'})
                            .find(it => it.id === 'unwrap');
                expect(unwrap().run()).toBeNull();
                expect(model.blueprint.root).toBe('a');
                expect(model.blueprint.elements).not.toHaveProperty('page');
                expect(design.selection).toEqual({kind: 'element', id: 'a'});
                model.undo();
                expect(model.blueprint).toEqual(before);

                // Offered only for a container with exactly one child.
                design.addWidget('markdown', 'page');
                expect(unwrap()).toBeUndefined();
            });

            it('unwraps a container in place, its child taking its place in the parent', () => {
                const {model, design} = open(loadBlueprint('p2-linked-dashboard.json'));
                expect(design.wrapIn('posGrid', 'box')).toBeNull();
                const box = design.selectedElementId,
                    cell = () => model.blueprint.elements.dashboard.children;
                const place = cell().find(it => it.id === box);
                expect(design.unwrap(box)).toBeNull();
                expect(cell().find(it => it.id === 'posGrid')).toEqual({...place, id: 'posGrid'});
                expect(model.blueprint.elements).not.toHaveProperty(box);
            });
        });

        it('deletes through its action, asking first only when more goes with it, then selects a neighbour', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json')),
                remove = (id: string) =>
                    design.designActions({kind: 'element', id}).find(it => it.id === 'delete');
            expect(remove('sectorChart').confirm).toBeFalsy();
            expect(remove('posGrid').confirm).toMatch(/loses a writer/);
            expect(remove('dashboard').confirm).toMatch(
                /Remove dashboard, and the \d+ elements in it\?/
            );
            expect(remove('sectorChart').run()).toBeNull();
            expect(model.blueprint.elements.sectorChart).toBeUndefined();
            expect(design.selection?.kind).toBe('element');
        });
    });

    it('tells the Architect what the designer has in front of them: mode, selection with its cell, tabs and presets', () => {
        const {model, design} = open(loadBlueprint('p2-linked-dashboard.json'));
        expect(design.uiContext).toEqual({mode: 'design', interaction: 'edit', selection: null});
        design.select({kind: 'element', id: 'posGrid'});
        expect(design.uiContext.selection).toEqual({
            kind: 'element',
            id: 'posGrid',
            widget: 'cubeGrid',
            parent: 'dashboard',
            cell: {x: 0, y: 2, w: 8, h: 7}
        });
        // A view names its title and the path of its reference, where its settings live.
        design.select({kind: 'view', id: 'posGrid', of: 'dashboard'});
        const index = model.blueprint.elements.dashboard.children.findIndex(
            it => it.id === 'posGrid'
        );
        expect(design.uiContext.selection).toMatchObject({
            kind: 'view',
            id: 'posGrid',
            title: viewTitle(
                model.blueprint.elements.dashboard.children[index],
                model.blueprint.elements.posGrid
            ),
            path: `/elements/dashboard/children/${index}`,
            cell: {h: 7}
        });
        model.setMode('run');
        expect(design.uiContext).not.toHaveProperty('interaction');
    });

    describe('unfinished widgets', () => {
        it('lets a person leave a widget unfinished, as a warning that names what it lacks, where the Architect is refused', () => {
            const {model, design} = open(loadBlueprint('p2-linked-dashboard.json'));
            expect(errors(design.setConfig('sectorChart', '/y', []))).toEqual([]);
            expect(model.blueprint.elements.sectorChart.config.y).toEqual([]);
            const [unfinished] = model.issues.filter(it => it.code === 'config.incomplete');
            expect(unfinished).toMatchObject({
                severity: 'warning',
                path: '/elements/sectorChart/config/y'
            });
            expect(unfinished.message).toBe('sectorChart is unfinished: Y needs at least 1 item');

            // A widget the person left unfinished does not block the Architect's other edits.
            const other = model.applyEdit({
                author: 'architect',
                ops: [{op: 'set', path: '/elements/posGrid/config/title', value: 'Book'}]
            });
            expect(errors(other)).toEqual([]);

            // But the Architect leaves no widget unfinished itself.
            const fresh = open(loadBlueprint('p2-linked-dashboard.json')).model,
                refused = fresh.applyEdit({
                    author: 'architect',
                    ops: [{op: 'set', path: '/elements/sectorChart/config/y', value: []}]
                });
            expect(refused.issues).toEqual([
                expect.objectContaining({code: 'config.incomplete', severity: 'error'})
            ]);
            expect(fresh.blueprint.elements.sectorChart.config.y).toEqual(['pnlDay']);
        });
    });
});
