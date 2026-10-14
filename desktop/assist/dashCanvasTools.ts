import type {ViewManagerModel} from '@xh/hoist/cmp/viewmanager';
import type {PlainObject} from '@xh/hoist/core';
import type {
    DashCanvasItemState,
    DashCanvasModel,
    DashCanvasViewModel,
    DashCanvasViewSpec
} from '@xh/hoist/desktop/cmp/dash';
import {Icon} from '@xh/hoist/icon';
import {wait} from '@xh/hoist/promise';
import {pluralize, throwIf} from '@xh/hoist/utils/js';
import {
    compact,
    countBy,
    difference,
    isEmpty,
    isNil,
    keys,
    map,
    omitBy,
    pick,
    pickBy
} from 'lodash';
import type {ChatContextProvider, ChatToolSpec} from '../../core';
import {chatToolResult} from '../../core';
import type {ChatToolGroup} from '../../assist';
import {arraySchema, enumSchema, joinNames, objectSchema} from '../../assist/impl/schema';

/**
 * What a {@link dashCanvasTools} group can do to its dashboard:
 *
 *  - `widgets` - add, remove, move, resize, rename and configure widgets.
 *  - `layout` - replace the whole dashboard, clear it, or reset it to its defaults.
 *  - `views` - save, open and reset saved views. Needs a `viewManagerModel`.
 */
export type DashCanvasToolCapability = 'widgets' | 'layout' | 'views';

/** Options for {@link dashCanvasTools}. */
export interface DashCanvasToolsConfig {
    /**
     * What the tools may do. Default every capability the dashboard supports - see
     * {@link DashCanvasToolCapability}. Throws if given one it does not support.
     */
    capabilities?: DashCanvasToolCapability[];

    /** What the dashboard is for, for the model - such as 'Weather in the cities I follow'. */
    description?: string;

    /**
     * What each widget type shows, and which of its settings the model may change, keyed by view
     * spec id.
     */
    widgets?: Record<string, DashCanvasWidgetInfo>;

    /** The view manager that saves this dashboard's views, for the `views` capability. */
    viewManagerModel?: ViewManagerModel;
}

/** What the model may know and change about one widget type - see {@link dashCanvasTools}. */
export interface DashCanvasWidgetInfo {
    /** What the widget shows, for the model. */
    description?: string;

    /**
     * JSON Schema for the widget's settings that the model may change: an object schema whose
     * properties are top-level keys of the widget's view state. The model can set only those
     * keys, and the widget should validate them as it would any saved state. Without a schema, the
     * model can add, move and rename the widget, but not change its settings.
     */
    settingsSchema?: PlainObject;
}

/**
 * Tools that let the model arrange a `DashCanvas` through its `DashCanvasModel`: add, remove,
 * move, resize and configure widgets, replace or reset the whole layout, and - with a view
 * manager - save and open views. Each tool acts only on the given dashboard, through its public
 * API, and returns an undo that restores the dashboard's persistable state from before the call.
 * Clearing and resetting the dashboard, overwriting a saved view, and leaving unsaved changes ask
 * the user first.
 *
 * The prompt lists the widget types the model may add, with their descriptions and settings. The
 * context provider describes the current widgets on every step - their ids, types, titles,
 * positions, sizes and settings - and the current view. The settings it sends are only those named
 * in a widget type's `settingsSchema`.
 *
 * @param dashCanvasModel - the dashboard to act on.
 */
export function dashCanvasTools(
    dashCanvasModel: DashCanvasModel,
    config: DashCanvasToolsConfig = {}
): ChatToolGroup {
    const {description = null, widgets = {}, viewManagerModel = null} = config,
        supported: Record<DashCanvasToolCapability, boolean> = {
            widgets: true,
            layout: true,
            views: !!viewManagerModel
        },
        capabilities = (config.capabilities ??
            keys(pickBy(supported))) as DashCanvasToolCapability[],
        unsupported = capabilities.filter(it => !supported[it]);
    throwIf(
        !isEmpty(unsupported),
        `dashCanvasTools cannot offer ${unsupported.join(', ')} - it needs a viewManagerModel.`
    );

    const tools = new DashCanvasTools(dashCanvasModel, widgets, viewManagerModel);
    return {
        tools: capabilities.flatMap(it => tools.forCapability(it)),
        contextProvider: tools.createContextProvider(description),
        prompt: tools.createPrompt(description, capabilities),
        suggestions: tools.createSuggestions(capabilities)
    };
}

