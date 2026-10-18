# Threads Package

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the thread layer does, and the key features |
| [Architecture](#architecture) | `ChatThreadsModel`, `ChatThreadStore`, open chats, and the concurrency rules |
| [Configuration Pattern](#configuration-pattern) | Implementing a store and creating a `ChatThreadsModel` |
| [Common Usage Patterns](#common-usage-patterns) | Selecting, background turns, search, edits, deep links, grouping |
| [Properties/API Reference](#propertiesapi-reference) | Config, state, methods, and the store contract |
| [Extension Points](#extension-points) | Stores, chat creation, and the chat seams the layer uses |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Core models, transports, and Hoist packages |

## Overview

The `/threads/` package holds the thread layer: the models for a user's list of conversations
that a backend stores. An app implements a `ChatThreadStore` against its backend, and a
`ChatThreadsModel` does the rest. It lists the threads, opens a `ChatModel` for the selected
one, and keeps every async result where it belongs. The package is platform-neutral and has no
UI. The desktop [thread list](../desktop/cmp/threads/README.md) and
[workspace](../desktop/cmp/workspace/README.md) build on it.

Import from `@xh/hoist-chat-kit/threads`.

Key features:

- **A store adapter** - two required methods, to list threads and to load a thread's history.
  Rename, delete and feedback are optional. The model hides each action the store
  lacks.
- **One chat per open thread** - the selected thread's chat, and any other chat with a turn
  running. A turn runs on in the background when the user switches threads, and the list shows
  its thread as running.
- **Both kinds of thread id** - ids the browser mints, with the backend creating the thread on
  its first run, and ids the backend mints and reports on `RUN_STARTED`.
- **Server-side search** - debounced, through the store's query.
- **Edits that show at once** - rename and delete apply before the store answers, and roll
  back with a toast if it fails.
- **Deep links** - the selected thread and a route parameter stay in sync both ways.
- **Recency groups** - `groupThreadsByRecency()` sorts threads into Today, Yesterday and older
  groups for a list UI.

## Architecture

```
ChatThreadsModel (HoistModel)
├── store: ChatThreadStore            # Adapter to the app's backend
├── threads: ChatThreadSummary[]      # The list, with pending edits laid over it (computed)
├── selectedThreadId: string          # Null before the first selection (observable)
├── search: string                    # Text to search for - reloads the list (bindable)
├── listError: Error                  # Error from the last list load, or null (observable)
├── listTask, loadTask: TaskObserver
├── Computed:
│   ├── chatModel                     # The selected thread's ChatModel
│   ├── selectedSummary               # The selected thread's summary
│   ├── runningThreadIds              # Threads with a turn running, here or on the server
│   ├── awaitingThreadIds             # Threads whose turn waits for the user
│   ├── finishedAwayThreadIds         # Threads whose turn ended while not selected
│   ├── endedEarlyThreads             # Threads whose last run failed or was cut short
│   ├── loadError                     # Why the selected thread's history failed, or null
│   ├── isThreadNotFound              # True if the selected thread is missing
│   └── canRename / canDelete
└── Methods:
    ├── loadAsync() / refreshAsync()  # Load or reload the list
    ├── newThread()                   # Start a thread, and select it
    ├── selectThreadAsync()           # Open a thread and load its history
    ├── reloadThreadAsync()           # Load the selected thread's history again
    ├── renameThreadAsync()           # Rename, at once, with rollback
    └── deleteThreadsAsync()          # Delete, at once, with rollback

ChatThreadStore (implemented by the app)
├── listThreadsAsync(query)           # Required
├── loadMessagesAsync(query)          # Required
└── renameThreadAsync?, deleteThreadsAsync?, submitFeedbackAsync?
```

### Open chats

The threads model holds a `ChatModel` for each open thread. It keeps a chat while the chat is
selected, busy, or paused for the user, and destroys it otherwise. A turn therefore keeps running
after the user switches away, and a turn that waits for an approval keeps its question. When the
turn ends, the model closes the chat and reloads the list, because the backend may have titled the
thread. The model keeps a closed thread's draft and run options, and gives them back when the thread
opens again.

The app builds each chat with `createChatModel`. The threads model then wires three seams on
it:

- `setFeedbackSubmitter()`, with the store's `submitFeedbackAsync`, unless the chat has its own
  `feedback.submitAsync`.
- `addSendBlocker()`, which holds back sends while the history loads or after it fails.
- `setStatusRefresher()`, which reloads the thread's history for Refresh Status.

### Thread ids

A new thread starts with an id the browser mints. It can change once, on its first turn. In
server mode, the first `RUN_STARTED` can report the backend's id, and the chat adopts it. A
backend that mints its own ids creates the thread on that first request - see
[Server-owned conversations](../transport/README.md#server-owned-conversations).

The threads model then re-keys the thread: its chat, its summary, any pending edit, the
selection and the route parameter. The composer moves the thread's draft. A chat that changes
its id while idle, after `clear()` or `loadMessages()`, holds a new thread. The old thread stays
in the list.

### Concurrency rules

The model applies each async result only where it still belongs. These rules are the model's
spec, and each has a unit test.

| # | Rule | How the model keeps it |
|---|------|------------------------|
| 1 | A list applies only if no newer list has. Pending renames and deletes lay over it by id. | Each list request takes a number. A response applies only if its number beats the last applied one and its search is still current. An edit stays laid over the list until a list requested after the store call ended applies, so a list already in flight cannot undo it. |
| 2 | A history load for thread B is discarded if the user has since selected C. Its failure is logged, never shown in C. | Each load takes a key from its open thread. Leaving B closes its chat, so the key no longer matches, and the result or the error goes nowhere. |
| 3 | A new thread opened during a load never shows the old thread's messages. | A new thread gets a new chat. A load writes only to the chat that asked for it. |
| 4 | Events from a run apply only to that run's chat. | The threads model never routes events. Each chat guards its own turn. |
| 5 | Run options and drafts never leak into another thread. | Each thread has its own chat. A closed thread's draft is kept under its id. |
| 6 | A 404 is a missing thread, and an empty page an empty one. Any other failure blocks sends on that thread only, with an error and a reload. | The thread's load state feeds `isThreadNotFound`, its own send blocker and `loadError`. |
| 7 | A turn that ends with no content is an error. | `ChatModel` fails a run that finishes with an empty reply, with code `empty-response`. |

## Configuration Pattern

Implement the store against your backend. Map the backend's records to `ChatThreadSummary` and
`ChatMessageSpec`. Report a missing thread with an error that has `httpStatus` 404, as Hoist's
`FetchService` throws for a 404. Return an empty page for a thread with no messages yet.

```typescript
import {XH} from '@xh/hoist/core';
import type {ChatThreadStore} from '@xh/hoist-chat-kit/threads';

export class AssistantThreadStore implements ChatThreadStore {
    async listThreadsAsync({search}) {
        const chats = await XH.fetchJson({url: 'assistant/chats', params: {search, limit: 100}});
        return {
            threads: chats.map(it => ({
                id: it.sessionId,
                title: it.title,
                lastActivityAt: it.lastActivityAt * 1000
            }))
        };
    }

    async loadMessagesAsync({threadId}) {
        const messages = await XH.fetchJson({url: `assistant/chats/${threadId}/messages`});
        return {messages: messages.flatMap(toMessageSpecs)};
    }

    async renameThreadAsync(threadId: string, title: string) {
        await XH.fetchService.patchJson({url: `assistant/chats/${threadId}`, body: {title}});
    }

    async deleteThreadsAsync(threadIds: string[]) {
        await Promise.all(
            threadIds.map(id => XH.fetchService.deleteJson({url: `assistant/chats/${id}`}))
        );
    }
}
```

Create the threads model with the store and a `createChatModel` function. Pass `threadId` to
each `ChatModel`.

```typescript
import {HoistModel, managed} from '@xh/hoist/core';
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {SseChatTransport} from '@xh/hoist-chat-kit/transport';
import {ChatThreadsModel} from '@xh/hoist-chat-kit/threads';

export class AssistantModel extends HoistModel {
    @managed threadsModel = new ChatThreadsModel({
        store: new AssistantThreadStore(),
        createChatModel: ({threadId}) =>
            new ChatModel({
                threadId,
                historyMode: 'server',
                transport: new SseChatTransport({url: 'assistant/query'})
            }),
        route: {name: 'default.assistant', param: 'threadId'}
    });

    override async doLoadAsync(loadSpec) {
        await this.threadsModel.loadAsync(loadSpec);
    }
}
```

A `ChatThreadsModel` that a component creates, with `creates()` or `useLocalModel()`, loads its
list when the component mounts, as any Hoist model with `doLoadAsync()` does.

For a backend that cannot re-run a thread from an edited message, or replace a reply, pass
`allowEdit: false` or `allowRegenerate: false` to each `ChatModel` in `createChatModel` - see
[`/core/`](../core/README.md#hide-edit-and-regenerate).

## Common Usage Patterns

### Select a thread, or start one

```typescript
await threadsModel.selectThreadAsync(threadId);   // Opens the chat and loads its history
const chatModel = threadsModel.newThread();       // A new, empty thread, selected

// Start from a suggestion, with the user's current picks
threadsModel.newThread({draft: 'Summarize the guidelines', runOptions: {documentIds}});
```

Render `threadsModel.chatModel` with a chat panel. It changes with the selection, so bind the
panel to it in a component that observes the threads model.

### Let turns run in the background

Turns run in the background, in as many threads at once as the user starts. The list shows a
running indicator for each id in `runningThreadIds`. That includes a thread whose summary has
`isRunning` from the store, such as a turn that a closed chat left running on the server.

A background turn that pauses for an approval, or for the answer to an interactive tool, waits
for the user. Its chat stays open, and its id is in `awaitingThreadIds`. Show it in the list, so
the user knows the thread needs them.

A turn that ends while another thread is selected puts its thread in `finishedAwayThreadIds`.
The thread leaves it when the user selects it, so a list can mark the reply as new until then.

A background turn that fails, or that the server interrupts or cancels, goes in
`endedEarlyThreads` instead, with its error as the reason. The mark holds until the user opens
the thread, or a new turn starts in it. For a thread with no open chat, the store's `lastRunEnd`
and `lastRunReason` fill the same map. A list marks each such row as ended early.

### Cap the list and the history

The threads model does not page. It shows the threads that `listThreadsAsync` returns, and the
messages that `loadMessagesAsync` returns. A store over a large backend caps each, as the
example above caps the list at the 100 most recent threads.

A store whose backend returns history a page at a time can set `nextCursor` on the page now. The
kit does not read it yet. It leaves room to page in older messages later.

### Search

Bind a text input to `search`. The list reloads 300ms after the text stops changing, with the
trimmed text as `query.search`. A response for an older search is dropped. While a search is
active, the list shows only what the store returned for it.

```typescript
textInput({bind: 'search', model: threadsModel, placeholder: 'Search conversations'});
```

### Rename and delete

```typescript
await threadsModel.renameThreadAsync(threadId, 'Q3 budget');
await threadsModel.deleteThreadsAsync([threadId, otherThreadId]);
```

Each change shows at once. If the store fails, the change rolls back and a toast says so. A
delete closes the threads' chats, and stops any turn running in one. It also removes their
drafts, in memory and in local storage, through `ChatKit.clearLocalData(threadIds)`. If it
deletes the selected thread, the model selects a new one. Check `canRename` and `canDelete` before you show each
action. A call the store cannot make throws.

### Recover from a failed load

If a thread's history fails to load, `loadError` holds the error, and the thread blocks sends
with "The conversation did not load. Reload it to continue." Other threads are not affected.
Show the error with a button that calls `reloadThreadAsync()`. The same method catches up on a
turn that the backend finished on its own.

### Link to a thread

Set `route` to a route with a parameter for the thread id. An optional query parameter suits
it, because a new thread has no id in the URL until it is selected.

```typescript
// AppModel.getRoutes()
{name: 'default', path: '/app', children: [{name: 'assistant', path: '/assistant?threadId'}]}

// ChatThreadsConfig
route: {name: 'default.assistant', param: 'threadId'}
```

A deep link selects its thread. A selection replaces the parameter, with no new history entry.
On the route with no parameter, the model writes the current selection into it. The model
ignores other routes.

A new thread stays out of the route until the backend has it: until its first reply starts to
stream, its first turn ends, or the store lists it. The route stays on its base path until then,
so a reload or a bookmark before the first send opens a new chat. A thread that adopts the
backend's id goes into the route under that id.

A deep link to a thread that the store reports missing, with a 404, sets `isThreadNotFound`. The
workspace then shows "Thread not found" with New Chat, in place of an empty chat. An app with its
own layout reads the flag the same way.

### Group the list by recency

```typescript
import {groupThreadsByRecency} from '@xh/hoist-chat-kit/threads';

const groups = groupThreadsByRecency(threadsModel.threads);
// [{key: 'today', label: 'Today', threads}, {key: 'yesterday', label: 'Yesterday', threads}, ...]
```

Threads group by the calendar day of `lastActivityAt` in the browser's time zone: Today,
Yesterday, Previous 7 days, Previous 30 days and Older. Each group is sorted most recent first,
and empty groups are left out.

## Properties/API Reference

### ChatThreadsConfig

| Property | Type | Description |
|----------|------|-------------|
| `store` | `ChatThreadStore` | Adapter to the backend. Required. |
| `createChatModel` | `({threadId, isNew}) => ChatModel` | Builds the chat for a thread. Must pass `threadId` to the `ChatModel`. `isNew` is false for a thread whose history is about to load. A new thread may start with a greeting in `initialMessages`. Required. |
| `route` | `{name, param}` | Route whose parameter holds the selected thread id. Default none. |

### ChatThreadsModel state

| Property | Type | Description |
|----------|------|-------------|
| `threads` | `ChatThreadSummary[]` | The list, in the store's order. Threads started here that the store has not listed come first, unless a search is active. Pending edits show at once. |
| `selectedThreadId` | `string` | The selected thread, or null. Observable. Change it with `selectThreadAsync()` or `newThread()`. |
| `chatModel` | `ChatModel` | The selected thread's chat, or null. |
| `selectedSummary` | `ChatThreadSummary` | The selected thread's summary, or null if it is not in the list. |
| `search` | `string` | Text to search for. Bindable. |
| `runningThreadIds` | `string[]` | Threads with a turn running here, or reported running by the store. |
| `awaitingThreadIds` | `string[]` | Threads whose turn is paused for the user. Their chats stay open. |
| `finishedAwayThreadIds` | `string[]` | Threads whose turn ended while another thread was selected. A thread leaves it when selected. Held for the session only. |
| `endedEarlyThreads` | `Record<string, ChatThreadEndedEarly>` | Threads whose last run ended early, by id, each with `runEnd` (`'interrupted'` or `'failed'`) and a `reason`. From background turns in this session, and the store's `lastRunEnd` for threads with no open chat. |
| `loadError` | `Error` | Why the selected thread's history failed to load, or null. |
| `isThreadNotFound` | `boolean` | True if the store reported the selected thread missing, with a 404. |
| `listError` | `Error` | Error from the last list load, or null. The list keeps its threads. |
| `listTask` | `TaskObserver` | Pending while the list loads. |
| `loadTask` | `TaskObserver` | Pending while the selected thread's history loads. |
| `canRename`, `canDelete` | `boolean` | True if the store has the method. |

### ChatThreadsModel methods

| Method | Description |
|--------|-------------|
| `loadAsync()`, `refreshAsync()` | Load the threads for the current search. |
| `newThread(seed?)` | Open a new thread and select it. `seed` holds a `draft` and `runOptions`. Returns its chat. |
| `selectThreadAsync(threadId)` | Select a thread, opening its chat and loading its history if needed. |
| `reloadThreadAsync()` | Load the selected thread's history again. Ignored while its turn runs. |
| `renameThreadAsync(threadId, title)` | Rename at once. Rolls back with a toast on failure. |
| `deleteThreadsAsync(threadIds)` | Delete at once, closing the chats. Rolls back with a toast on failure. |

### ChatThreadStore

| Method | Description |
|--------|-------------|
| `listThreadsAsync({search})` | Required. A `ChatThreadPage`: threads most recently active first. The store decides how many. |
| `loadMessagesAsync({threadId})` | Required. A `ChatMessagePage`: the thread's messages, oldest first. Its optional `nextCursor` is not yet read by the kit. |
| `renameThreadAsync(threadId, title)` | Rename a thread. |
| `deleteThreadsAsync(threadIds)` | Delete threads. Deleting a missing thread succeeds. |
| `submitFeedbackAsync(spec)` | Save a rating. See `ChatFeedbackSpec` in [`/core/`](../core/README.md#rate-a-reply). |

### ChatThreadSummary

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | The thread's id. |
| `title` | `string` | Title to show. |
| `lastActivityAt` | `number` | Epoch millis of the last change. Drives sorting and recency groups. |
| `createdAt` | `number` | Epoch millis of creation. Optional. |
| `isRunning` | `boolean` | True if the backend reports a run in progress. Optional. |
| `lastRunEnd` | `'complete' \| 'interrupted' \| 'failed'` | How the last run ended, if the backend reports it. Feeds `endedEarlyThreads` for a thread with no open chat. Optional. |
| `lastRunReason` | `string` | Why the last run ended so, for a tooltip. Optional. |
| `metadata` | `PlainObject` | App data. Optional. |

## Extension Points

- **Stores** - implement `ChatThreadStore` for any backend. The model needs only the two list and
  load methods.
- **Chat creation** - `createChatModel` configures each chat as usual: transport, tools,
  renderers, `feedback`, `track` and a `sendBlocker` of the app's own.
- **Chat seams** - `ChatModel.addSendBlocker()`, `setFeedbackSubmitter()` and
  `setStatusRefresher()` are public. A custom thread layer can use them too. See
  [`/core/`](../core/README.md).

## Common Pitfalls

### Ignoring the thread id in `createChatModel`

The model checks that each chat takes the id it passes, and throws if not.

```typescript
// ✅ Do
createChatModel: ({threadId}) => new ChatModel({threadId, transport})

// ❌ Don't: The chat mints its own id, which the threads model cannot track
createChatModel: () => new ChatModel({transport})
```

### Holding on to a chat

A chat closes when it is neither selected nor busy, and a closed chat is destroyed. Read
`threadsModel.chatModel` when you need it, rather than keep a reference.

### Reporting a missing thread as an error

The model marks a thread not found only for a 404, and shows an empty page as an empty thread.
Any other error blocks sends on the thread. A store whose backend reports a missing thread some
other way should map it to an error with `httpStatus` 404.

```typescript
// ✅ Do: Report a missing thread as a 404
if (!chat) throw Object.assign(new Error('Chat not found.'), {httpStatus: 404});

// ❌ Don't: An empty page reads as an empty thread, never "Thread not found"
if (!chat) return {messages: []};
```

## Related Packages

- [`/core/`](../core/README.md) - `ChatModel`, feedback and server mode
- [`/transport/`](../transport/README.md) - transports, `ScriptedChatTransport`, and server ids
- [Architecture](../docs/architecture.md) - the two conversation shapes
- hoist-react `/core/` - `HoistModel`, `loadAsync()`, and `TaskObserver`
- hoist-react routing doc - `XH.routerState`, `XH.navigate()` and route parameters
