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
  wide, resizable from 200 to 400 px, and collapsible to a 40 px rail.
- **A rail** - expand, New Chat, search, and a spinner while any thread works.
- **The conversation** - a `ChatPanel` for the selected thread's chat. It clears the moment the
  selection changes, masks while history loads, and shows a failed load with Retry.
- **Slots** - a header with the thread's title and actions by default, a notice line, and a side
  panel that the app fills.
- **Layout by width** - the sidebar narrows to its rail and then hides, the side panel shows only
  where there is room, and the chat turns compact at 380 px or less.
- **Persistence** - the sidebar's width and collapsed state, and the side panel's width, persist
  per user through `persistWith`.

## Architecture

```
ChatWorkspaceModel (HoistModel)
├── threadsModel: ChatThreadsModel   # The threads, given by the app
├── sidebarModel: PanelModel          # Width and collapsed state, persisted
├── sidePanelModel: PanelModel        # Width, persisted
├── width: number                     # The workspace's measured width (observable)
├── isSidePanelOpen: boolean          # The app's wish (bindable)
├── Computed:
│   ├── sidebarMode                   # 'open', 'rail' or 'hidden'
│   ├── isSidePanelShown              # Open, and the workspace has room
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
└── Side panel: complementary > Panel
```

### Layout by width

The workspace measures its own element with a `ResizeObserver`, debounced 100 ms, and picks the
layout from its width:

| Workspace width | Sidebar | Side panel |
|---|---|---|
| 1,280 px and up | Open | Beside the conversation |
| 1,000 to 1,279 px | Open, or the rail while the side panel is open | Beside the conversation |
| 788 to 999 px | The rail, unless the user expands it | Beside the conversation |
| Under 788 px | Hidden. The header offers the list in a popover | Not shown |

The layout never changes the user's saved state. A collapse the user makes holds at every width
that shows a sidebar. An expand the user makes from the rail holds until the width crosses into
another row of the table. Under 1,000 px, that expand closes the side panel first.

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
a new thread, so that the conversation pane always holds a chat.

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

### Configure the chat and the list

`chatPanelProps` go to the conversation's `ChatPanel`, for example `suggestions` or
`composerProps`. `threadListProps` go to the sidebar's `ChatThreadList`.

## Properties/API Reference

### ChatWorkspaceConfig

| Property | Type | Description |
|----------|------|-------------|
| `threadsModel` | `ChatThreadsModel` | The threads to show. Required. |
| `persistWith` | `PersistOptions` | Persists the panel widths and the sidebar's collapsed state. The workspace adds `.sidebar` and `.sidePanel` to `path`, which defaults to 'chatWorkspace'. |
| `sidePanelOpen` | `boolean` | True to open the side panel at the start. Default false. |

### ChatWorkspaceModel

| Member | Type | Description |
|--------|------|-------------|
| `threadsModel` | `ChatThreadsModel` | The threads. |
| `sidebarModel`, `sidePanelModel` | `PanelModel` | The two panels. |
| `width` | `number` | Measured width, or null before render. |
| `sidebarMode` | `'open' \| 'rail' \| 'hidden'` | How the sidebar shows. |
| `isSidePanelOpen` | `boolean` | True if the app wants the side panel open. Bindable. |
| `isSidePanelShown` | `boolean` | True if the side panel shows. |
| `isCompact` | `boolean` | True at 380 px or less. |
| `expandSidebar()`, `collapseSidebar()`, `toggleSidebar()` | methods | Change the sidebar. |
| `openSidePanel()`, `closeSidePanel()`, `toggleSidePanel()` | methods | Change the side panel. |

### ChatWorkspace props

| Property | Type | Description |
|----------|------|-------------|
| `header` | `ReactNode` | Replaces the default header. Null hides it. |
| `headerItems` | `ReactNode[]` | Items for the default header, before its own actions. |
| `notice` | `ReactNode` | One line under the header. A string notice also shows as its tooltip. |
| `sidePanel` | `ReactNode \| () => ReactNode` | Content for the side panel. |
| `sidePanelProps` | `PanelProps` | Props for the side panel's `Panel`, such as `title`. |
| `chatPanelProps` | `ChatPanelProps` | Props for the conversation's `ChatPanel`. |
| `threadListProps` | `ChatThreadListProps` | Props for the sidebar's `ChatThreadList`. |

### Landmarks

The sidebar and the rail are a `navigation` landmark named "Threads". The conversation column is
`main`, and the side panel is `complementary`, named by its title.

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