//------------------
// Implementation
//------------------
const CAPABILITY_PHRASES: Record<DashCanvasToolCapability, string> = {
    widgets: 'add, remove, move, resize, rename and configure widgets',
    layout: 'replace the whole dashboard, clear it, or reset it to its defaults',
    views: 'save, open and reset saved views'
};

const LAYOUT_PROPERTIES = {
    x: {type: 'integer', minimum: 0, description: 'Column of the left edge, from 0.'},
    y: {type: 'integer', minimum: 0, description: 'Row of the top edge, from 0.'},
    width: {type: 'integer', minimum: 1, description: 'Width in columns.'},
    height: {type: 'integer', minimum: 1, description: 'Height in rows.'}
};

/** Longer than the 250ms that persistence providers debounce their writes by default. */
const PERSIST_WAIT_MS = 500;

const SETTINGS_SCHEMA = {
    type: 'object',
    description: "Settings for the widget, as its type's settings schema in the prompt allows."
};

/** Builds the tools of one dashboard. */
class DashCanvasTools {
    constructor(
        private readonly dashCanvasModel: DashCanvasModel,
        private readonly widgetInfo: Record<string, DashCanvasWidgetInfo>,
        private readonly viewManagerModel: ViewManagerModel
    ) {}

    forCapability(capability: DashCanvasToolCapability): ChatToolSpec[] {
        switch (capability) {
            case 'widgets':
                return [
                    this.addWidgetTool(),
                    this.removeWidgetsTool(),
                    this.moveWidgetTool(),
                    this.configureWidgetTool()
                ];
            case 'layout':
                return [
                    this.setDashboardTool(),
                    this.clearDashboardTool(),
                    this.resetDashboardTool()
                ];
            case 'views':
                return [this.saveViewTool(), this.openViewTool(), this.resetViewTool()];
        }
    }

    createPrompt(description: string, capabilities: DashCanvasToolCapability[]): string {
        const {columns} = this.dashCanvasModel,
            dashboard = description ? `a dashboard - ${description}` : 'a dashboard',
            phrases = joinNames(capabilities.map(it => CAPABILITY_PHRASES[it])),
            types = this.addableSpecs.map(spec => {
                const {description, settingsSchema} = this.widgetInfo[spec.id] ?? {};
                return compact([
                    `- ${spec.id}: ${spec.title}.`,
                    description,
                    `Default size ${spec.width} by ${spec.height}.`,
                    spec.unique ? 'At most one.' : null,
                    settingsSchema ? `Settings: ${JSON.stringify(settingsSchema)}` : null
                ]).join(' ');
            });
        return [
            `You help the user arrange ${dashboard}. Your tools can ${phrases}.`,
            `The dashboard is a grid ${columns} columns wide. x and width count columns, and y ` +
                'and height count rows.',
            'Widget types:',
            ...types,
            "Each message comes with the dashboard's current widgets. Read them rather than " +
                'asking the user.',
            'Tools take widget ids. Use widget titles when you write to the user.',
            'Make the changes the user asks for without asking first - the user can undo them.'
        ].join('\n');
    }

    createContextProvider(description: string): ChatContextProvider {
        const {dashCanvasModel, viewManagerModel} = this;
        return {
            name: 'dashboard',
            description:
                (description ? `The dashboard - ${description}. ` : 'The dashboard. ') +
                'Its widgets, with their positions, sizes and settings.',
            getContext: () => {
                const view = viewManagerModel?.view;
                return omitBy(
                    {
                        widgets: dashCanvasModel.viewModels.map(it => this.describeWidget(it)),
                        layoutLocked: dashCanvasModel.layoutLocked || null,
                        contentLocked: dashCanvasModel.contentLocked || null,
                        view: view
                            ? {name: view.name, unsavedChanges: viewManagerModel.isValueDirty}
                            : null
                    },
                    isNil
                );
            }
        };
    }

