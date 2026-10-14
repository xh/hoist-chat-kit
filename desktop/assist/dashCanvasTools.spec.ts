import {ViewManagerModel} from '@xh/hoist/cmp/viewmanager';
import {type PlainObject, XH} from '@xh/hoist/core';
import {DashCanvasModel, type DashCanvasItemState} from '@xh/hoist/desktop/cmp/dash';
import {hoistCore, initTestAppAsync} from '@xh/hoist/test-support';
import {map} from 'lodash';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {ChatToolGroup} from '../../assist';
import {ChatModel, ChatToolResult, type ChatToolSpec} from '../../core';
import {ScriptedChatTransport, textEvents, toolCallEvents} from '../../transport';
import {dashCanvasTools, type DashCanvasToolsConfig} from './dashCanvasTools';

/**
 * dashCanvasTools turns a DashCanvasModel into tools a model can call - the shared form of the
 * Toolbox weather agent's dashboard tools. Each tool must change only its own dashboard, respect
 * its locks and widget specs, let the model set only the settings an app declares, and hand back
 * an undo that restores the dashboard as it was.
 */
describe('dashCanvasTools', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    describe('group', () => {
        it('offers widget and layout tools, a prompt with the widget types, and suggestions', () => {
            const group = dashCanvasTools(createDash(), {
                description: 'Weather in my cities',
                widgets: {chart: {description: 'A forecast chart.', settingsSchema: CHART_SETTINGS}}
            });

            expect(map(group.tools, 'name')).toEqual([
                'add_widget',
                'remove_widgets',
                'move_widget',
                'configure_widget',
                'set_dashboard',
                'clear_dashboard',
                'reset_dashboard'
            ]);
            expect(group.prompt).toContain('a dashboard - Weather in my cities');
            expect(group.prompt).toContain(
                '- chart: Forecast. A forecast chart. Default size 6 by 4. Settings: {"type":"object"'
            );
            expect(group.prompt).toContain('- summary: Summary. Default size 4 by 2. At most one.');
            expect(group.prompt).not.toContain('- locked');
            expect(group.suggestions).toHaveLength(3);
        });

        it('needs a view manager for the views capability', () => {
            expect(() => dashCanvasTools(createDash(), {capabilities: ['views']})).toThrow(
                'needs a viewManagerModel'
            );
        });

        it('describes the widgets, with only the settings the app declares', async () => {
            const dashModel = createDash(),
                {contextProvider} = dashCanvasTools(dashModel, {
                    widgets: {chart: {settingsSchema: CHART_SETTINGS}}
                }),
                context = (await contextProvider.getContext(null)) as PlainObject;

            expect(context).toEqual({
                widgets: [
                    {
                        id: 'chart_0',
                        type: 'chart',
                        title: 'Forecast',
                        x: 0,
                        y: 0,
                        width: 6,
                        height: 4,
                        settings: {series: 'temp'}
                    },
                    {
                        id: 'summary_0',
                        type: 'summary',
                        title: 'Summary',
                        x: 6,
                        y: 0,
                        width: 4,
                        height: 2
                    }
                ]
            });
        });

        it("reads each schema from the dashboard's current widgets", async () => {
            const dashModel = createDash(),
                tool = getTool(dashCanvasTools(dashModel), 'remove_widgets');
            expect(tool.parameters.properties.widgets.items.enum).toEqual(['chart_0', 'summary_0']);

            dashModel.addView('chart');
            expect(tool.parameters.properties.widgets.items.enum).toEqual([
                'chart_0',
                'summary_0',
                'chart_1'
            ]);
        });
    });

    describe('widgets', () => {
        it('adds a widget with settings, returns its id, and undoes it', async () => {
            const dashModel = createDash(),
                result = await run(
                    dashModel,
                    'add_widget',
                    {type: 'chart', title: 'Tokyo', width: 4, settings: {series: 'wind'}},
                    {widgets: {chart: {settingsSchema: CHART_SETTINGS}}}
                );

            expect(result.output).toBe("Added Tokyo as 'chart_1'.");
            const added = dashModel.viewModels.find(it => it.id === 'chart_1');
            expect(added.viewState).toEqual({series: 'wind'});
            expect(added.positionParams.w).toBe(4);

            await result.undo();
            expect(widgetIds(dashModel)).toEqual(['chart_0', 'summary_0']);
        });

        it('refuses settings the app did not declare, types it cannot add, and a second unique widget', async () => {
            const dashModel = createDash();
            await expect(
                run(dashModel, 'add_widget', {type: 'chart', settings: {color: 'red'}})
            ).rejects.toThrow("Widget type 'chart' has no settings you can change.");
            await expect(
                run(
                    dashModel,
                    'add_widget',
                    {type: 'chart', settings: {color: 'red'}},
                    {widgets: {chart: {settingsSchema: CHART_SETTINGS}}}
                )
            ).rejects.toThrow(
                "Widget type 'chart' has no settings color. Its settings are series."
            );
            await expect(run(dashModel, 'add_widget', {type: 'locked'})).rejects.toThrow(
                "'locked' is not a widget type you can add. The types are chart, summary."
            );
            await expect(run(dashModel, 'add_widget', {type: 'summary'})).rejects.toThrow(
                'allows only one'
            );
        });

        it('respects the dashboard locks', async () => {
            const dashModel = createDash();
            dashModel.contentLocked = true;
            dashModel.layoutLocked = true;

            await expect(run(dashModel, 'add_widget', {type: 'chart'})).rejects.toThrow(
                'The dashboard is locked'
            );
            await expect(run(dashModel, 'move_widget', {widget: 'chart_0', x: 2})).rejects.toThrow(
                'The dashboard layout is locked.'
            );
        });

        it('keeps a dashboard with a locked layout from being rebuilt or reset', async () => {
            const dashModel = createDash();
            dashModel.layoutLocked = true;

            await expect(
                run(dashModel, 'set_dashboard', {widgets: [{type: 'chart'}]})
            ).rejects.toThrow('The dashboard layout is locked.');
            await expect(run(dashModel, 'reset_dashboard', {})).rejects.toThrow(
                'The dashboard layout is locked.'
            );
            expect(dashModel.layoutLocked).toBe(true);
        });

        it('removes widgets, and undoes it', async () => {
            const dashModel = createDash(),
                result = await run(dashModel, 'remove_widgets', {widgets: ['summary_0']});

            expect(result.output).toBe('Removed Summary.');
            expect(widgetIds(dashModel)).toEqual(['chart_0']);

            await result.undo();
            expect(widgetIds(dashModel)).toEqual(['chart_0', 'summary_0']);
        });

        it('moves and resizes a widget within the columns, and undoes it', async () => {
            const dashModel = createDash(),
                result = await run(dashModel, 'move_widget', {widget: 'summary_0', y: 4, width: 6});

            expect(layoutOf(dashModel, 'summary_0')).toEqual({x: 6, y: 4, w: 6, h: 2});
            await expect(
                run(dashModel, 'move_widget', {widget: 'summary_0', x: 8})
            ).rejects.toThrow('must fit within the 12 columns');

            await result.undo();
            expect(layoutOf(dashModel, 'summary_0')).toEqual({x: 6, y: 0, w: 4, h: 2});
        });

        it('renames a widget and merges its settings, and undoes it', async () => {
            const dashModel = createDash(),
                result = await run(
                    dashModel,
                    'configure_widget',
                    {widget: 'chart_0', title: 'Paris', settings: {series: 'rain'}},
                    {widgets: {chart: {settingsSchema: CHART_SETTINGS}}}
                ),
                chart = () => dashModel.viewModels.find(it => it.id === 'chart_0');

            expect(result.output).toBe('Updated Paris.');
            expect(chart().title).toBe('Paris');
            expect(chart().viewState).toEqual({series: 'rain', units: 'metric'});

            await result.undo();
            expect(chart().title).toBe('Forecast');
            expect(chart().viewState).toEqual({series: 'temp', units: 'metric'});
        });
    });

    describe('layout', () => {
        it('replaces the whole dashboard, and undoes it', async () => {
            const dashModel = createDash(),
                result = await run(dashModel, 'set_dashboard', {
                    widgets: [
                        {type: 'chart', title: 'Tokyo', x: 0, y: 0, width: 6, height: 4},
                        {type: 'chart', title: 'Paris', x: 6, y: 0, width: 6, height: 4}
                    ]
                });

            expect(result.output).toBe('Built the dashboard with 2 widgets: chart_0 and chart_1.');
            expect(map(dashModel.viewModels, 'title')).toEqual(['Tokyo', 'Paris']);

            await result.undo();
            expect(map(dashModel.viewModels, 'title')).toEqual(['Forecast', 'Summary']);
        });

        it('asks before clearing or resetting, with a preview, and undoes either', async () => {
            const dashModel = createDash(),
                group = dashCanvasTools(dashModel),
                clear = getTool(group, 'clear_dashboard'),
                reset = getTool(group, 'reset_dashboard');

            expect(clear.needsApproval).toBe(true);
            expect(reset.needsApproval).toBe(true);
            expect((clear.preview as (input: PlainObject) => string)({})).toBe(
                'Will remove 2 widgets: Forecast and Summary.'
            );

            const cleared = await run(dashModel, 'clear_dashboard', {});
            expect(dashModel.isEmpty).toBe(true);
            await cleared.undo();
            expect(widgetIds(dashModel)).toEqual(['chart_0', 'summary_0']);

            dashModel.removeView('summary_0');
            const reset_ = await run(dashModel, 'reset_dashboard', {});
            expect(widgetIds(dashModel)).toEqual(['chart_0', 'summary_0']);
            await reset_.undo();
            expect(widgetIds(dashModel)).toEqual(['chart_0']);
        });
    });

    describe('views', () => {
        it('saves the dashboard, with the changes made just before, as a new view', async () => {
            const {dashModel, viewManagerModel} = await createViewDashAsync();
            vi.spyOn(XH, 'successToast').mockImplementation(() => null);
            await run(dashModel, 'add_widget', {type: 'chart'});

            const output = await getTool(
                dashCanvasTools(dashModel, {viewManagerModel}),
                'save_view'
            ).execute({name: 'Mine'}, null);

            expect(output).toBe("Saved the dashboard as the view 'Mine'.");
            const [req] = hoistCore.requestsTo('xhView/create');
            expect(req.json).toMatchObject({
                type: 'testDash',
                name: 'Mine',
                value: {dashCanvas: {state: expect.objectContaining({length: 3})}}
            });
        });

        it('opens a view by name, and undoes it', async () => {
            const {dashModel, viewManagerModel} = await createViewDashAsync(),
                result = await run(dashModel, 'open_view', {name: 'Charts'}, {viewManagerModel});

            expect(result.output).toBe("Opened the view 'Charts'.");
            expect(viewManagerModel.view.name).toBe('Charts');
            expect(widgetIds(dashModel)).toEqual(['chart_0', 'chart_1']);

            await result.undo();
            expect(viewManagerModel.view.isDefault).toBe(true);
            expect(widgetIds(dashModel)).toEqual(['chart_0', 'summary_0']);
        });

        it('asks before saving over the current view', async () => {
            const {dashModel, viewManagerModel} = await createViewDashAsync(),
                save = getTool(dashCanvasTools(dashModel, {viewManagerModel}), 'save_view'),
                needsApproval = save.needsApproval as (input: PlainObject) => boolean;

            expect(needsApproval({})).toBe(true);
            expect(needsApproval({name: 'New'})).toBe(false);
        });
    });

    it("undoes a reply's dashboard changes through the chat", async () => {
        const dashModel = createDash(),
            group = dashCanvasTools(dashModel),
            model = new ChatModel({
                transport: new ScriptedChatTransport({
                    responses: [
                        [
                            ...toolCallEvents('add_widget', {type: 'chart'}),
                            ...toolCallEvents('remove_widgets', {widgets: ['summary_0']})
                        ],
                        textEvents('Swapped the summary for a chart.')
                    ],
                    delayMs: 0
                }),
                tools: group.tools,
                contextProviders: [group.contextProvider]
            });
        onTestFinished(() => model.destroy());

        await model.sendAsync('Swap the summary for a chart');
        expect(widgetIds(dashModel)).toEqual(['chart_0', 'chart_1']);

        await model.undoTurnAsync(model.lastMessage.id);
        expect(widgetIds(dashModel)).toEqual(['chart_0', 'summary_0']);
    });
});

