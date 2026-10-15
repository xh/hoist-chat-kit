# Desktop Component Helper

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the helper components do, and the key features |
| [Architecture](#architecture) | The button, the container, the view and the boundary line |
| [Configuration Pattern](#configuration-pattern) | Putting a helper beside a grid |
| [Common Usage Patterns](#common-usage-patterns) | Dashboards, dialogs, Ask in chat, a label on the button |
| [Properties/API Reference](#propertiesapi-reference) | Props, the keyboard and the badge |
| [Extension Points](#extension-points) | Icons, the shortcut and the theme variables |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | The helper model, the tool groups and Hoist packages |

## Overview

The `/desktop/cmp/assist/` package holds the desktop parts of a component helper: a small
assistant beside one complex component, such as a grid or a dashboard. The user asks it to
change the component, or how to use it. The model and its tools live in
[`/assist/`](../../../assist/README.md). This package draws them.

Import from `@xh/hoist-chat-kit/desktop/cmp/assist`.

Key features:

- **One entry button** - a minimal icon button, last in the component's header. It does not
  render without a backend.
- **Dock or popover** - the helper docks inside a component 740 px or wider, with a splitter.
  A narrower component gets a popover from the button. The container measures its own box, not
  the window.
- **A badge while closed** - for a turn that waits for the user, a failed request, a running
  turn, or a new reply. It never animates.
- **Change lines** - each change shows as one line with a check and Show, which flashes the
  change again on the component. The reply's Undo restores the component. A group tool that sets
  its own `display`, such as `hidden` or `timeline`, keeps it.
- **Undo retires** - once the user changes the component by hand, Undo gives way to the reason.
- **A data boundary line** - one line above the composer says what the model can see, in the
  app's words. A click lists what is shared and what is not.
- **Keyboard support** - `Ctrl/Cmd+I` opens and closes the helper from inside the component.
  Escape closes a popup, then stops a reply, then closes the helper.

## Architecture

```
chatAssistantButton({model})        # Entry button and badge. Hosts the popover when narrow
chatAssistantContainer({model, items})
├── __body                          # The component's own content
└── __dock                          # A Hoist Panel with a splitter, 360 to 420 px
    └── chatAssistantView           # The helper: header, thread, boundary line, composer
        └── chatDataBoundaryLine    # What the model can see
```

All three components take the same `ChatAssistantModel`. The model holds the chat and the
helper's state: open or closed, the measured width, and the badge. The container reports the
component's width to the model. The model then decides between `dock` and `popover`.

Hoist's `Panel` has no side slot under its header. Its toolbars span the panel's full width. So
the container lays out the content and the docked helper itself, and goes inside the panel as its
body.

## Configuration Pattern

Create the helper model with the component's model, and mark it `@managed`:

```typescript
import {ChatAssistantModel, gridTools} from '@xh/hoist-chat-kit/assist';

export class PositionsPanelModel extends HoistModel {
    @managed gridModel = new GridModel({...});
    @managed assistantModel = new ChatAssistantModel({
        groups: gridTools(this.gridModel, {title: 'Positions grid'})
    });
}
```

Put the button last in the panel's header, and the container around the panel's content:

```typescript
import {chatAssistantButton, chatAssistantContainer} from '@xh/hoist-chat-kit/desktop/cmp/assist';

panel({
    title: 'Positions',
    headerItems: [refreshButton(), chatAssistantButton({model: assistantModel})],
    item: chatAssistantContainer({
        model: assistantModel,
        items: [toolbar(...), grid({model: gridModel})]
    })
});
```

## Common Usage Patterns

### A helper beside a dashboard widget

A widget is usually narrower than 740 px, so its helper opens in a popover from the button. Only
one popover helper is open on a page. Opening a second closes the first, which keeps its
conversation and any running turn.

### A helper in a dialog

Put the container in the dialog's body. The dialog keeps its size. Create the helper model with
the dialog's model, so that closing the dialog drops the conversation.

### Ask in chat

Wire `onAskInChat` on the model to the app's main chat. The helper then offers an Ask in chat
button for a question about anything other than its component:

```typescript
new ChatAssistantModel({
    groups: gridTools(gridModel),
    onAskInChat: question => this.askInMainChat(question) // The app's own method
});
```

The helper never opens the app's thread itself.

### A label on the button

Pass `labelled: true` to show "Ask" beside the icon, for users who have not seen the helper.

## Properties/API Reference

### ChatAssistantButton

| Prop | Type | Description |
|------|------|-------------|
| `model` | `ChatAssistantModel` | The helper. From context if not given. |
| `labelled` | `boolean` | True to show "Ask" beside the icon. Default false. |
| `assistantIcon` | `ReactElement` | Icon of the button and the helper. Default `ChatKit.defaults.assistantIcon`. |
| `viewProps` | `ChatAssistantViewProps` | Props for the helper, when it opens in a popover. |

### ChatAssistantContainer

| Prop | Type | Description |
|------|------|-------------|
| `model` | `ChatAssistantModel` | The helper. From context if not given. |
| `item` / `items` | `ReactNode` | The component's content under its header. |
| `assistantIcon` | `ReactElement` | Icon of the docked helper. |
| `viewProps` | `ChatAssistantViewProps` | Props for the helper, when it docks. |

### ChatAssistantView

| Prop | Type | Description |
|------|------|-------------|
| `model` | `ChatAssistantModel` | The helper. |
| `assistantIcon` | `ReactElement` | Icon for the header and the replies. |
| `placeholder` | `string` | Placeholder of the composer. Default "Ask about [title], or tell it what to change…". |
| `testId` | `string` | Test id of the message list and composer, with `-messages` and `-composer`. |

### ChatDataBoundaryLine

| Prop | Type | Description |
|------|------|-------------|
| `boundary` | `ChatDataBoundary` | What the model can see. Null shows a warning line and logs an error. |

### Badge

| Badge | When | Button name ends with |
|-------|------|-----------------------|
| `attention` | A turn waits for the user to approve a call | "waiting for you" |
| `error` | The last turn failed while the helper was closed | "last request failed" |
| `busy` | A turn runs | "working" |
| `ready` | A reply came in while the helper was closed | "new reply" |

The badge shows only while the helper is closed, in that order of priority. Opening the helper
clears `ready` and `error`.

### Keyboard

| Key | Where | Does |
|-----|-------|------|
| `Ctrl/Cmd+I` | Focus in the container or the helper | Opens or closes the helper |
| `Escape` | Focus in the helper | Closes a popup, then stops a reply, then closes the helper |
| `/` | Focus in the helper, outside a text field | Focuses the composer |

Opening focuses the composer, or Allow on a turn that waits for approval. Closing returns focus
to where it was, else to the button.

## Extension Points

- **The icon** - set `ChatKit.defaults.assistantIcon`, or pass `assistantIcon`.
- **The shortcut** - remap or drop `ChatKit.defaults.shortcuts.openHelper`.
- **The look** - override the `--xh-chat-helper-*` and `--xh-chat-boundary-*` variables. See
  [Theming](../chat/README.md#theming).

## Common Pitfalls

### The shortcut does nothing from the header

`Ctrl/Cmd+I` works with focus in the container or the helper. The panel's header sits outside
the container. To bind it there too, add the same key to the panel's `hotkeys`.

### A helper model created in render

Create the helper model with the component's model, and mark it `@managed`. A model created in
render starts a new conversation on every render.

## Related Packages

- [`/assist/`](../../../assist/README.md) - `ChatAssistantModel`, tool groups and their helper
  members
- [`/desktop/assist/`](../../../assist/README.md#arrange-a-dashboard) - `dashCanvasTools`
- [`/desktop/cmp/chat/`](../chat/README.md) - the message list, composer and status region the
  helper reuses
- hoist-react `/desktop/cmp/panel/` - `Panel` and `PanelModel`, which size the dock
- hoist-react `/desktop/cmp/dash/` - `DashCanvasModel`, whose widgets often host a popover helper