    createSuggestions(capabilities: DashCanvasToolCapability[]): string[] {
        const [first, second] = this.addableSpecs,
            candidates: Record<DashCanvasToolCapability, string[]> = {
                widgets: compact([
                    first ? `Add a ${first.title} widget` : null,
                    'Make the widgets on the top row taller'
                ]),
                layout: [
                    second
                        ? `Build a dashboard with a ${first.title} and a ${second.title}`
                        : 'Tidy up the layout'
                ],
                views: ['Save this as a new view']
            };
        return capabilities.flatMap(it => candidates[it]).slice(0, 3);
    }

    //------------------
    // Widgets
    //------------------
    private addWidgetTool(): ChatToolSpec {
        const tools = this;
        return {
            name: 'add_widget',
            description:
                'Add a widget. It takes the next free space, unless a position is given. ' +
                'Returns its id.',
            get parameters() {
                return objectSchema(
                    {
                        type: enumSchema(map(tools.addableSpecs, 'id'), 'Widget type.'),
                        title: {type: 'string', description: 'Title. Defaults to the type title.'},
                        position: enumSchema(
                            ['first', 'last', 'nextAvailable'],
                            'Where to put it: at the top, at the bottom, or in the first free ' +
                                "space. Default 'nextAvailable'."
                        ),
                        width: LAYOUT_PROPERTIES.width,
                        height: LAYOUT_PROPERTIES.height,
                        settings: SETTINGS_SCHEMA
                    },
                    ['type']
                );
            },
            displayName: 'Add widget',
            icon: Icon.add(),
            summary: ({input}) => input?.title ?? this.getSpec(input?.type)?.title ?? null,
            execute: ({type, title, position = 'nextAvailable', width, height, settings}) => {
                this.checkContentUnlocked();
                const spec = this.requireAddableSpec(type);
                throwIf(
                    spec.unique && !isEmpty(this.dashCanvasModel.getViewsBySpecId(type)),
                    `The dashboard already has a ${spec.title}, and allows only one.`
                );
                this.checkSettings(type, settings);

                const undo = this.stateUndo(),
                    view = this.dashCanvasModel.addView(type, {
                        title,
                        position,
                        width,
                        height,
                        state: settings
                    });
                return chatToolResult(`Added ${view.title} as '${view.id}'.`, {undo});
            }
        };
    }

    private removeWidgetsTool(): ChatToolSpec {
        const tools = this;
        return {
            name: 'remove_widgets',
            description: 'Remove widgets from the dashboard.',
            get parameters() {
                return objectSchema(
                    {
                        widgets: arraySchema(
                            enumSchema(tools.widgetIds),
                            'Ids of the widgets to remove.',
                            1
                        )
                    },
                    ['widgets']
                );
            },
            displayName: 'Remove widgets',
            icon: Icon.delete(),
            summary: ({input}) => this.widgetTitles(compact(input?.widgets)),
            execute: ({widgets}) => {
                this.checkContentUnlocked();
                const views = widgets.map(it => this.requireView(it));
                views.forEach(it =>
                    throwIf(!it.viewSpec.allowRemove, `Widget '${it.id}' cannot be removed.`)
                );

                const undo = this.stateUndo(),
                    titles = this.widgetTitles(widgets);
                views.forEach(it => this.dashCanvasModel.removeView(it.id));
                return chatToolResult(`Removed ${titles}.`, {undo});
            }
        };
    }

    private moveWidgetTool(): ChatToolSpec {
        const tools = this;
        return {
            name: 'move_widget',
            description:
                'Move or resize a widget. Give only the values to change. Widgets below it move ' +
                'down to make room.',
            get parameters() {
                return objectSchema(
                    {widget: enumSchema(tools.widgetIds, 'Widget id.'), ...LAYOUT_PROPERTIES},
                    ['widget']
                );
            },
            displayName: 'Move widget',
            icon: Icon.arrowsLeftRight(),
            summary: ({input}) => this.widgetTitles(compact([input?.widget])),
            execute: ({widget, x, y, width, height}) => {
                const {dashCanvasModel} = this,
                    {columns} = dashCanvasModel;
                throwIf(dashCanvasModel.layoutLocked, 'The dashboard layout is locked.');
                this.requireView(widget);

                const current = dashCanvasModel.layout.find(it => it.i === widget),
                    changed = {
                        ...current,
                        x: x ?? current.x,
                        y: y ?? current.y,
                        w: width ?? current.w,
                        h: height ?? current.h
                    };
                throwIf(
                    changed.x + changed.w > columns,
                    `The widget must fit within the ${columns} columns of the dashboard.`
                );

                const undo = this.stateUndo();
                dashCanvasModel.onRglLayoutChange(
                    dashCanvasModel.layout.map(it => (it.i === widget ? changed : it))
                );
                return chatToolResult(
                    `Moved ${this.widgetTitles([widget])} to x ${changed.x}, y ${changed.y}, ` +
                        `${changed.w} wide and ${changed.h} high.`,
                    {undo}
                );
            }
        };
    }

