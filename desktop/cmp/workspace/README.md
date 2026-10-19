# Desktop Workspace

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the workspace does, and the key features |
| [Architecture](#architecture) | `ChatWorkspaceModel`, its panels, and the layout by width |
| [Configuration Pattern](#configuration-pattern) | Creating a workspace over a `ChatThreadsModel` |
| [Common Usage Patterns](#common-usage-patterns) | Header, notice, side panel and chat options |
| [Properties/API Reference](#propertiesapi-reference) | Config, model state and methods, and props |
| [Extension Points](#extension-points) | Slots and theme variables |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | The thread layer, the thread list and Hoist packages |

## Overview

The `/desktop/cmp/workspace/` package holds `ChatWorkspace`, a full-page chat. It lays out a
thread sidebar, the selected thread's conversation, a header and a notice line above it, and an
optional side panel. It fills its parent and sizes itself by its own width, never the
viewport's. The app keeps its own AppBar, navigation and user menu.

Import from `@xh/hoist-chat-kit/desktop/cmp/workspace`.

Key features:

- **A thread sidebar** - a Hoist `Panel` with the [thread list](../threads/README.md), 260 px
  wide by default, resizable from 200 to 400 px, and collapsible to a 40 px rail.
- **A rail** - expand, New Chat, search, and a spinner while any thread works.
- **The conversation** - a `ChatPanel` for the selected thread's chat. It clears the moment the
  selection changes, masks while history loads, and shows a failed load with Retry. A thread the
  store reports missing shows "Thread not found" with New Chat.
- **Slots** - a header with the thread's title and actions by default, a notice line, and a side
  panel that the app fills.
- **Documents beside the chat** - with a `documentRenderer`, a cited document opens in the side
  panel, in the app's own viewer.
- **Layout by width** - the sidebar turns to its rail and then hides, the side panel shows only
  where there is room, each panel keeps one saved width, cut so the conversation stays readable,
  and the chat turns compact at 380 px or less.
- **Persistence** - the sidebar's width and collapsed state, and the side panel's width, persist
  per user through `persistWith`.
- **Keyboard** - Ctrl/Cmd+Shift+O starts a new chat, `/` focuses the composer, and F6 moves
  between regions. Escape in the side panel closes it. See
  [Keyboard](../chat/README.md#keyboard).

## Architecture

```
ChatWorkspaceModel (HoistModel)
├── threadsModel: ChatThreadsModel   # The threads, given by the app
├── sidebarModel: PanelModel          # Width and collapsed state, persisted
├── sidePanelModel: PanelModel        # Width, persisted
├── sidePanel: ChatSidePanelModel     # The open request, such as a cited document
├── width: number                     # The workspace's measured width (observable)
├── isSidePanelOpen: boolean          # The app's wish (bindable)
├── Computed:
│   ├── sidebarMode                   # 'open', 'rail' or 'hidden'
│   ├── sidebarWidth, sidePanelWidth  # The widths that show, cut for the conversation
│   ├── isSidePanelShown              # Open or a request open, and the workspace has room
│   └── isCompact                     # 380 px or less
└── Methods:
    ├── expandSidebar() / collapseSidebar() / toggleSidebar()
    └── openSidePanel() / closeSidePanel() / toggleSidePanel()

ChatWorkspace (hoistCmp)
├── Sidebar: Panel > nav "Threads" > ChatThreadList, or the rail
├── main
│   ├── Header slot                   # Title and thread actions by default
│   ├── Notice slot
│   └── ChatPanel                     # The selected thread's chat
└── Side panel: ChatSidePanel for a request, else complementary > Panel
```

### Layout by width

The workspace measures its own element as it mounts, before the first paint, and then with a
`ResizeObserver`. The observer applies a change at once, and the last of a burst again after
100 ms. The workspace picks the layout from its width:

| Workspace width | Sidebar | Side panel | Conversation |
|---|---|---|---|
| 1,280 px and up | Open | Shown | At least 480 px |
| 1,000 to 1,279 px | Open. The rail while the side panel shows | Shown | At least 480 px |
| 788 to 999 px | The rail, unless the user expands it | Shown | At least 380 px |
| Under 788 px | Hidden. The header offers the list in a popover | Not shown. A document opens in a new tab | All of it |

Each panel has one width: 260 px for the sidebar and 520 px for the side panel, until the user
drags it. `PanelModel` saves the width the user drags to. It applies at every workspace width,
and to every kind of side panel content.

Each panel shows at that width, cut where needed so that the conversation keeps its minimum. The
sidebar is cut first, against the conversation alone. Then the side panel takes what is left,
below its 400 px drag minimum if it must. The model's `sidebarWidth` and `sidePanelWidth` give
the widths that show.

The layout never changes the user's saved state. A collapse the user makes holds at every width
that shows a sidebar. An expand the user makes from the rail holds until the width crosses into
another row of the table, or the side panel opens. Under 1,280 px, that expand closes the side
panel first.

## Configuration Pattern

Create the workspace model over a `ChatThreadsModel`, and load it.

```typescript
import {HoistModel, managed} from '@xh/hoist/core';
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {ChatThreadsModel} from '@xh/hoist-chat-kit/threads';
import {ChatWorkspaceModel} from '@xh/hoist-chat-kit/desktop/cmp/workspace';

export class AssistantModel extends HoistModel {
    @managed threadsModel = new ChatThreadsModel({
        store: new AssistantThreadStore(),
        createChatModel: ({threadId}) => new ChatModel({threadId, transport})
    });

    @managed workspaceModel = new ChatWorkspaceModel({
        threadsModel: this.threadsModel,
        persistWith: {localStorageKey: 'assistant'}
    });

    override async doLoadAsync(loadSpec) {
        await this.workspaceModel.loadAsync(loadSpec);
    }
}
```

Render it in a box that has a size. It fills its parent.

```typescript
chatWorkspace({model: model.workspaceModel});
```

The workspace model loads the thread list. If nothing is selected when it is created, it starts
a new thread, so that the conversation pane always holds a chat. A reload therefore opens a new
chat. The most recently active thread leads the list, one click away. A deep link through the
threads model's `route` opens its thread instead. If the store reports that thread missing, the
conversation pane shows "Thread not found", with New Chat in place of the composer. While a
thread's history loads, the pane shows only the loading mask, not a new chat's empty state.

## Common Usage Patterns

### Add a notice and header actions

```typescript
chatWorkspace({
    model: workspaceModel,
    notice: 'This assistant sees loan data as of 06:00.',
    headerItems: [button({icon: Icon.link(), tooltip: 'Copy link', onClick: copyLink})]
});
```

The notice is one line of context, not an alert. Use a Hoist `Banner` for alerts. Pass `header`
to replace the default header, or `header: null` to hide it.

### Fill the side panel

Pass the content as `sidePanel`, and open it from the model.

```typescript
chatWorkspace({
    model: workspaceModel,
    sidePanel: () => sourceViewer({model: viewerModel}),
    sidePanelProps: {title: 'Sources', icon: Icon.fileText()}
});

workspaceModel.openSidePanel();
```

The panel has a close button, its own splitter, and a persisted width from 400 to 900 px. Its
content renders only while the panel shows.

### Open cited documents in the side panel

Give the model a `documentRenderer`, the app's document viewer. A click on a document's citation
or source row then opens it in the side panel, at the cited passage. The kit draws the panel's
title, Back to the citation, Close and the viewer's status. The viewer reports its progress with
`setDocumentStatus()`. See [the side panel](../../../core/README.md#side-panel).

```typescript
new ChatWorkspaceModel({
    threadsModel,
    documentRenderer: (request, panel) =>
        documentViewer({
            documentId: request.source.metadata.documentId,
            passage: request.passage,
            onStatus: status => panel.setDocumentStatus(status)
        })
});
```

A request shows in place of the app's own `sidePanel` content, which returns when it closes. A
request closes when the selected thread changes. Under 788 px there is no room for the panel, so a
document opens at its URL in a new tab, with a toast.

### Configure the chat and the list

`chatPanelProps` go to the conversation's `ChatPanel`, for example `suggestions` or
`composerProps`. `threadListProps` go to the sidebar's `ChatThreadList`.

## Properties/API Reference

### ChatWorkspaceConfig

| Property | Type | Description |
|----------|------|-------------|
| `threadsModel` | `ChatThreadsModel` | The threads to show. Required. |
| `persistWith` | `PersistOptions` | Persists the panel widths and the sidebar's collapsed state. The workspace adds `.sidebar` and `.sidePanel` to `path`, which defaults to 'chatWorkspace'. |
| `sidePanelOpen` | `boolean` | True to open the side panel at the start, for the app's own content. Default false. |
| `documentRenderer` | `(request, panel) => ReactNode` | The app's document viewer. With it, a cited document opens in the side panel. |

### ChatWorkspaceModel

| Member | Type | Description |
|--------|------|-------------|
| `threadsModel` | `ChatThreadsModel` | The threads. |
| `sidebarModel`, `sidePanelModel` | `PanelModel` | The two panels. |
| `sidePanel` | `ChatSidePanelModel` | The side panel's open request. Components in the conversation find it in model context. |
| `width` | `number` | Measured width, or null before render. |
| `sidebarMode` | `'open' \| 'rail' \| 'hidden'` | How the sidebar shows. |
| `sidebarWidth` | `number` | Width of the open sidebar, or null when it is not open. Its saved width, cut for the conversation. |
| `sidePanelWidth` | `number` | Width of the side panel, or null when it does not show. Its saved width, cut for the conversation. |
| `isSidePanelOpen` | `boolean` | True if the app wants the side panel open. Bindable. |
| `isSidePanelShown` | `boolean` | True if the side panel shows: a request or the app's content, with room. |
| `isCompact` | `boolean` | True at 380 px or less. |
| `expandSidebar()`, `collapseSidebar()`, `toggleSidebar()` | methods | Change the sidebar. |
| `openSidePanel()`, `closeSidePanel()`, `toggleSidePanel()` | methods | Change the side panel. Close also closes an open request. |

### ChatWorkspace props

| Property | Type | Description |
|----------|------|-------------|
| `header` | `ReactNode` | Replaces the default header. Null hides it. |
| `headerItems` | `ReactNode[]` | Items for the default header, before its own actions. |
| `notice` | `ReactNode` | One line under the header. A string notice also shows as its tooltip. |
| `sidePanel` | `ReactNode \| () => ReactNode` | Content for the side panel. |
| `sidePanelProps` | `PanelProps` | Props for the side panel's `Panel` around the app's own content, such as `title`. Its header is compact by default. |
| `requestPanelProps` | `PanelProps` | Props for the `Panel` of a request open in the side panel - a document, a table or a chart - as `ChatSidePanel`'s `panelProps`. Its header is compact by default. Pass `compactHeader: false` for a full one. |
| `chatPanelProps` | `ChatPanelProps` | Props for the conversation's `ChatPanel`. |
| `threadListProps` | `ChatThreadListProps` | Props for the sidebar's `ChatThreadList`. |

### Landmarks

The sidebar and the rail are a `navigation` landmark named "Threads". The conversation column is
`main`, and the side panel is `complementary`, named by its title. F6 and Shift+F6 move focus
through the thread list, the conversation, the composer and the side panel. New Chat, by button
or shortcut, focuses the new chat's composer.

## Extension Points

- **Slots.** The header, the notice and the side panel take app content.
- **Theme variables.** The workspace reads the `--xh-chat-sidebar-*` variables, and
  `--xh-chat-column-max-width` caps the conversation. See [Theming](../chat/README.md#theming).

## Common Pitfalls

### Rendering the workspace in a box with no height

The workspace is 100% of its parent's width and height. In a parent with no height, it renders
with none. Give it a `Panel`, a `frame` or another box that flexes.

### Holding the workspace's chat

`threadsModel.chatModel` changes with the selection, and the threads model destroys chats it
closes. Read it when you need it, rather than keep a reference.

## Related Packages

- [`/threads/`](../../../threads/README.md) - `ChatThreadsModel` and the store adapter
- [`/desktop/cmp/threads/`](../threads/README.md) - the thread list in the sidebar
- [`/desktop/cmp/chat/`](../chat/README.md) - `ChatPanel` and the theme variables
- hoist-react `/desktop/cmp/panel/` - `Panel` and `PanelModel`, for the sidebar and side panel
- hoist-react `/core/` - `persistWith` and `PersistOptions`
