# Desktop Thread List

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the thread list does, and the key features |
| [Architecture](#architecture) | `ChatThreadList`, its host interface, and the row states |
| [Configuration Pattern](#configuration-pattern) | Putting a `ChatThreadsModel` in a sidebar |
| [Common Usage Patterns](#common-usage-patterns) | A host of your own, a collapse button, search focus |
| [Properties/API Reference](#propertiesapi-reference) | Props, host members, and the keyboard |
| [Extension Points](#extension-points) | The host interface and the theme variables |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | The thread layer, the workspace and Hoist packages |

## Overview

The `/desktop/cmp/threads/` package holds `ChatThreadList`, the desktop list of a user's
threads. It renders the threads of a [`ChatThreadsModel`](../../../threads/README.md), or of any
model that implements `ChatThreadListHost`. The [workspace](../workspace/README.md) shows it in
its sidebar. An app can also place it on its own.

Import from `@xh/hoist-chat-kit/desktop/cmp/threads`.

Key features:

- **Recency groups** - Today, Yesterday, Previous 7 days, Previous 30 days and Older,
  from `groupThreadsByRecency()`. A search shows one group of results instead, each with the
  matching snippet when the host gives one. A host whose search skips message text shows
  "Searching titles".
- **Row actions** - Rename and a More menu replace the time on hover or focus. More holds
  Copy Thread ID and Delete. The list hides each action the host cannot take.
- **Inline rename** - Enter or a blur saves, and Escape keeps the old title.
- **Delete with confirm** - the list always asks first, with focus on Cancel. If the open thread
  goes, the next thread down opens. The workspace's Thread actions menu deletes the same way.
- **Row states** - a spinner and "Working" for a running turn, a pause icon for a turn that
  waits for the user, a dot for a reply the user has not seen, and a warning for a run that
  ended early.
- **List states** - a static skeleton while the first list loads, an empty message, no search
  results, and a failed load with Retry, through Hoist's `ErrorMessage`.
- **Keyboard and screen reader support** - a tree grid named "Threads", one level deep, with
  arrow keys between rows. A grid, not a listbox, because each row holds buttons.

## Architecture

```
ChatThreadList (hoistCmp)
├── model: ChatThreadListHost        # A ChatThreadsModel, or a HoistModel of your own
├── New Chat, topItems               # Top row
├── Search input                     # Bound to host.search
└── Listbox "Threads"
    └── Group per recency bucket
        └── Row per thread            # Icon, title, time or actions
```

`ChatThreadListHost` lives in the platform-neutral [`/threads/`](../../../threads/README.md)
package. `ChatThreadsModel` implements it. The list reads only these members, so it works over
any model that has them. See `threads/ChatThreadListHost.ts`.

### Row states

A row shows at most one unusual state, in this order:

| State | Source | Icon | Read after the title |
|---|---|---|---|
| Running | `runningThreadIds` | Spinner, and "Working" in place of the time | "working" |
| Awaiting | `awaitingThreadIds` | Pause | "waiting for you" |
| New reply | `finishedAwayThreadIds`, unless selected | Dot, and a bold title | "new reply" |
| Interrupted | `lastRunEnd: 'interrupted'` | Warning, with `lastRunReason` as tooltip | "last reply interrupted" |
| Failed | `lastRunEnd: 'failed'` | Warning, in the error color | "last reply failed" |

A row in no unusual state shows no icon.

## Configuration Pattern

Pass a `ChatThreadsModel` as the list's model, in a container of a set width.

```typescript
import {hoistCmp} from '@xh/hoist/core';
import {hframe} from '@xh/hoist/cmp/layout';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {chatPanel} from '@xh/hoist-chat-kit/desktop/cmp/chat';
import {chatThreadList} from '@xh/hoist-chat-kit/desktop/cmp/threads';

export const assistantPage = hoistCmp.factory<AssistantModel>(({model}) => {
    const {threadsModel} = model;
    return hframe(
        panel({
            modelConfig: {side: 'left', defaultSize: 260, minSize: 200, maxSize: 400},
            item: chatThreadList({model: threadsModel})
        }),
        threadsModel.chatModel
            ? chatPanel({key: threadsModel.chatModel.xhId, model: threadsModel.chatModel})
            : null
    );
});
```

Key the chat panel by the chat, so that the pane never shows the last thread's messages. For a
complete page with these parts, use [`chatWorkspace`](../workspace/README.md) instead.

## Common Usage Patterns

### Back the list with your own model

Implement `ChatThreadListHost` on a `HoistModel`. Only `threads`, `selectedThreadId`,
`newThread()` and `selectThreadAsync()` are required. Make the members observable, so that the
list updates as they change.

```typescript
class InboxModel extends HoistModel implements ChatThreadListHost {
    @observableRef accessor threads: ChatThreadSummary[] = [];
    @observable accessor selectedThreadId: string = null;

    newThread() {/* ... */}
    async selectThreadAsync(threadId: string) {/* ... */}
}

chatThreadList({model: inboxModel});
```

Add `search` to show the search input. Add `canRename` with `renameThreadAsync()`, and so on,
to show each action.

### Add a button beside New Chat

```typescript
chatThreadList({
    model: threadsModel,
    topItems: [button({icon: Icon.chevronLeft(), onClick: () => sidebarModel.setCollapsed(true)})]
});
```

### Focus the search input from elsewhere

Pass `searchInputRef`, as the workspace does from its rail's search button.

## Properties/API Reference

### ChatThreadList props

| Property | Type | Description |
|----------|------|-------------|
| `model` | `ChatThreadListHost` | The threads to list. Default a host in context, such as a `ChatThreadsModel`. |
| `topItems` | `ReactNode[]` | Items after New Chat. |
| `enableSearch` | `boolean` | False to hide the search input. Default true, if the host has `search`. |
| `searchPlaceholder` | `string` | Placeholder for the search input. Default 'Search threads'. |
| `searchInputRef` | `Ref<HTMLInputElement>` | Ref to the search input's element. |

It also takes Hoist's `BoxProps` for layout.

### ChatThreadListHost

| Member | Type | Description |
|--------|------|-------------|
| `threads` | `ChatThreadSummary[]` | Threads to list. Required. |
| `selectedThreadId` | `string` | The open thread. Required. |
| `newThread()` | method | Start a thread. Required. |
| `selectThreadAsync()` | method | Open a thread. Required. |
| `search` | `string` | Text to search for. The search input reads and writes it. |
| `searchesMessages` | `boolean` | True if the search covers message text. Without it, the list shows "Searching titles". |
| `runningThreadIds`, `awaitingThreadIds`, `finishedAwayThreadIds` | `string[]` | Row states. |
| `listError` | `Error` | The last list failure. |
| `listTask` | `TaskObserver` | Shows the skeleton while the first load is pending. |
| `canRename`, `renameThreadAsync()` | | Rename. |
| `canDelete`, `deleteThreadsAsync()` | | Delete. |
| `refreshAsync()` | method | Retry after a failed load. |

### Keyboard

| Key | Where | Action |
|-----|-------|--------|
| Up, Down, Home, End | Row | Move between rows |
| Enter, Space | Row | Open the thread |
| F2 | Row | Rename |
| Delete, Backspace | Row | Delete, after a confirm. Backspace is the delete key of a Mac laptop. |
| Right, Left | Row and its buttons | Step through the row's buttons and back |
| Enter, Escape | Rename input | Save, or keep the old title |
| Escape | Search input | Clear the search |

App-wide shortcuts, such as New Chat, belong to the kit's keyboard map (D66). The list does not
bind them.

## Extension Points

- **The host.** Any `HoistModel` that implements `ChatThreadListHost` backs the list.
- **Theme variables.** The list reads the `--xh-chat-sidebar-*` variables: the row height, the
  hover and selected backgrounds, and the group label color. See
  [Theming](../chat/README.md#theming).

## Common Pitfalls

### Passing a host that is not a HoistModel

The list resolves its model as Hoist components do, so the host must be a `HoistModel`. A plain
object fails the model lookup.

### Expecting a failed rename to show under its row

A `ChatThreadsModel` rolls back a failed rename or delete with a toast. The list shows the
old title again, and says nothing of its own.

## Related Packages

- [`/threads/`](../../../threads/README.md) - `ChatThreadsModel`, `ChatThreadListHost` and
  `groupThreadsByRecency()`
- [`/desktop/cmp/workspace/`](../workspace/README.md) - the full-page shell around the list
- [`/desktop/cmp/chat/`](../chat/README.md) - the chat panel and the theme variables
- hoist-react `/desktop/cmp/input/` - `TextInput`, for the search and rename inputs
- hoist-react `/desktop/cmp/menu/` - `MenuButton`, for the More menu