    private configureWidgetTool(): ChatToolSpec {
        const tools = this;
        return {
            name: 'configure_widget',
            description:
                "Rename a widget, or change its settings. Settings merge into the widget's " +
                'current settings.',
            get parameters() {
                return objectSchema(
                    {
                        widget: enumSchema(tools.widgetIds, 'Widget id.'),
                        title: {type: 'string', description: 'New title.'},
                        settings: SETTINGS_SCHEMA
                    },
                    ['widget']
                );
            },
            displayName: 'Configure widget',
            icon: Icon.gear(),
            summary: ({input}) => this.widgetTitles(compact([input?.widget])),
            execute: ({widget, title, settings}) => {
                const view = this.requireView(widget);
                throwIf(title == null && isEmpty(settings), 'Give a title, settings, or both.');
                throwIf(
                    title != null &&
                        (this.dashCanvasModel.renameLocked || !view.viewSpec.allowRename),
                    `Widget '${widget}' cannot be renamed.`
                );
                this.checkSettings(view.viewSpec.id, settings);

                const undo = this.stateUndo();
                if (title != null) view.title = title;
                if (!isEmpty(settings)) view.setViewState({...view.viewState, ...settings});
                return chatToolResult(`Updated ${view.title}.`, {undo});
            }
        };
    }

    //------------------
    // Layout
    //------------------
    private setDashboardTool(): ChatToolSpec {
        const tools = this;
        return {
            name: 'set_dashboard',
            description:
                'Replace every widget on the dashboard with the given ones - to build a ' +
                'dashboard from scratch, or to rearrange most of it. For smaller changes, use ' +
                'the widget tools.',
            get parameters() {
                return objectSchema(
                    {
                        widgets: arraySchema(
                            objectSchema(
                                {
                                    type: enumSchema(map(tools.addableSpecs, 'id'), 'Widget type.'),
                                    title: {type: 'string', description: 'Title.'},
                                    ...LAYOUT_PROPERTIES,
                                    settings: SETTINGS_SCHEMA
                                },
                                ['type', 'x', 'y', 'width', 'height']
                            ),
                            'The widgets of the new dashboard.'
                        )
                    },
                    ['widgets']
                );
            },
            displayName: 'Build dashboard',
            icon: Icon.gridLarge(),
            summary: ({input}) =>
                input?.widgets ? pluralize('widget', input.widgets.length, true) : null,
            execute: ({widgets}) => {
                this.checkContentUnlocked();
                widgets.forEach(({type, settings}) => {
                    this.requireAddableSpec(type);
                    this.checkSettings(type, settings);
                });
                const repeated = keys(
                    pickBy(
                        countBy(widgets, 'type'),
                        (n, type) => n > 1 && this.getSpec(type).unique
                    )
                );
                throwIf(
                    !isEmpty(repeated),
                    `The dashboard allows only one ${repeated.join(', ')}.`
                );

                const undo = this.stateUndo(),
                    state: DashCanvasItemState[] = widgets.map(
                        ({type, title, x, y, width, height, settings}) => ({
                            viewSpecId: type,
                            title,
                            layout: {x, y, w: width, h: height},
                            state: settings
                        })
                    );
                this.dashCanvasModel.loadState(state);
                return chatToolResult(
                    `Built the dashboard with ${pluralize('widget', state.length, true)}: ` +
                        `${joinNames(map(this.dashCanvasModel.viewModels, 'id'))}.`,
                    {undo}
                );
            }
        };
    }

