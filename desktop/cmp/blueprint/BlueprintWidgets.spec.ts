import {fireEvent, render, screen} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses, XH} from '@xh/hoist/core';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry,
    weatherCatalog
} from '../../../test/blueprintFixtures';
import type {Blueprint, BlueprintDataProvider, BlueprintDataUpdate} from '../../../blueprint';
import {BlueprintModel} from '../../../blueprint';
import {elementFromContent} from '@xh/hoist/utils/react';
import {blueprintView} from './BlueprintView';
import {buttonGroupWidget, ButtonGroupWidgetModel} from './ButtonGroupWidget';
import {buttonGroupInputWidget, ButtonGroupInputWidgetModel} from './ButtonGroupInputWidget';
import {BlueprintViewModel} from './impl/BlueprintViewModel';
import {CubeGridWidgetModel} from './CubeGridWidget';
import {DashCanvasWidgetModel} from './DashCanvasWidget';
import {GroupingChooserWidgetModel} from './GroupingChooserWidget';
import {TabContainerWidgetModel} from './TabContainerWidget';
import {tabContainer} from '@xh/hoist/cmp/tab';

/**
 * The desktop widgets derive their Hoist models from the document, and turn what a user does in
 * them into edits or outputs. Opening a blueprint must never itself emit an edit.
 */