//------------------
// Helpers
//------------------
const CHART_SETTINGS = {
    type: 'object',
    properties: {series: {type: 'string', enum: ['temp', 'wind', 'rain']}}
};

const INITIAL_STATE: DashCanvasItemState[] = [
    {
        viewSpecId: 'chart',
        layout: {x: 0, y: 0, w: 6, h: 4},
        state: {series: 'temp', units: 'metric'}
    },
    {viewSpecId: 'summary', layout: {x: 6, y: 0, w: 4, h: 2}}
];

function createDash(config: PlainObject = {}): DashCanvasModel {
    const ret = new DashCanvasModel({
        viewSpecs: [
            {id: 'chart', title: 'Forecast', content: () => null, width: 6, height: 4},
            {
                id: 'summary',
                title: 'Summary',
                content: () => null,
                width: 4,
                height: 2,
                unique: true
            },
            {id: 'locked', title: 'Locked', content: () => null, allowAdd: false}
        ],
        initialState: INITIAL_STATE,
        ...config
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

/** A dashboard persisted to a view manager, with one saved view, 'Charts', on a fake server. */
async function createViewDashAsync() {
    const chartsBlob = viewBlob('v1', 'Charts', {
        dashCanvas: {
            state: [
                {viewSpecId: 'chart', layout: {x: 0, y: 0, w: 6, h: 4}},
                {viewSpecId: 'chart', layout: {x: 6, y: 0, w: 6, h: 4}}
            ]
        }
    });
    hoistCore.route('*', 'xhView/allData', () => ({
        views: [chartsBlob],
        state: {currentView: null, userPinned: {}, autoSave: false}
    }));
    hoistCore.route('*', 'xhView/get', () => chartsBlob);
    hoistCore.route('*', 'xhView/updateState', () => ({}));
    hoistCore.route('POST', 'xhView/create', req => viewBlob('v2', req.json.name, req.json.value));

    const viewManagerModel = await ViewManagerModel.createAsync({
            type: 'testDash',
            preserveUnsavedChanges: false
        }),
        // No settle time, so that a change soon after loading persists.
        dashModel = createDash({persistWith: {viewManagerModel, settleTime: 0}});
    onTestFinished(() => viewManagerModel.destroy());
    return {dashModel, viewManagerModel};
}

function viewBlob(token: string, name: string, value: PlainObject): PlainObject {
    return {
        token,
        type: 'testDash',
        name,
        owner: 'jdoe',
        description: null,
        meta: {},
        value,
        dateCreated: 1791997893000,
        lastUpdated: 1791997893000,
        lastUpdatedBy: 'jdoe'
    };
}

function widgetIds(dashModel: DashCanvasModel): string[] {
    return map(dashModel.viewModels, 'id');
}

function layoutOf(dashModel: DashCanvasModel, id: string): PlainObject {
    const {x, y, w, h} = dashModel.layout.find(it => it.i === id);
    return {x, y, w, h};
}

function getTool(group: ChatToolGroup, name: string): ChatToolSpec {
    return group.tools.find(it => it.name === name);
}

/** Run a tool of a new group on the dashboard, as the chat would, and return its result. */
async function run(
    dashModel: DashCanvasModel,
    name: string,
    input: PlainObject,
    config: DashCanvasToolsConfig = {}
): Promise<ChatToolResult> {
    const ret = await getTool(dashCanvasTools(dashModel, config), name).execute(input, null);
    expect(ret).toBeInstanceOf(ChatToolResult);
    return ret;
}
