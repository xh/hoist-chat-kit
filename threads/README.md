# Threads Package

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the thread layer does, and the key features |
| [Architecture](#architecture) | `ChatThreadsModel`, `ChatThreadStore`, open chats, and the concurrency rules |
| [Configuration Pattern](#configuration-pattern) | Implementing a store and creating a `ChatThreadsModel` |
| [Common Usage Patterns](#common-usage-patterns) | Selecting, background turns, search, edits, deep links, grouping, a conversation of the app's own |
| [Properties/API Reference](#propertiesapi-reference) | Config, state, methods, the store contract and the conversation contract |
| [Extension Points](#extension-points) | Stores, chat creation, and the chat seams the layer uses |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Core models, transports, and Hoist packages |

## Overview

The `/threads/` package holds the thread layer: the models for a user's list of conversations
that a backend stores. An app implements a `ChatThreadStore` against its backend, and a
`ChatThreadsModel` does the rest. It lists the threads, opens a `ChatModel` for the selected
one, and keeps every async result where it belongs. The package is platform-neutral and has no
UI. The desktop [thread list](../desktop/cmp/threads/README.md) and
[workspace](../desktop/cmp/workspace/README.md) build on it. An app whose conversation runs on
another library can keep the list and its model. It gives each thread a conversation of its own -
see [Use a conversation of the app's own](#use-a-conversation-of-the-apps-own).

Import from `@xh/hoist-chat-kit/threads`.

Key features:

- **A store adapter** - methods to list threads and to load a thread's history. The load is
  needed only for a `ChatModel`. Rename, delete and feedback are optional. The model hides each action the store
  lacks.
- **Any conversation** - a `ChatModel`, or an adapter to a chat on another library.
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
│   ├── conversation                  # The selected thread's conversation
│   ├── selectedSummary               # The selected thread's summary
│   ├── runningThreadIds              # Threads with a turn running, here or on the server
│   ├── awaitingThreadIds             # Threads whose turn waits for the user
│   ├── finishedAwayThreadIds         # Threads whose turn ended while not selected
│   ├── endedEarlyThreads             # Threads whose last run failed or was cut short
│   ├── loadError                     # Why the selected thread's history failed, or null
│   ├── isThreadNotFound              # True if the selected thread is missing
│   ├── isThreadLoading               # True while the selected thread's history loads
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
├── loadMessagesAsync(query)          # Required with createChatModel
└── renameThreadAsync?, deleteThreadsAsync?, submitFeedbackAsync?

ChatConversation (a ChatModel, or the app's own through createConversation)
├── threadId, isBusy                  # Observable
├── isAwaitingUser?, isSaved?, endedEarly?, title?
└── loadAsync(), stop(), destroy()
```

### Open chats

The threads model holds a `ChatModel` for each open thread. It keeps a chat while the chat is
selected, busy, or paused for the user, and destroys it otherwise. A turn therefore keeps running
after the user switches away, and a turn that waits for an approval keeps its question. When the
turn ends, the model closes the chat and reloads the list, because the backend may have titled the
thread. The model keeps a closed thread's draft, run options and unsent feedback comments, in
memory for the session, and gives them back when the thread opens again. A comment finds its
message in the reloaded history by the id the chat streamed it under, or by the server's id that
the reply recorded. A comment that was sending as the chat closed does not come back. A reload of
an open thread keeps its comments too. A new thread that the backend never saw drops its drafts
when its chat closes, in memory and in local storage, as no list can bring it back.

The model sees each open thread through the `ChatConversation` contract. With `createChatModel`,
the kit wraps each `ChatModel` in a conversation of its own, and everything in this section
applies. A conversation from `createConversation` gets the same open and close rules, but no
drafts, feedback or send blockers, as the model has no `ChatModel` to wire.

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

A delete during a new thread's first turn, before `RUN_STARTED`, stops the turn and deletes the
browser's id from the store. A backend that mints its own ids may already have created the
thread under its id, which the kit never learned. That thread comes back on the next list, and
the user can delete it again.

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
| 6 | A 404 is a missing thread, which blocks sends, and an empty page an empty one. Any other failure blocks sends on that thread only, with an error and a reload. | The thread's load state feeds `isThreadNotFound`, its own send blocker and `loadError`. |
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

### Say when the chat is hidden

The selection outlives the view that shows it. A route binding keeps it while the user is on
another page, and an app may keep its chat behind a tab or in a collapsed panel. The model needs
to know, so that a reply that finishes meanwhile gets the new-reply mark, and the list shows no
selection. With a `route`, the model knows from the router. A chat the app hides some other way
is the app's to say:

```typescript
// In the app's model, as the chat tab opens and closes
this.addReaction({
    track: () => this.tabModel.activeTabId === 'chat',
    run: isShown => (this.threadsModel.isChatShown = isShown),
    fireImmediately: true
});
```

An app that always shows its chat leaves `isChatShown` alone. `isSelectionShown` combines it with
the route, and is what the model and the list read. When it turns true, the selected thread
counts as seen, as when the user opens a thread - unless the route names another thread, which
the route binding selects and marks seen instead. The thread left while hidden keeps its marks.

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
the thread, or a new turn starts in it. The thread's chat stays open until then, so the user
sees the failed turn with its error and Retry, even from a backend that does not store failed
turns. For a thread with no open chat, the store's `lastRunEnd`
and `lastRunReason` fill the same map. The model skips them if the user has seen the thread, in
this session, since its last activity. A list marks each such row as ended early.

### Cap the list and the history

The threads model does not page. It shows the threads that `listThreadsAsync` returns, and the
messages that `loadMessagesAsync` returns. A store over a large backend caps each, as the
example above caps the list at the 100 most recent threads.

A store whose backend returns history a page at a time can set `nextCursor` on the page. The
kit ignores it, and shows the messages the page holds.

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
deletes the selected thread, the model selects a new one. Check `canRename` and `canDelete`
before you show each action. A call the store cannot make throws.

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

A thread can instead have its own path, as a child route with the id in its path. Set
`threadRoute` to that route. The model navigates to it when a thread is selected, and back to
`name` when none is.

```typescript
// AppModel.getRoutes()
{
    name: 'default',
    path: '/app',
    children: [{name: 'chat', path: '/chat', children: [{name: 'thread', path: '/:threadId'}]}]
}

// ChatThreadsConfig
route: {name: 'default.chat', param: 'threadId', threadRoute: 'default.chat.thread'}
```

A new thread stays out of the route until the backend has it: until its first reply starts to
stream, a turn ends whose run started, or the store lists it. A turn that fails before any
response, or that the user stops before its run starts, leaves the thread out. The route stays on
its base path until then, so a reload or a bookmark before the first send opens a new chat. A
thread that adopts the backend's id goes into the route under that id.

A deep link to a thread that the store reports missing, with a 404, sets `isThreadNotFound`, and
the thread blocks sends, so that a send never recreates a deleted id. The workspace then shows
"Thread not found" with New Chat, in place of the chat. An app with its
own layout reads the flag the same way.

Off the route, the selection stays, so that a return restores it, and `isSelectionShown` is
false. A list shown on every page then marks a reply that finishes in the selected thread as
new, and shows the thread as not selected. A click on a row there selects the thread, and does
not navigate: the app brings the router to the chat in the list's `onThreadClick`. On return the
thread counts as seen - see [Say when the chat is hidden](#say-when-the-chat-is-hidden).

### Group the list by recency

```typescript
import {groupThreadsByRecency} from '@xh/hoist-chat-kit/threads';

const groups = groupThreadsByRecency(threadsModel.threads);
// [{key: 'today', label: 'Today', threads}, {key: 'yesterday', label: 'Yesterday', threads}, ...]
```

Threads group by the calendar day of `lastActivityAt` in the browser's time zone: Today,
Yesterday, Previous 7 days, Previous 30 days and Older. Each group is sorted most recent first,
and empty groups are left out.

### Use a conversation of the app's own

An app whose conversation runs on another library can still show the kit's thread list, or the
whole [workspace](../desktop/cmp/workspace/README.md#show-the-apps-own-conversation). Implement
`ChatConversation` as a small adapter to that library's state for one thread, and pass
`createConversation` in place of `createChatModel`. The store then needs no `loadMessagesAsync`,
because each conversation loads its own history.

```typescript
import {HoistBase} from '@xh/hoist/core';
import type {ChatConversation, ChatConversationSpec} from '@xh/hoist-chat-kit/threads';

/** One thread of the app's chat model, which runs on another library. */
export class AppConversation extends HoistBase implements ChatConversation {
    readonly threadId: string;
    private readonly isNew: boolean;

    constructor(
        private readonly chat: AppChatModel,
        {threadId, isNew}: ChatConversationSpec
    ) {
        super();
        this.threadId = threadId;
        this.isNew = isNew;
        if (isNew) chat.startThread(threadId);
    }

    get isBusy(): boolean {
        return this.chat.runningThreadIds.includes(this.threadId);
    }

    get isSaved(): boolean {
        return !this.isNew || this.chat.savedThreadIds.includes(this.threadId);
    }

    async loadAsync() {
        await this.chat.openThreadAsync(this.threadId);
    }

    stop() {
        this.chat.stopThread(this.threadId);
    }
}

// In the app's model
@managed threadsModel = new ChatThreadsModel({
    store: new AssistantThreadStore(),
    createConversation: spec => new AppConversation(this.chatModel, spec)
});
```

The threads model then drives the app's chat:

- **Select** - a click on a thread opens a conversation for it and calls `loadAsync()`. Open the
  thread in the other library there. `isThreadLoading`, `loadError` and `isThreadNotFound` follow
  the load, as for a `ChatModel`.
- **New Chat** - opens a conversation with `isNew` true and a thread id the browser minted. Start a
  new thread in the other library under that id. A library that takes its ids from the backend
  instead changes `threadId` once, during the first turn, and the model re-keys the thread.
- **Turns** - the list shows a thread as running while its conversation is `isBusy`. The
  conversation stays open while its turn runs, so give each one the state of its own thread.
  When a turn ends, the list reloads, for a title the backend set. A turn that ends in the
  background shows as a new reply, unless `endedEarly` says it failed, was interrupted, or was
  cancelled.
- **Delete** - calls `stop()`, then destroys the conversation. A delete of the selected thread
  opens a new one.
- **Show** - a library that shows one thread at a time must follow `selectedThreadId`, not
  `loadAsync()`. A user who returns to a thread whose turn still runs finds its conversation open,
  and the model does not load it again.

```typescript
// In the app's model
this.addReaction({
    track: () => this.threadsModel.selectedThreadId,
    run: threadId => this.chatModel.showThread(threadId),
    fireImmediately: true
});
```

Call `selectThreadAsync()` when the user opens a thread from inside the other library, and
`refreshAsync()` when that library creates or changes a thread on its own. The model ignores a
selection of the thread already selected, so the two sides cannot loop.

`chatModel` and the return of `newThread()` are null with `createConversation`. Read
`conversation` instead. The row states are only as good as the conversation's members: a
conversation that leaves out `isAwaitingUser` and `endedEarly` never shows those marks.

## Properties/API Reference

### ChatThreadsConfig

| Property | Type | Description |
|----------|------|-------------|
| `store` | `ChatThreadStore` | Adapter to the backend. Required. |
| `createChatModel` | `({threadId, isNew, seed}) => ChatModel` | Builds the chat for a thread. Must pass `threadId` to the `ChatModel`. `isNew` is false for a thread whose history is about to load. A new thread may start with a greeting in `initialMessages`. The model applies `seed` itself. Requires the store's `loadMessagesAsync`. Give this or `createConversation`. |
| `createConversation` | `({threadId, isNew, seed}) => ChatConversation` | Builds a conversation of the app's own for a thread, over a chat that runs on another library. Must take `threadId`. Give this or `createChatModel`. |
| `route` | `{name, param, threadRoute?}` | Route whose parameter holds the selected thread id. `threadRoute` names a child route that holds the thread in its path. Default none. |

### ChatThreadsModel state

| Property | Type | Description |
|----------|------|-------------|
| `threads` | `ChatThreadSummary[]` | The list, in the store's order. Threads started here that the store has not listed come first, unless a search is active. Pending edits show at once. |
| `selectedThreadId` | `string` | The selected thread, or null. Observable. Change it with `selectThreadAsync()` or `newThread()`. |
| `isChatShown` | `boolean` | True while the app shows its chat. An app that hides its chat behind a tab or in a collapsed panel sets it. Else leave it true. Bindable. |
| `isSelectionShown` | `boolean` | True while the user can see the selected thread: `isChatShown`, and with a `route`, the router on it. |
| `shownThreadId` | `string` | The selected thread while shown, else null. The list shows this row as selected. |
| `chatModel` | `ChatModel` | The selected thread's chat, or null. Always null with `createConversation`. |
| `conversation` | `ChatConversation` | The selected thread's conversation, or null. |
| `selectedSummary` | `ChatThreadSummary` | The selected thread's summary, or null if it is not in the list. |
| `search` | `string` | Text to search for. Bindable. |
| `runningThreadIds` | `string[]` | Threads with a turn running here, or reported running by the store. |
| `awaitingThreadIds` | `string[]` | Threads whose turn is paused for the user. Their chats stay open. |
| `finishedAwayThreadIds` | `string[]` | Threads whose turn ended while the user was not looking at them: another thread was selected, or the selection was hidden. A thread leaves it when the user sees it. Held for the session only. |
| `endedEarlyThreads` | `Record<string, ChatThreadEndedEarly>` | Threads whose last run ended early, by id, each with `runEnd` (`'interrupted'` or `'failed'`) and a `reason`. From background turns in this session, and the store's `lastRunEnd` for threads with no open chat that the user has not seen since their last activity. |
| `loadError` | `Error` | Why the selected thread's history failed to load, or null. |
| `isThreadNotFound` | `boolean` | True if the store reported the selected thread missing, with a 404. |
| `isThreadLoading` | `boolean` | True while the selected thread's history loads. Its chat is empty until then, so a layout shows a plain placeholder rather than a new chat's empty state. `ChatWorkspace` does. |
| `listError` | `Error` | Error from the last list load, or null. The list keeps its threads. |
| `listTask` | `TaskObserver` | Pending while the list loads. |
| `loadTask` | `TaskObserver` | Pending while the selected thread's history loads. |
| `canRename`, `canDelete` | `boolean` | True if the store has the method. |

### ChatThreadsModel methods

| Method | Description |
|--------|-------------|
| `loadAsync()`, `refreshAsync()` | Load the threads for the current search. |
| `newThread(seed?)` | Open a new thread and select it. `seed` holds a `draft` and `runOptions`. Returns its chat, or null with `createConversation`. |
| `selectThreadAsync(threadId)` | Select a thread, opening its chat and loading its history if needed. |
| `reloadThreadAsync()` | Load the selected thread's history again. Ignored while its turn runs. |
| `renameThreadAsync(threadId, title)` | Rename at once. Rolls back with a toast on failure. |
| `deleteThreadsAsync(threadIds)` | Delete at once, closing the chats. Rolls back with a toast on failure. |

### ChatThreadStore

| Method | Description |
|--------|-------------|
| `listThreadsAsync({search})` | Required. A `ChatThreadPage`: threads most recently active first. The store decides how many. |
| `loadMessagesAsync({threadId})` | Required with `createChatModel`, and never called with `createConversation`. A `ChatMessagePage`: the thread's messages, oldest first. The kit ignores its optional `nextCursor`. |
| `renameThreadAsync(threadId, title)` | Rename a thread. |
| `deleteThreadsAsync(threadIds)` | Delete threads. Deleting a missing thread succeeds. |
| `submitFeedbackAsync(spec)` | Save a rating. See `ChatFeedbackSpec` in [`/core/`](../core/README.md#rate-a-reply). |

### ChatConversation

Mark each member that changes as observable, or compute it from observables.

| Member | Type | Description |
|--------|------|-------------|
| `threadId` | `string` | The thread's id. May change once while busy, to adopt the backend's id. A change while idle means the conversation holds another thread. |
| `isBusy` | `boolean` | True while a turn runs. |
| `isAwaitingUser` | `boolean` | True while a turn waits for the user. Optional, default false. |
| `isSaved` | `boolean` | True once the backend has a new thread. Puts the thread in the route, and keeps it on close. Optional, and null counts as left out: a new thread then counts as saved once a turn ends. Change `threadId` before, or in the same action as, this turns true. |
| `endedEarly` | `ChatConversationEndedEarly` | How the last turn ended, if not with a reply to see, else null: `failed`, `interrupted`, or `cancelled` by the user's own action. The list marks the first two. A cancelled turn does not count a new thread as saved. Optional. |
| `title` | `string` | Title for a new thread until the store lists it. Optional, default 'New conversation'. |
| `loadAsync()` | `Promise<void>` | Load and show the thread's history. A later call supersedes an earlier one. Reject with `httpStatus` 404 for a missing thread, or resolve to open it empty - see the pitfalls. |
| `stop()` | `void` | Stop the running turn, as for a delete. |
| `destroy()` | `void` | Release resources, as the thread closes. A `HoistBase` has it. |

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
- **Conversations** - `createConversation` puts a chat that runs on another library behind the
  same thread layer. See [Use a conversation of the app's own](#use-a-conversation-of-the-apps-own).
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

### Expecting a failed list to stay quiet

A failed list goes to `XH.handleException` with no alert, which logs a console error of the form
`[ExceptionHandler] | <message>`. A test that fails on console errors should expect it, or mock
`XH.handleException`.

### Holding on to a chat

A chat closes when it is neither selected nor busy, and a closed chat is destroyed. Read
`threadsModel.chatModel` when you need it, rather than keep a reference. The same holds for
`threadsModel.conversation`.

### Ending a turn before its work is done

When a conversation's `isBusy` turns false while the user reads another thread, the threads model
destroys it at once. Save the turn's messages, and anything else the turn needs, before `isBusy`
turns false. Otherwise a `destroy()` that drops the conversation's state can lose them.

```typescript
// ✅ Do: Save, then end the turn
await backend.saveMessagesAsync(threadId, messages);
setRunning(threadId, false);

// ❌ Don't: The conversation may be gone before the save reads its messages
setRunning(threadId, false);
await backend.saveMessagesAsync(threadId, messages);
```

### Ending a turn with isBusy alone when the user switches threads

The threads model keeps a busy conversation open, and lists its thread as running. A library that
cancels the reply when the user opens another thread must say so. A conversation whose `isBusy`
turns false with `endedEarly` null counts as a finished turn, and its row shows a new reply that
does not exist. Set `endedEarly` first, or in the same action. `cancelled` leaves the row as it
was. `interrupted` marks it, with the reason as a tooltip, for a reply the user should know was
cut short.

```typescript
// ✅ Do: Report the cancel, then end the turn
@action
onThreadCancelled(threadId: string) {
    this.endedEarly = {runEnd: 'cancelled', reason: null};
    this.isBusy = false;
}

// ❌ Don't: The row shows a new reply
this.isBusy = false;
```

A library that stops following a turn that goes on running on the server does the same. Have the
store report `isRunning` for that thread, so that the list still shows it running.

### Reporting a missing thread as an error

The model marks a thread not found only for a 404, and shows an empty page as an empty thread.
Any other error blocks sends on the thread. A store whose backend reports a missing thread some
other way should map it to an error with `httpStatus` 404.

A conversation of the app's own may choose the empty thread on purpose, for a deep link to a
thread the backend has not saved yet. Resolve `loadAsync()` and the thread opens empty: it counts
as saved, so its id stays in the route, the workspace's header says "New chat", and the first turn
creates it. Reject with a 404 to show "Thread not found" instead.

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