    private clearDashboardTool(): ChatToolSpec {
        return {
            name: 'clear_dashboard',
            description: 'Remove every widget from the dashboard.',
            parameters: objectSchema(),
            displayName: 'Clear dashboard',
            icon: Icon.reset(),
            needsApproval: true,
            approvalPrompt: 'Remove every widget from the dashboard?',
            preview: () => `Will remove ${this.allWidgetsText()}.`,
            execute: () => {
                this.checkContentUnlocked();
                const undo = this.stateUndo();
                this.dashCanvasModel.clear();
                return chatToolResult('Cleared the dashboard.', {undo});
            }
        };
    }

    private resetDashboardTool(): ChatToolSpec {
        return {
            name: 'reset_dashboard',
            description: 'Reset the dashboard to its default widgets and layout.',
            parameters: objectSchema(),
            displayName: 'Reset dashboard',
            icon: Icon.reset(),
            needsApproval: true,
            approvalPrompt: 'Reset the dashboard to its defaults? This discards your changes.',
            preview: () => `Will replace ${this.allWidgetsText()}.`,
            execute: () => {
                const undo = this.stateUndo();
                this.dashCanvasModel.restoreDefaults();
                return chatToolResult('Reset the dashboard to its defaults.', {undo});
            }
        };
    }

    //------------------
    // Views
    //------------------
    private saveViewTool(): ChatToolSpec {
        const {viewManagerModel} = this;
        return {
            name: 'save_view',
            description:
                'Save the dashboard as a new view with the given name, or - with no name - save ' +
                'changes to the current view. Saving cannot be undone.',
            parameters: objectSchema({
                name: {type: 'string', description: 'Name for a new view.'}
            }),
            displayName: 'Save view',
            icon: Icon.floppyDisk(),
            summary: ({input}) => input?.name ?? viewManagerModel.view?.name,
            // Saving over the current view replaces what it held.
            needsApproval: ({name}) => !name?.trim(),
            approvalPrompt: () => `Save your changes to the '${viewManagerModel.view.name}' view?`,
            execute: async ({name}) => {
                name = name?.trim();
                // The dashboard writes its state to the view manager after a debounce, so a change
                // made earlier in the turn may not have reached it yet.
                await wait(PERSIST_WAIT_MS);
                if (name) {
                    await viewManagerModel.saveAsAsync({
                        name,
                        group: null,
                        description: null,
                        isShared: false,
                        isGlobal: false,
                        value: viewManagerModel.getValue()
                    });
                    return `Saved the dashboard as the view '${name}'.`;
                }
                throwIf(
                    !viewManagerModel.isViewSavable,
                    'The current view cannot be saved. Save it under a new name.'
                );
                await viewManagerModel.saveAsync();
                return `Saved the view '${viewManagerModel.view.name}'.`;
            }
        };
    }

    private openViewTool(): ChatToolSpec {
        const {viewManagerModel, dashCanvasModel} = this;
        return {
            name: 'open_view',
            description: 'Open a saved view by name, replacing the dashboard.',
            get parameters() {
                return objectSchema(
                    {name: enumSchema(map(viewManagerModel.views, 'name'), 'View name.')},
                    ['name']
                );
            },
            displayName: 'Open view',
            icon: Icon.folderOpen(),
            summary: ({input}) => input?.name,
            needsApproval: () => viewManagerModel.isValueDirty,
            approvalPrompt: input =>
                `Open the view '${input.name}'? Your unsaved changes to this view will be lost.`,
            execute: async ({name}) => {
                const target = viewManagerModel.views.find(
                    it => it.name.toLowerCase() === name?.trim().toLowerCase()
                );
                if (!target) {
                    const names = map(viewManagerModel.views, 'name');
                    throw new Error(
                        `No view is named '${name}'. The views are ${names.join(', ') || 'none'}.`
                    );
                }

                const priorToken = viewManagerModel.view.token,
                    priorState = dashCanvasModel.getPersistableState();
                await viewManagerModel.selectViewAsync(target, {alertUnsavedChanges: false});
                return chatToolResult(`Opened the view '${target.name}'.`, {
                    undo: async () => {
                        await viewManagerModel.selectViewAsync(priorToken, {
                            alertUnsavedChanges: false
                        });
                        dashCanvasModel.setPersistableState(priorState);
                    }
                });
            }
        };
    }

