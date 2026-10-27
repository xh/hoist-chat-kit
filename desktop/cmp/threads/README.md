# Desktop Thread List

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the thread list does, and the key features |
| [Architecture](#architecture) | `ChatThreadList`, its model, and the row states |
| [Configuration Pattern](#configuration-pattern) | Putting a `ChatThreadsModel` in a sidebar |
| [Common Usage Patterns](#common-usage-patterns) | A collapse button, search focus |
| [Properties/API Reference](#propertiesapi-reference) | Props, model members, and the keyboard |
| [Extension Points](#extension-points) | The theme variables |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | The thread layer, the workspace and Hoist packages |

## Overview

The `/desktop/cmp/threads/` package holds `ChatThreadList`, the desktop list of a user's
threads. It renders the threads of a [`ChatThreadsModel`](../../../threads/README.md). The two
are a pair. The [workspace](../workspace/README.md) shows the list in its sidebar. An app can also
place it on its own.

Import from `@xh/hoist-chat-kit/desktop/cmp/threads`.

Key features:

- **Recency groups** - Today, Yesterday, Previous 7 days, Previous 30 days and Older,
  from `groupThreadsByRecency()`. A search shows one group of results instead.
- **Two row sizes** - by default, each row shows its title over the date and time of its last
  activity, such as "Oct 10, 8:09am" - or the time alone under Today and Yesterday, whose
  headings name the day. Search results, under no day heading, show the date. With `compact`, the title and a short time share one line:
  the time of day for today and yesterday, the weekday within a week, else the date. Both use
  Hoist's date formats.
- **Row actions** - Rename and a More menu show on hover or focus. In a compact row they take the
  time's place. More holds Copy Thread ID and Delete. The list hides each action the store cannot
  take.
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
├── model: ChatThreadsModel          # The threads to list
├── New Chat, topItems               # Top row
├── Search input                     # Bound to model.search
└── Tree grid "Threads"
    └── Group per recency bucket
        └── Row per thread            # Icon, title over time - or in line, if compact - and actions
```

The list takes a `ChatThreadsModel` from the platform-neutral
[`/threads/`](../../../threads/README.md) package. The model loads, edits and routes the threads.
The list renders them, and calls the model for each action.

### Row states

A row shows at most one unusual state, in this order:

| State | Source | Icon | Read after the title |
|---|---|---|---|
| Running | `runningThreadIds` | Spinner, and "Working" in place of the time | "working" |
| Awaiting | `awaitingThreadIds` | Pause | "waiting for you" |
| New reply | `finishedAwayThreadIds`, unless selected and shown | Dot, and a bold title | "new reply" |
| Interrupted | `endedEarlyThreads`, with `runEnd: 'interrupted'` | Warning, with the reason as tooltip | "last reply interrupted" |
| Failed | `endedEarlyThreads`, with `runEnd: 'failed'` | Warning, in the error color | "last reply failed" |

Interrupted and Failed are the two looks of "ended early". The threads model sets them from a
background turn that failed or that the server cut short, and from the store's `lastRunEnd` for a
thread with no open chat. A thread the user has seen since its last activity shows no mark.

A row in no unusual state shows no icon.

The selected row is highlighted, and announced as selected, only while the threads model's
`isSelectionShown` is true: off the thread route, or while the app says its chat is hidden with
`isChatShown`, the row looks like any other, and can show a new reply.

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

The list works the same over a chat that runs on another library. Give the threads model a
`createConversation` function, and show the app's own view where the chat panel would be - see
[Use a conversation of the app's own](../../../threads/README.md#use-a-conversation-of-the-apps-own).

## Common Usage Patterns

### Add a button beside New Chat

```typescript
chatThreadList({
    model: threadsModel,
    topItems: [button({icon: Icon.chevronLeft(), onClick: () => sidebarModel.setCollapsed(true)})]
});
```

### Link rows to a route

Give `getThreadHref` the thread's deep link. Each row's title is then a link, so that a middle or
modifier click opens the thread in a new tab. A plain click still selects it in place.

```typescript
chatThreadList({
    model: threadsModel,
    getThreadHref: thread => XH.router.buildUrl('default.chat.thread', {threadId: thread.id})
});
```

### Focus the search input from elsewhere

Pass `searchInputRef`, as the workspace does from its rail's search button.

## Properties/API Reference

### ChatThreadList props

| Property | Type | Description |
|----------|------|-------------|
| `model` | `ChatThreadsModel` | The threads to list. Default a `ChatThreadsModel` in context. |
| `topItems` | `ReactNode[]` | Items after New Chat. |
| `enableNewChat` | `boolean` | False to hide New Chat, for an app that offers it elsewhere. `ChatWorkspace` hides its rail and header New Chat buttons too, but keeps New Chat on its "Thread not found" message and its keyboard shortcut. Default true. |
| `onThreadClick` | `(thread) => void` | Called on a click or Enter on a row, before the thread is selected. Also for the thread already selected. |
| `getThreadHref` | `(thread) => string` | A link for each row, such as its deep link. A middle or modifier click then opens the thread in a new tab. A plain click selects it. |
| `threadNoun` | `string` | The word for a thread in the list's text, such as 'chat'. The plural adds an s. `ChatWorkspace` uses it too. Default 'thread'. |
| `showTime` | `boolean` | False to hide each row's time. Default true. |
| `groupByRecency` | `boolean` | False for one plain list in the store's order, with no recency groups. Default true. |
| `rowMenuProps` | `MenuButtonProps` | Props for each row's More menu button, such as `menuClassName` or `popoverProps`, to match the app's other menus. |
| `enableCopyId` | `boolean` | False to leave Copy Thread ID out of the More menu. Default true. |
| `enableDeleteRunning` | `boolean` | False to disable Delete for a thread whose turn runs, for a backend that refuses it. The disabled item says why on hover. Default true. |
| `selectNextOnDelete` | `boolean` | False to open a new chat when the open thread is deleted. Default true: the next thread in the list opens. |
| `compact` | `boolean` | True for one line per thread: the title, then a short time. Default false: the title over the date and time. In a workspace, pass it in `threadListProps`. |
| `newChatButtonProps` | `ButtonProps` | Props for the New Chat button, such as `intent`. Default outlined, with `intent: 'primary'`. `ChatWorkspace` applies them, less `text`, to its rail and header New Chat buttons too. |
| `enableSearch` | `boolean` | False to hide the search input. Default true. |
| `searchPlaceholder` | `string` | Placeholder for the search input. Default 'Search threads', with `threadNoun`. |
| `searchInputRef` | `Ref<HTMLInputElement>` | Ref to the search input's element. |

It also takes Hoist's `BoxProps` for layout.

### ChatThreadsModel members the list reads

| Member | Type | Description |
|--------|------|-------------|
| `threads` | `ChatThreadSummary[]` | Threads to list. |
| `shownThreadId` | `string` | The row to show as selected: the selected thread while the user can see it. |
| `selectedThreadId` | `string` | The row that takes keyboard focus on Tab, shown or not. |
| `navigateToSelection()` | method | A click on a row, off the thread route. |
| `newThread()`, `selectThreadAsync()` | methods | New Chat, and a click on a row. |
| `search` | `string` | Text to search for. The search input reads and writes it. |
| `runningThreadIds`, `awaitingThreadIds`, `finishedAwayThreadIds`, `endedEarlyThreads` | | Row states. |
| `listError` | `Error` | The last list failure. |
| `listTask` | `TaskObserver` | Shows the skeleton while the first load is pending. |
| `canRename`, `renameThreadAsync()` | | Rename, if the store can. |
| `canDelete`, `deleteThreadsAsync()` | | Delete, if the store can. |
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

- **Theme variables.** The list reads the `--xh-chat-sidebar-*` variables: the row height, the
  hover and selected backgrounds, and the group label color. See
  [Theming](../chat/README.md#theming).

## Common Pitfalls

### Hiding the list with a class

The list is a Hoist box, which lays itself out with an inline `display: flex`. A class cannot
hide it without `!important`. Pass `display: 'none'` as a prop instead, as for any Hoist box.

```typescript
chatThreadList({model, display: isRailCollapsed ? 'none' : undefined});
```

### Expecting a failed rename to show under its row

A `ChatThreadsModel` rolls back a failed rename or delete with a toast. The list shows the
old title again, and says nothing of its own.

## Related Packages

- [`/threads/`](../../../threads/README.md) - `ChatThreadsModel` and `groupThreadsByRecency()`
- [`/desktop/cmp/workspace/`](../workspace/README.md) - the full-page shell around the list
- [`/desktop/cmp/chat/`](../chat/README.md) - the chat panel and the theme variables
- hoist-react `/desktop/cmp/input/` - `TextInput`, for the search and rename inputs
- hoist-react `/desktop/cmp/menu/` - `MenuButton`, for the More menu
