# Assist Package

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What tool groups are, and the key features |
| [Architecture](#architecture) | `ChatToolGroup`, `gridTools`, `dashCanvasTools`, and how a group fits a chat |
| [Configuration Pattern](#configuration-pattern) | Building a helper chat from a tool group |
| [Common Usage Patterns](#common-usage-patterns) | Grids, dashboards, settings, approvals, and adding app tools |
| [Properties/API Reference](#propertiesapi-reference) | Options, capabilities, and the tools of each group |
| [Extension Points](#extension-points) | Changing tools, and writing a group of your own |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Core models, the chat service, and Hoist packages |

## Overview

The `/assist/` package holds tool groups for component helper agents. A helper is a small
assistant beside one complex Hoist component, such as a grid or a dashboard. The user says what
they want, such as "group by sector and hide the id columns", and the model makes the change
through typed tools.

A tool group derives those tools from the component's Hoist model. Each tool calls the model's
public API, acts only on that one component, and returns an undo. The group also describes the
component to the model on every step, and supplies a short prompt and suggestion chips.

`gridTools` is platform-neutral and lives here. `dashCanvasTools` acts on a desktop
`DashCanvasModel`, so it lives in `/desktop/assist/`. This README covers both.

Import from `@xh/hoist-chat-kit/assist` and `@xh/hoist-chat-kit/desktop/assist`.

Key features:

- **Tools derived from the model** - schemas list the component's current column, field, widget
  or view ids, read again on every step.
- **The tools are the schema** - the model never writes config that the app evaluates. It can
  change a dashboard widget's settings only through a schema the app supplies.
- **Every change can be undone** - each tool returns an undo from the model's own state, and the
  user undoes a reply's changes from the message.
- **Approval where it matters** - clearing or resetting a dashboard, overwriting a saved view, and
  leaving unsaved changes ask the user first, with a preview of the change.
- **Structure, not data** - the context describes columns, sorts, filters and widgets, with no row
  values.
- **Opt-in capabilities** - each group offers what its component supports, or the subset you name.

## Architecture

```
ChatToolGroup
├── tools: ChatToolSpec[]               # Tools that act on one component, each with an undo
├── contextProvider: ChatContextProvider # The component's structure, on every step
├── prompt: string                      # What the tools can do, for the system prompt
└── suggestions: string[]               # Three prompts to start with

gridTools(gridModel, {capabilities?, description?})            # /assist/
dashCanvasTools(dashCanvasModel, {capabilities?, description?,  # /desktop/assist/
                                  widgets?, viewManagerModel?})
```

A group gives a `ChatModel` everything that is specific to the component. The chat supplies the
rest: the turn loop, approvals, the undo stack, and the transport. `ChatService` resolves the
transport from the app's config - see [`/svc/`](../svc/README.md).

```
user message -> ChatModel -> step: contextProvider + tools -> transport -> model
                    ^                                                    |
                    └── tool runs: gridModel.setSortBy(...), returns undo <┘
```

## Configuration Pattern

Build one `ChatModel` per helper, from a group:

```typescript
import {gridTools} from '@xh/hoist-chat-kit/assist';
import {ChatModel} from '@xh/hoist-chat-kit/core';

export class PositionsPanelModel extends HoistModel {
    @managed gridModel = new GridModel({...});
    @managed helperModel: ChatModel = null;

    constructor() {
        super();
        if (!XH.chatService?.isEnabled) return;

        const group = gridTools(this.gridModel, {description: 'Open positions, one row per trade'});
        this.helperModel = new ChatModel({
            transport: XH.chatService.createTransport({system: group.prompt}),
            tools: group.tools,
            contextProviders: [group.contextProvider],
            maxSteps: 5
        });
    }
}
```

Pass `group.suggestions` to a `chatPanel` or a `chatEmptyState` as its `suggestions`. Render the
chat with the desktop chat components - see [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md).

## Common Usage Patterns

### Arrange a grid

`gridTools` offers every capability the grid supports:

| Capability | Tools | Needs |
|------------|-------|-------|
| `columns` | `update_columns` (show, hide, resize, pin), `move_columns` | - |
| `sort` | `sort_grid` | - |
| `group` | `group_grid` | Not a tree grid |
| `filter` | `filter_grid`, `clear_filters` | A `filterModel` |
| `autosize` | `autosize_columns` | Autosize mode other than `disabled` |
| `export` | `export_grid` | `enableExport` |
| `select` | `select_rows`, `clear_selection` | A selection mode other than `disabled` |

Pass `capabilities` to offer fewer. A capability the grid does not support throws.

```typescript
gridTools(gridModel, {capabilities: ['columns', 'sort', 'group']});
```

The tools refuse what the grid refuses, with an error that the model can act on. For example,
they do not hide a column with `hideable: false`, or sort one with `sortable: false`. The filter
tools take only the fields and operators of the grid's filter field specs. `select_rows` selects
the rows shown that meet the given conditions, so the model can select rows without seeing them.

The context gives the model each column's id, name, field type, visibility, width and pin. It
also gives the grid's sorts, grouping, filter, filter fields, and row and selection counts.

### Arrange a dashboard

`dashCanvasTools` acts on a `DashCanvasModel`:

| Capability | Tools | Needs |
|------------|-------|-------|
| `widgets` | `add_widget`, `remove_widgets`, `move_widget`, `configure_widget` | - |
| `layout` | `set_dashboard`, `clear_dashboard`, `reset_dashboard` | - |
| `views` | `save_view`, `open_view`, `reset_view` | A `viewManagerModel` |

The prompt lists the widget types that the model may add, with each type's title, default size,
and any description and settings you give. The context lists the current widgets, with their ids,
types, titles, positions and sizes, and the current view. The tools respect the dashboard's
`contentLocked`, `layoutLocked` and `renameLocked`, and each view spec's `allowAdd`,
`allowRemove`, `allowRename` and `unique`.

```typescript
dashCanvasTools(dashCanvasModel, {
    description: 'Weather in the cities I follow',
    viewManagerModel,
    widgets: {
        forecast: {
            description: 'A chart of the forecast for one city.',
            settingsSchema: {
                type: 'object',
                properties: {
                    city: {type: 'string'},
                    series: {type: 'array', items: {enum: ['temp', 'wind', 'rain']}}
                }
            }
        }
    }
});
```

### Let the model change widget settings

A widget's settings are its view state. The model can set only the top-level keys that the
widget type's `settingsSchema` names. The model can add, move and rename a widget of a type with
no schema, but cannot change its settings. The context sends only the declared keys of each widget's
state.

The tools check the keys, not the values. Validate the values in the widget, as you would any
saved state.

### Ask before a change

The groups ask the user to approve the tools that discard work: `clear_dashboard`,
`reset_dashboard`, `reset_view`, `save_view` with no name, which saves over the current view, and
`open_view` while the dashboard has unsaved changes. The card shows a `preview` of the change,
such as "Will remove 3 widgets: Map, News and Chart."

To ask before every change, set `needsApproval` on the tools you want. Each call to a group
factory builds new specs, so set the property on them directly:

```typescript
group.tools.forEach(it => (it.needsApproval = true));
```

### Add tools of your own

A group's tools are plain `ChatToolSpec`s. Combine them with the app's own tools, and add the app's
instructions to the group's prompt:

```typescript
new ChatModel({
    transport: XH.chatService.createTransport({system: `${group.prompt}\n${APP_PROMPT}`}),
    tools: [...group.tools, ...this.weatherTools],
    contextProviders: [group.contextProvider, this.citiesContextProvider]
});
```

Return `chatToolResult(output, {undo})` from your own tools, so their changes can be undone too.

## Properties/API Reference

### GridToolsConfig

| Property | Type | Description |
|----------|------|-------------|
| `capabilities` | `GridToolCapability[]` | What the tools may do. Default every capability the grid supports. |
| `description` | `string` | What the grid shows, for the prompt and the context. |

### DashCanvasToolsConfig

| Property | Type | Description |
|----------|------|-------------|
| `capabilities` | `DashCanvasToolCapability[]` | What the tools may do. Default `widgets` and `layout`, plus `views` with a view manager. |
| `description` | `string` | What the dashboard is for, for the prompt and the context. |
| `widgets` | `Record<string, DashCanvasWidgetInfo>` | Per view spec id: a `description` for the model, and a `settingsSchema` of the settings it may change. |
| `viewManagerModel` | `ViewManagerModel` | The view manager that saves the dashboard's views. Required for `views`. |

### Undo

| Group | What an undo restores |
|-------|-----------------------|
| `gridTools` | The part of the grid the tool changed: `columnState`, `sortBy`, `groupBy`, the filter, or the selection. |
| `dashCanvasTools` | The dashboard's persistable state from before the call. `open_view` also opens the prior view. `save_view` has no undo. |

## Extension Points

- **Change a tool** - each call to a group factory builds new specs, so set a description, an
  icon or `needsApproval` on them directly. Do not copy a spec - see
  [Copying a tool spec](#copying-a-tool-spec).
- **Write a group of your own** - return a `ChatToolGroup`. Read schemas in a getter, so the model
  sees the component's current ids. Act through the model's public API, and return
  `chatToolResult(output, {undo})` with an undo from its persistable state.

## Common Pitfalls

### Copying a tool spec

Each schema is a getter that reads the component's current state. A spread or `Object.assign()`
reads the getter once and copies the value, so the copy's enums go stale when columns or widgets
change.

```typescript
// ✅ Do: Change the group's own spec
spec.needsApproval = true;

// ❌ Don't: The copy freezes the schema at its current value
const tool = {...spec, needsApproval: true};
```

### Undoing an older reply

Only the latest reply with changes can be undone. Its undo restores a snapshot, so undoing an
older reply first would revert the later ones too. Undo the latest, then the one before it.

### Sending row data as context

The groups send structure only. If the model needs values, such as the top ten rows, add a
context provider or a tool of your own. Decide first what may leave the browser.

## Related Packages

- [`/core/`](../core/README.md) - `ChatModel`, context providers, `chatToolResult` and undo
- [`/svc/`](../svc/README.md) - `ChatService`, the app's default LLM backend
- [`/transport/`](../transport/README.md) - codecs, and
  [Bring your own LLM](../transport/README.md#bring-your-own-llm)
- [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) - the chat components, and the Undo action
- hoist-react `/cmp/grid/` - `GridModel`, column state, sorting, grouping and filters
- hoist-react `/desktop/cmp/dash/` - `DashCanvasModel`, view specs and persistable state