    private resetViewTool(): ChatToolSpec {
        const {viewManagerModel} = this;
        return {
            name: 'reset_view',
            description: 'Discard unsaved changes, and return the dashboard to the saved view.',
            parameters: objectSchema(),
            displayName: 'Reset view',
            icon: Icon.reset(),
            summary: () => viewManagerModel.view?.name,
            needsApproval: true,
            approvalPrompt: () =>
                `Discard your unsaved changes to the '${viewManagerModel.view.name}' view?`,
            execute: async () => {
                const undo = this.stateUndo();
                await viewManagerModel.resetAsync();
                return chatToolResult(`Reset to the saved view '${viewManagerModel.view.name}'.`, {
                    undo
                });
            }
        };
    }

    //------------------
    // Helpers
    //------------------
    /** View specs the model may add. */
    get addableSpecs(): DashCanvasViewSpec[] {
        return this.dashCanvasModel.viewSpecs.filter(it => it.allowAdd);
    }

    get widgetIds(): string[] {
        return map(this.dashCanvasModel.viewModels, 'id');
    }

    /** An undo that restores the dashboard's persistable state from now. */
    private stateUndo(): () => void {
        const {dashCanvasModel} = this,
            prior = dashCanvasModel.getPersistableState();
        return () => dashCanvasModel.setPersistableState(prior);
    }

    private getSpec(id: string): DashCanvasViewSpec {
        return this.dashCanvasModel.viewSpecs.find(it => it.id === id) ?? null;
    }

    private requireAddableSpec(type: string): DashCanvasViewSpec {
        const spec = this.getSpec(type);
        if (!spec?.allowAdd) {
            throw new Error(
                `'${type}' is not a widget type you can add. The types are ` +
                    `${map(this.addableSpecs, 'id').join(', ')}.`
            );
        }
        return spec;
    }

    private requireView(id: string): DashCanvasViewModel {
        const view = this.dashCanvasModel.viewModels.find(it => it.id === id);
        if (!view) {
            throw new Error(
                `The dashboard has no widget '${id}'. Its widgets are ` +
                    `${this.widgetIds.join(', ') || 'none'}.`
            );
        }
        return view;
    }

    private checkContentUnlocked() {
        throwIf(
            this.dashCanvasModel.contentLocked,
            'The dashboard is locked - widgets cannot be added or removed.'
        );
    }

    /** Throw unless the settings are keys that the widget type's settings schema names. */
    private checkSettings(type: string, settings: PlainObject) {
        if (isEmpty(settings)) return;
        const allowed = keys(this.widgetInfo[type]?.settingsSchema?.properties),
            unknown = difference(keys(settings), allowed);
        throwIf(isEmpty(allowed), `Widget type '${type}' has no settings you can change.`);
        throwIf(
            !isEmpty(unknown),
            `Widget type '${type}' has no settings ${unknown.join(', ')}. Its settings are ` +
                `${allowed.join(', ')}.`
        );
    }

    private describeWidget(view: DashCanvasViewModel): PlainObject {
        const {id, viewSpec, title, viewState, positionParams} = view,
            schema = this.widgetInfo[viewSpec.id]?.settingsSchema,
            settings = schema ? pick(viewState, keys(schema.properties)) : null;
        return omitBy(
            {
                id,
                type: viewSpec.id,
                title,
                x: positionParams?.x,
                y: positionParams?.y,
                width: positionParams?.w,
                height: positionParams?.h,
                settings: isEmpty(settings) ? null : settings
            },
            isNil
        );
    }

    private widgetTitles(ids: string[]): string {
        const {viewModels} = this.dashCanvasModel;
        return joinNames(ids.map(id => viewModels.find(it => it.id === id)?.title ?? id));
    }

    private allWidgetsText(): string {
        const {viewModels} = this.dashCanvasModel;
        if (isEmpty(viewModels)) return 'nothing - the dashboard is empty';
        return `${pluralize('widget', viewModels.length, true)}: ${joinNames(map(viewModels, 'title'))}`;
    }
}