describe('blueprint desktop widgets', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const ROWS = [
        {id: 'a', sector: 'Energy', symbol: 'XOM', mktVal: 100, pnlDay: 1},
        {id: 'b', sector: 'Energy', symbol: 'SHEL', mktVal: 50, pnlDay: -2},
        {id: 'c', sector: 'Technology', symbol: 'NVDA', mktVal: 300, pnlDay: 5}
    ];

    /** A provider that sends ROWS for every subscription, as a snapshot. */
    const provider: BlueprintDataProvider = {
        loadAsync: async () => ({rows: ROWS}),
        subscribe(_, push: (u: BlueprintDataUpdate) => void) {
            queueMicrotask(() => push({replace: ROWS}));
            return () => {};
        }
    };

    /** Open a blueprint in design mode, where a user's change in a widget is an edit. */
    function open(blueprint: Blueprint, registry = scenarioRegistry()) {
        const ret = new BlueprintModel({
            blueprint,
            catalog: portfolioCatalog,
            registry,
            dataProvider: provider
        });
        ret.setAccess('write');
        ret.setMode('design');
        onTestFinished(() => ret.destroy());
        return ret;
    }

    /** Wait until a grid has applied its config's column state. */
    const columnsApplied = (grid: CubeGridWidgetModel) =>
        vi.waitFor(() => {
            const g = grid as any;
            expect(g.isApplyingColumns).toBe(false);
            expect(g.appliedColumnState.length).toBeGreaterThan(0);
        });

    function widget<T>(Cls: new (c: any) => T, blueprintModel: BlueprintModel, id: string): T {
        const ret = new Cls({blueprintModel, id, renderElement: () => null});
        onTestFinished(() => (ret as any).destroy());
        return ret;
    }

    describe('cubeGrid', () => {
        it('groups its source by groupBy, with a column per columnState entry', async () => {
            const model = open(loadBlueprint('p1-one-grid.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                gridModel = grid.cubeGridModel.innerGridModel;

            await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));
            expect(grid.cubeGridModel.view.query.dimensions.map(it => it.name)).toEqual([
                'sector',
                'symbol'
            ]);
            expect(gridModel.getColumn('mktVal')).toBeTruthy();
            expect(gridModel.getColumn('pnlDay')).toBeTruthy();
            expect(model.version).toBe(1);
        });

        it('follows an edit to groupBy without a new grid model', async () => {
            const model = open(loadBlueprint('p1-one-grid.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                {cubeGridModel} = grid;

            model.applyEdit({
                ops: [{op: 'set', path: '/elements/posGrid/config/groupBy', value: ['symbol']}]
            });
            expect(grid.cubeGridModel).toBe(cubeGridModel);
            expect(cubeGridModel.view.query.dimensions.map(it => it.name)).toEqual(['symbol']);
        });

        it("publishes the selected row's group path as its selection output", async () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid'),
                gridModel = grid.cubeGridModel.innerGridModel;
            await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));

            const trader = gridModel.store.allRecords.find(
                it => it.data.cubeDimension === 'trader'
            );
            await gridModel.selectAsync(trader);
            expect(model.getVariable('selection').value).toEqual({
                op: 'AND',
                filters: [
                    {field: 'strategy', op: '=', value: trader.parent.data.cubeLabelValue},
                    {field: 'trader', op: '=', value: trader.data.cubeLabelValue}
                ]
            });
        });

        it("turns a user's sort into an edit of sortBy", async () => {
            const model = open(loadBlueprint('p1-one-grid.json')),
                grid = widget(CubeGridWidgetModel, model, 'posGrid');

            grid.cubeGridModel.innerGridModel.setSortBy('pnlDay|desc');
            await vi.waitFor(() =>
                expect(model.blueprint.elements.posGrid.config.sortBy).toBe('pnlDay|desc')
            );
        });
    });

    it("keeps a user's sort transient in run mode, with no edit", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            gridModel = widget(CubeGridWidgetModel, model, 'posGrid').cubeGridModel.innerGridModel;
        model.setMode('run');

        gridModel.setSortBy('pnlDay|desc');
        await vi.waitFor(() =>
            expect(model.effective.elements.posGrid.config.sortBy).toBe('pnlDay|desc')
        );
        expect(model.version).toBe(1);
        expect(model.blueprint.elements.posGrid.config.sortBy).toBeUndefined();
    });

    it('snaps a refused sort back to the blueprint, and tells the user why', async () => {
        const toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null),
            model = open(loadBlueprint('p1-one-grid.json')),
            gridModel = widget(CubeGridWidgetModel, model, 'posGrid').cubeGridModel.innerGridModel;
        onTestFinished(() => toast.mockRestore());
        vi.spyOn(model, 'applyEdit').mockReturnValue({
            issues: [{code: 'x.refused', severity: 'error', path: '', message: 'Refused.'}]
        });

        gridModel.setSortBy('pnlDay|desc');
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Refused.'));
        expect(gridModel.sortBy).toEqual([]);
    });

    it('makes no edit when the grid autosizes its columns', async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await columnsApplied(grid);

        gridModel.updateColumnState([
            {colId: 'cubeLabel', width: 180, manuallySized: false},
            {colId: 'mktVal', width: 120, manuallySized: false}
        ]);
        await wait(50);
        expect(model.version).toBe(1);
    });

    it('makes no edit for the tree column while it is pinned left, visible and not sized by hand', async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid');
        await columnsApplied(grid);

        // As a real render reports it, with an autosized width and the tree column last.
        (grid as any).writeColumnState([
            {colId: 'mktVal', hidden: false, manuallySized: false, pinned: null},
            {colId: 'pnlDay', hidden: false, manuallySized: false, pinned: null},
            {colId: 'cubeLabel', hidden: false, width: 180, manuallySized: false, pinned: 'left'}
        ]);
        expect(model.history).toEqual([]);
    });

    it('makes no edit for a flat grid whose hidden tree column reports no pin', async () => {
        const model = open(loadBlueprint('p2-linked-dashboard.json')),
            grid = widget(CubeGridWidgetModel, model, 'ordersGrid');
        await columnsApplied(grid);

        // As a real render reports it.
        (grid as any).writeColumnState([
            ...['time', 'symbol', 'dir', 'quantity', 'price', 'mktVal', 'trader'].map(colId => ({
                colId,
                hidden: false,
                manuallySized: false,
                pinned: null
            })),
            {colId: 'cubeLabel', hidden: true, manuallySized: false, pinned: null}
        ]);
        expect(model.history).toEqual([]);
    });

    it('hides the tree column of a flat grid, without an edit, and shows it once grouped', async () => {
        const model = open(loadBlueprint('p2-linked-dashboard.json')),
            grid = widget(CubeGridWidgetModel, model, 'ordersGrid'),
            gridModel = grid.cubeGridModel.innerGridModel,
            isLabelHidden = () => gridModel.columnState.find(it => it.colId === 'cubeLabel').hidden;
        await columnsApplied(grid);
        expect(isLabelHidden()).toBe(true);
        expect(model.history).toEqual([]);

        model.applyEdit({
            ops: [{op: 'set', path: '/elements/ordersGrid/config/groupBy', value: ['trader']}]
        });
        await vi.waitFor(() => expect(isLabelHidden()).toBe(false));
        await columnsApplied(grid);
        expect(model.history).toHaveLength(1);
    });

    it("restores the grid to the blueprint's config, with no edit, after other edits", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await columnsApplied(grid);
        model.applyEdit({
            ops: [{op: 'set', path: '/elements/posGrid/config/columnState', value: ['pnlDay']}]
        });
        await columnsApplied(grid);
        const version = model.version;

        const confirm = vi.spyOn(XH, 'confirm').mockResolvedValue(true);
        onTestFinished(() => confirm.mockRestore());
        // Autosize waits for a rendered ag-Grid, which jsdom never has.
        vi.spyOn(gridModel, 'autosizeAsync').mockResolvedValue(undefined);
        expect(await gridModel.restoreDefaultsAsync()).toBe(true);
        await columnsApplied(grid);
        await wait(50);
        expect(model.version).toBe(version);
        expect(model.blueprint.elements.posGrid.config.columnState).toEqual(['pnlDay']);
        expect(gridModel.columnState.filter(it => !it.hidden).map(it => it.colId)).toContain(
            'pnlDay'
        );
    });

    it("redraws its cells when an edit changes a named format the blueprint's columns use", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel,
            cell = () => {
                const col = gridModel.getColumn('mktVal');
                return render(col.renderer(2500000, {column: col, gridModel} as any) as any)
                    .container.textContent;
            };
        await columnsApplied(grid);
        expect(cell()).toMatch(/^2\.5m/);

        model.applyEdit({ops: [{op: 'set', path: '/formats/mv', value: {precision: 0}}]});
        await columnsApplied(grid);
        expect(cell()).toMatch(/^2,500,000/);
    });

    it('makes no edit for a pinned column listed anywhere, or a hidden one that lost its pin', async () => {
        const bp = loadBlueprint('p1-one-grid.json');
        bp.elements.posGrid.config.columnState = [
            'mktVal',
            {field: 'pnlDay', pinned: 'left'},
            {field: 'pnlMtd', hidden: true, pinned: 'right', width: 90}
        ];
        const model = open(bp),
            grid = widget(CubeGridWidgetModel, model, 'posGrid');
        await columnsApplied(grid);

        // As ag-Grid reports it: master order across pin regions, and a hidden column bare.
        (grid as any).writeColumnState([
            {colId: 'cubeLabel', hidden: false, manuallySized: false, pinned: 'left'},
            {colId: 'pnlDay', hidden: false, manuallySized: false, pinned: 'left'},
            {colId: 'mktVal', hidden: false, manuallySized: false, pinned: null},
            {colId: 'pnlMtd', hidden: true}
        ]);
        expect(model.history).toEqual([]);
    });

    it("turns a user's resize into an edit of columnState, leaving the tree column out", async () => {
        const model = open(loadBlueprint('p1-one-grid.json')),
            grid = widget(CubeGridWidgetModel, model, 'posGrid'),
            gridModel = grid.cubeGridModel.innerGridModel;
        await columnsApplied(grid);

        // A user resizes once the data has loaded and the grid has autosized.
        await vi.waitFor(() => expect(gridModel.store.count).toBeGreaterThan(0));
        await wait(100);
        gridModel.noteColumnManuallySized('mktVal', 150);
        await vi.waitFor(() =>
            expect(model.blueprint.elements.posGrid.config.columnState).toEqual([
                {field: 'mktVal', width: 150},
                'pnlDay'
            ])
        );
    });

    describe('groupingChooser', () => {
        it('shows the value of the variable it sets, and sets it as the user chooses', () => {
            const model = open(loadBlueprint('p3-morning-report.json')),
                chooser = widget(GroupingChooserWidgetModel, model, 'groupChooser'),
                {chooserModel} = chooser;

            expect(chooserModel.value).toEqual(['strategy', 'trader', 'symbol']);
            expect(chooserModel.dimensions.sector.displayName).toBe('Sector');

            chooserModel.setValue(['sector']);
            expect(model.getVariable('grouping').value).toEqual(['sector']);

            model.resetVariable('grouping');
            expect(chooserModel.value).toEqual(['strategy', 'trader', 'symbol']);
        });
    });

    describe('buttonGroup', () => {
        it('shows a button per action, described in its tooltip, that runs it', async () => {
            const model = open(loadBlueprint('p3-morning-report.json'));
            render(buttonGroupWidget({model: widget(ButtonGroupWidgetModel, model, 'pnlButtons')}));

            const winners = await screen.findByText('Winners');
            expect(winners.closest('button').title).toBe('Set pnlFilter to pnlDay > 0');
            fireEvent.click(winners);
            await vi.waitFor(() =>
                expect(model.getVariable('pnlFilter').value).toEqual({
                    field: 'pnlDay',
                    op: '>',
                    value: 0
                })
            );
        });
    });

    describe('buttonGroupInput', () => {
        it('shows the value of the variable it sets as the pressed option, and sets it', async () => {
            const model = new BlueprintModel({
                blueprint: loadBlueprint('w2-two-cities.json'),
                catalog: weatherCatalog,
                registry: scenarioRegistry(),
                dataProvider: provider
            });
            onTestFinished(() => model.destroy());
            render(
                buttonGroupInputWidget({
                    model: widget(ButtonGroupInputWidgetModel, model, 'unitsToggle')
                })
            );

            const fahrenheit = await screen.findByText('°F'),
                celsius = await screen.findByText('°C');
            expect(fahrenheit.closest('button').className).toMatch(/-active\b/);

            fireEvent.click(celsius);
            await vi.waitFor(() => expect(model.getVariable('units').value).toBe('metric'));
            await vi.waitFor(async () =>
                expect((await screen.findByText('°C')).closest('button').className).toMatch(
                    /-active\b/
                )
            );
        });
    });

    describe('tabContainer', () => {
        const p3 = () => loadBlueprint('p3-morning-report.json');

        it('shows a tab per child, titled by its reference, rendering the child', () => {
            const model = open(p3()),
                rendered: string[] = [],
                tabs = new TabContainerWidgetModel({
                    blueprintModel: model,
                    id: 'tabs',
                    renderElement: id => {
                        rendered.push(id);
                        return div(id);
                    }
                });
            onTestFinished(() => tabs.destroy());
            const {tabContainerModel} = tabs;

            expect(tabContainerModel.tabs.map(it => [it.id, it.title])).toEqual([
                ['overview', 'Overview'],
                ['positions', 'Positions'],
                ['orders', 'Orders']
            ]);
            render(tabContainer({model: tabContainerModel}));
            expect(rendered).toContain('overview');
        });

        it('follows edits to its children, keeping the active tab', () => {
            const model = open(p3()),
                tabs = widget(TabContainerWidgetModel, model, 'tabs'),
                {tabContainerModel} = tabs;
            tabContainerModel.activateTab('orders');

            model.applyEdit({
                ops: [
                    {
                        op: 'set',
                        path: '/elements/tabs/children',
                        value: [
                            {id: 'orders', title: 'Blotter'},
                            {id: 'overview', title: 'Overview'},
                            {id: 'positions', title: 'Positions'}
                        ]
                    }
                ]
            });
            expect(tabContainerModel.tabs.map(it => it.title)).toEqual([
                'Blotter',
                'Overview',
                'Positions'
            ]);
            expect(tabContainerModel.activeTabId).toBe('orders');
            expect(model.version).toBe(2);
        });
    });

    describe('dashCanvas', () => {
        it('places each child as its reference says, and opens without an edit', async () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                layout = canvas.canvasModel.state.map(it => ({id: it.viewSpecId, ...it.layout}));

            expect(layout).toEqual(
                expect.arrayContaining(
                    model.blueprint.elements.dashboard.children.map(it => ({...it}))
                )
            );
            expect(model.version).toBe(1);
        });

        it('turns a move into one edit of its children, in reading order', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                state = canvas.canvasModel.state.map(it =>
                    it.viewSpecId === 'headline' ? {...it, layout: {...it.layout, y: 14}} : it
                );
            canvas.canvasModel.loadState(state);

            expect(model.version).toBe(2);
            expect(model.blueprint.elements.dashboard.children.map(it => it.id)).toEqual([
                'posGrid',
                'sectorChart',
                'ordersGrid',
                'headline'
            ]);
        });

        it('snaps back to the document when the edit for a move is refused', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                state = canvas.canvasModel.state.map(it =>
                    it.viewSpecId === 'headline' ? {...it, layout: {...it.layout, y: 3}} : it
                );
            const toast = vi.spyOn(XH, 'dangerToast').mockReturnValue(null);
            onTestFinished(() => toast.mockRestore());
            canvas.canvasModel.loadState(state);

            expect(toast).toHaveBeenCalledWith(expect.stringMatching(/overlaps/));
            expect(model.version).toBe(1);
            const headline = canvas.canvasModel.state.find(it => it.viewSpecId === 'headline');
            expect(headline.layout.y).toBe(0);
        });

        it('shows a header only for a child with a title, and follows edits to titles', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard'),
                view = (id: string) =>
                    canvas.canvasModel.viewModels.find(it => it.viewSpec.id === id);

            expect(view('sectorChart').viewSpec.hidePanelHeader).toBe(false);
            expect(view('sectorChart').title).toBe('Day P&L by Sector');
            expect(view('posGrid').viewSpec.hidePanelHeader).toBe(true);

            model.applyEdit({
                ops: [
                    {op: 'set', path: '/elements/sectorChart/config/title', value: 'P&L'},
                    {op: 'set', path: '/elements/posGrid/config/title', value: 'Positions'}
                ]
            });
            expect(view('sectorChart').title).toBe('P&L');
            expect(view('posGrid').viewSpec.hidePanelHeader).toBe(false);
            expect(view('posGrid').title).toBe('Positions');
            expect(model.version).toBe(2);
        });

        it('follows an edit that adds a child', () => {
            const model = open(loadBlueprint('p2-linked-dashboard.json')),
                canvas = widget(DashCanvasWidgetModel, model, 'dashboard');
            model.applyEdit({
                ops: [
                    {
                        op: 'addElement',
                        id: 'extra',
                        element: {component: 'cubeGrid', config: {source: 'orders'}},
                        parent: 'dashboard',
                        child: {x: 0, y: 14, w: 6, h: 4}
                    }
                ]
            });
            expect(canvas.canvasModel.state.map(it => it.viewSpecId)).toContain('extra');
        });
    });

    it('renders the toolbar prompts over the root element', async () => {
        const model = open(loadBlueprint('p1-one-grid.json'));
        render(blueprintView({model}));
        expect(await screen.findByText('As of')).toBeTruthy();
    });

    it('renders a dashCanvas child as DashCanvasView renders view content', async () => {
        const viewModel = new BlueprintViewModel(open(loadBlueprint('p2-linked-dashboard.json'))),
            canvas = viewModel.getWidgetModel('dashboard') as DashCanvasWidgetModel,
            spec = canvas.canvasModel.viewSpecs.find(it => it.id === 'headline');
        onTestFinished(() => viewModel.destroy());

        // DashCanvasView passes its own model to the content as `viewModel`.
        render(elementFromContent(spec.content, {flex: 1, viewModel: canvas.canvasModel}));
        expect(await screen.findByText('Positions')).toBeTruthy();
    });

    it('says a result is too large to show, in place of the widget over it', async () => {
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p4-answer.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider,
            artifacts: {art_7f2: 'positions'},
            artifactProvider: {loadArtifactAsync: async () => ({rows: [], totalRows: 6000})},
            isAnswer: true
        });
        onTestFinished(() => model.destroy());
        render(blueprintView({model}));
        expect(await screen.findByText('This result has too many rows to show here.')).toBeTruthy();
    });

    it('says the data of an answer is no longer available, in place of the widget over it', async () => {
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p4-answer.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: provider,
            artifacts: {art_7f2: 'positions'},
            artifactProvider: {loadArtifactAsync: async () => null},
            isAnswer: true
        });
        onTestFinished(() => model.destroy());
        render(blueprintView({model}));
        expect(
            await screen.findByText('The data for this answer is no longer available.')
        ).toBeTruthy();
    });

    it('renders an element with the presentation its config picks, over the same model', async () => {
        const registry = scenarioRegistry();
        registry.addPresentation('cubeGrid', {
            name: 'card',
            label: 'Card',
            guidance: 'A card.',
            component: hoistCmp.factory({
                model: uses(CubeGridWidgetModel),
                render: ({model}) => div(`Card of ${model.id}`)
            })
        });
        const bp = loadBlueprint('p1-one-grid.json');
        bp.elements.posGrid.config.presentation = 'card';
        render(blueprintView({model: open(bp, registry)}));
        expect(await screen.findByText('Card of posGrid')).toBeTruthy();
    });

    it('replaces a blueprint with charts with another, without a widget outliving its source', async () => {
        const model = open(loadBlueprint('p3-morning-report.json'));
        render(blueprintView({model}));
        expect(await screen.findByText('Columns')).toBeTruthy();
        model.setBlueprint(loadBlueprint('p1-one-grid.json'));
        await wait();
        expect(model.blueprint.root).toBe('posGrid');
    });

    it('renders a switch for each preset group, which switches the active preset', async () => {
        const model = open(loadBlueprint('p3-morning-report.json'));
        render(blueprintView({model}));
        expect(await screen.findByText('Columns')).toBeTruthy();
        expect(await screen.findByText('P&L view')).toBeTruthy();
        model.setPreset('posViews', 'risk');
        expect(await screen.findByText('Risk view')).toBeTruthy();
    });

    it("renders an app variable type's own prompt input", async () => {
        const registry = scenarioRegistry(),
            bp = loadBlueprint('p1-one-grid.json');
        registry.addVariableTypes({
            name: 'fund',
            matches: 'string',
            input: ({value}) => div(`Fund input: ${value}`)
        });
        bp.variables.fund = {
            type: 'fund',
            label: 'Fund',
            setBy: 'prompt',
            default: {value: 'Oak Mount'}
        };
        bp.sources.positions.params.fund = {$var: 'fund'};

        render(blueprintView({model: open(bp, registry)}));
        expect(await screen.findByText('Fund input: Oak Mount')).toBeTruthy();
    });
});
