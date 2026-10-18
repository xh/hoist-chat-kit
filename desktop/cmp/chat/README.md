# Desktop Chat Components

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the components do, and the key features |
| [Architecture](#architecture) | The component tree, and how a message renders its parts |
| [Configuration Pattern](#configuration-pattern) | Putting a `ChatModel` on screen with `ChatPanel` |
| [Common Usage Patterns](#common-usage-patterns) | Composer, empty state, actions, renderers, images, citations, plugins, layout |
| [Properties/API Reference](#propertiesapi-reference) | Props of each component |
| [Theming](#theming) | The `--xh-chat-*` CSS variables, their hooks and compact density |
| [Extension Points](#extension-points) | Slots, renderers, source clicks and markdown |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Models, transports, markdown and Hoist packages |

## Overview

The `/desktop/cmp/chat/` package holds the desktop components that render a
[`ChatModel`](../../../core/README.md). They draw the conversation, the composer, and every
part of a reply: markdown text, reasoning, tool calls, files, sources and app data. They read
the model and never see a wire format.

Import from `@xh/hoist-chat-kit/desktop/cmp/chat`.

Key features:

- **`ChatPanel`** - a complete chat in one Hoist `Panel`: the message list above the composer.
- **Streaming that stays cheap** - each part renders as a memoized component. A part re-renders
  only when it changes, not on every streamed change to its message.
- **Quiet process rows** - reasoning and tool calls stack as 28px rows with an outline, in one
  block at a tighter gap than the reply's output. Two or more consecutive tool calls of one step
  fold into one row, such as "Used 3 tools". A call that waits for the user stays in view, and
  asks for approval in the words of the tool's `approvalPrompt`.
- **An agent's questions** - a server agent's AG-UI interrupts show in a framed panel at the foot
  of the reply, with large rows to choose from, a text box or a form, and Decline.
- **Inline generative UI** - a tool with `display: 'inline'` shows its rendered output as part
  of the reply, with a status only while it streams, waits or fails.
- **Activity timeline** - calls to tools with `display: 'timeline'` gather into one 28px block
  that sums up an agent's run: the current step while it runs, then "Used 7 tools and 1 agent".
  It opens to a tree of rows, with sub-agents, batches, narration and a pinned plan.
- **Citations in place** - numbered markers sit in the text or at the end of the paragraph they
  support, and keep their numbers while the reply streams. Each opens a card with the source's
  title and excerpt. The sources list under the reply shares the numbers.
- **Documents beside the chat** - a document's citation opens in the side panel, in the app's
  own viewer, and a web page opens in a new tab.
- **Renderers as components** - a tool `renderer` or a data renderer renders as a component of
  its own, so it can use hooks such as `useLocalModel()`.
- **Contained render errors** - each message and each part renders inside an error boundary. A
  renderer that throws shows a short note in place of its part, and the rest of the conversation
  still renders.
- **Safe markdown** - raw HTML renders as text, and model-written images do not load unless the
  app allows them.
- **Failures inline** - a failed reply shows what happened in the reply, with Edit Prompt and
  Copy Details. A message whose turn never started shows "Not sent". The thread's next action,
  such as Try Again, sits in the composer's status region.
- **Feedback** - thumbs on each reply, when the chat takes feedback. A rating that asks for a
  comment opens a comment form under the action bar.
- **Transcripts** - the message list shows a `ChatModel`, or read-only any app model that
  implements `ChatTranscript`, such as a saved conversation.
- **App slots** - toolbar items in the composer, an empty state with suggestions, message
  actions and message header items.
- **Live status** - a reply's header says what it is doing, such as "Writing 6s", and that it
  has gone quiet, such as "No response for 34s". Every moving cue has a static twin under reduced
  motion.
- **Screen reader announcements** - the list never reads tokens. It reads each reply once, as it
  finishes.
- **Theme variables** - colors, widths and radii come from `--xh-chat-*` CSS variables, built
  from Hoist's own variables, with light and dark defaults.

## Architecture

```
ChatPanel (Panel)                       # uses(ChatModel)
├── ChatMessageList                     # Scrolls, sticks to the bottom while a reply streams
│   ├── ChatEmptyState                  # For a list with no messages, outside a ChatPanel
│   │   └── ChatSuggestions             # Prompt cards that fill the composer
│   ├── ChatMessageView (per message)   # A user bubble, or an assistant reply
│   │   ├── header                      # Name, live status, time, time taken, header items
│   │   ├── parts, in order:
│   │   │   ├── process block           # Reasoning and tool rows, at the process gap
│   │   │   │   ├── ChatReasoning       # "Thought for 12s" disclosure
│   │   │   │   ├── ChatToolCall        # A 28px row that opens
│   │   │   │   └── tool call group     # "Used 3 tools", opens to show each call
│   │   │   ├── text                    # ChatMarkdown, with inline citation chips
│   │   │   ├── ChatToolCall (inline)   # Renderer output, as part of the reply
│   │   │   ├── files                   # ChatFileChip row
│   │   │   └── data                    # dataRenderers, or ChatNoAnswer
│   │   ├── how it ended                # Failed row, "Stopped", or the length cut
│   │   ├── ChatSources                 # Sources list, in marker order
│   │   ├── action bar                  # Copy, Regenerate, Undo, thumbs, messageActions
│   │   └── feedback form               # Under the action bar, for a comment
│   └── announcer regions               # Hidden live regions that read finished replies
├── ChatStatusRegion                    # One line: the thread's next action, such as Try Again
└── ChatComposer                        # uses(ChatComposerModel), or the chat's composerModel
    ├── attachment tray                 # File chips, then any files left out
    ├── input                           # Grows from 1 to 8 lines, then scrolls
    └── bar                             # leftItems pills | rightItems, attach, Send or Stop
```

An empty conversation renders no message list. `ChatPanel` shows the `ChatEmptyState` heading,
then the status region and composer centered at about 40% of the height, then the suggestions.
The first send moves the composer to the bottom in one frame, and focus stays in it.

### Render context

`ChatModel` replaces a message with a new object on every streamed change. If a part received
the message, every part would re-render on every flush. So `ChatMessageView` gives each part a
`ChatPartRenderContext` instead: `{chatModel, host, messageId}`. The view builds the context once per
message id, so it stays the same object while the message streams.

Tool renderers, data renderers, `messageActions` and `messageHeaderItems` all receive this
context. A renderer that needs the whole message reads `chatModel.getMessage(messageId)`. It
then re-renders whenever the message changes, so do this only when you need to.

### Render errors

Every message, and every part within it, renders inside Hoist's `ErrorBoundary`. A tool
renderer, a data renderer, an inline component or the markdown of one part may throw, and only
that part fails. It shows "This part could not be displayed." with the error message in a
Details disclosure. Hoist's exception handler logs the error, with no alert. A streaming part that
failed renders again when its state changes, for example when its input completes. A data part
renders again when it is replaced.

### Scroll behavior

`ChatMessageList` follows a streaming reply by staying scrolled to the bottom. A wheel or scroll
up releases the list, so the user can read back while the reply streams. A round button then
offers a way back down. Scrolling back to the bottom, or sending a message, sticks the list
again. Content that grows when no reply streams, such as a tool card the user opens, stays in
place. In the last message of a list scrolled to the bottom, the list follows it down instead,
so that it opens into view.

### Live cues

While a turn runs, the reply's header shows its status and the time taken so far, as
"Thinking 1s", "Writing 6s" or "Running tools 12s". Each status has one icon, one label and one
color, drawn by `ChatStatusCue` from one table. The status comes from `getChatReplyStatus()` in
[`/core/`](../../../core/README.md#display-status), read again each second.

- **Spinner** - Hoist's `Spinner`, at 1em of its line. A reply shows one spinner at most: while
  a tool call runs, the call's row shows it and the header drops its own.
- **Caret** - a 2px bar at the end of streaming text. It blinks hard on and off, rests dimmed
  after 2 s with no text, and goes when the text is done.
- **Stalled** - after `stallAfterMs` with no data from the server, heartbeats included, the
  spinner gives way to "No response for 30s" in the warning color. The next byte clears it.
- **Skeleton shimmer** - a generative UI placeholder still shown after 1 s shimmers three times,
  then holds still.

No cue moves without a live stream behind it. See [Reduced motion](#reduced-motion) for the
static twins.

### Screen readers

The list's viewport is a `role="log"` region with `aria-live="off"`. It gives screen reader
users structure and navigation, and never reads tokens as they stream. The list also renders the
two hidden live regions of `chatAnnouncer`, the kit's one voice for screen readers. When a reply
finishes while the list shows it, the announcer reads it once:

> Analyst replied after 2 tools, 12 seconds. HY Credit is the only desk over its limit.
> Continues in the message.

The announcement names the assistant with `assistantName`, then gives the tool count and the
time. It ends with the first paragraph as plain words, cut at 300 characters. A reply the user
stops reads "Reply stopped." History loaded into the list is never announced. The composer
renders the regions too. When a page mounts several, each announcement fills only the newest
visible set, and a list that mounts later never reads it. See
[Announce to screen readers](../../../core/README.md#announce-to-screen-readers).

### Keyboard

The kit's shortcuts come from `ChatKit.defaults.shortcuts`, in the combo format of Hoist's
`useHotkeys`. Remap an action, or set it to null to drop it, before the chat renders. Browsers
bind some of these keys, so test the defaults in the browsers your users run.

```typescript
// In the app's AppModel or Bootstrap.ts.
ChatKit.defaults.shortcuts.newChat = 'alt+n';
ChatKit.defaults.shortcuts.toggleSidebar = 'mod+b';
```

| Action | Default | Where | Does |
|---|---|---|---|
| `newChat` | `mod+shift+o` | Focus in a workspace | Starts a new chat, and focuses its composer. |
| `focusComposer` | `/` | Focus in a `ChatPanel` or workspace, outside a text field | Focuses the composer. |
| `cycleRegions` | `f6`, with Shift to go back | Focus in a workspace | Moves focus through the thread list, the conversation, the composer and the side panel. |
| `toggleSidebar` | null | Focus in a workspace | Collapses or expands the thread sidebar. |

`mod` is Cmd on a Mac and Ctrl elsewhere. No shortcut ever approves, applies or deletes.

Escape does one thing per press, in the region with focus:

1. A popup closes, such as a popover or a citation card.
2. Else the side panel closes, with focus there, and focus moves to the composer.
3. Else an inline edit or a feedback form cancels.
4. Else a reply in progress stops, with focus in the conversation or the composer.

### Citations

A text part's citations show as numbered markers at the end of its last paragraph or list item. A
part that ends in a code block, a table or a quote puts them on the last paragraph before it.
Numbers run across the whole reply, in order of first citation, and never change once given.
Sources that arrive after the text take the numbers of their citations.

Some backends cite inline instead, as `[1]`, `[1, 3]` or `[1][3]` in the text. With
`citationMarkers` on, each number renders as a 14 px marker for the source it cites. A marker for
four or more sources collapses to one marker. It reads "2–5" when the numbers are consecutive,
and "4 sources" when they are not. Its card lists each source. A range such as `[2-5]` stays as
written. See
[Citation markers](../../../cmp/markdown/README.md#citation-markers) for how markers match
sources. Sources then take the numbers that cite them: their `marker`, or their position when no
source has a marker.

A marker opens its source's card after 300 ms of hover, or at once on focus. The card shows the
number, the icon, the title, the file name and page or the host, and the excerpt. Its buttons are
Open Passage or Open Link, and Copy Excerpt. It shows only what the source carries. Tab moves
into the card's buttons and on to the next marker. Esc closes the card and keeps focus on the
marker.

A click on a marker opens its source, as a click on its row in the sources list does. A source
that nothing can open pins its card instead.

### Sources list

`ChatSources` lists the sources under the reply's text, in the order of their numbers. It never
renumbers them, so `[2]`, its marker and the row numbered 2 agree even when the numbers skip.
Three rows show, and the rest sit behind "Show N More". A source that a citing reply never cites
takes no number and no row.

Every row has the same layout: the number, an icon, the title and a meta line. A source's
`sourceType` sets the icon, the meta line and what a click does:

| `sourceType` | Icon and meta | Click |
|---|---|---|
| `document` | File-type icon, then `metadata.fileName` and `metadata.page` | Opens the side panel when one is in reach, else `onSourceClick`, else its URL in a new tab |
| `url` | Globe, then the host | Opens a new tab, or `onSourceClick` in its place |

A Ctrl or Cmd click on a row opens the source's URL in a new tab. Only `http` and `https` URLs
open. The list loads no image, so it sends no request of its own.

### Side panel

A document's marker or row opens in the side panel when a `ChatSidePanelHost` is in reach. The
message view looks for one in Hoist's model context. `ChatWorkspace` publishes one, with the
`documentRenderer` from its config. An app with its own layout can publish a
`ChatSidePanelModel` above the chat and render it with `ChatSidePanel`. See
[the side panel](../../../core/README.md#side-panel).

A result card's Expand opens its table or chart in the same panel. See
[the two tiers](../genui/README.md#two-tiers).

The marker whose passage the panel shows stays active, with `aria-pressed`. Without a host, or
without room, a document opens with `onSourceClick`, else at its URL in a new tab. When the panel
has a viewer but no room, a toast says so. A document that nothing can open shows a toast too,
"This document can't be opened here."

### Activity timeline

`ChatTimeline` sums up an agent's run in one block. The message view renders one for calls to
tools with `display: 'timeline'`, in place of their rows. Calls to `card` tools, and reasoning
alone, keep the process rows. See [Tool display](../../../core/README.md#tool-display).

The block is one 28px line. Its height never changes, and it changes only its words and its icon:

| State | Line | Meta |
|-------|------|------|
| Running | The active plan item, else the latest finished sentence of narration, else the running call. "Running 3 steps" while calls run at once. | Step count or plan position, time so far, failures |
| Quiet | "Waiting on" the running step, once the chat has had no data for its `stallAfterMs`. The spinner stays. | "no update for 34s" first |
| Waiting | "Waiting for approval" or "Waiting for your answer", in the attention color | As running, with the time held |
| Paused | "Paused", when the reply waits on the user for something outside the block | As running, with the time held |
| Done | "Used 7 tools and 1 agent" | Time taken, failures |
| Stopped | "Stopped after 5 tools". Calls open at the stop show as cancelled, not failed. | Cancelled count |
| Failed | "Ended at step 5". The reply's failed row says why. | Tool count |

The line swaps to its done summary in place once the answer starts below the block. Failures
show in the warning color, as "1 failed", and as "1 failed, retried" once every failed call was
retried with success. A retry is a later call with the same tool, input and sub-agent. A spaced
dot separates the meta's parts, as in "20s · 1 failed, retried".

The block starts collapsed, and never opens or closes by itself. The one exception is a call that
waits for the user. Its approval panel, or its question, shows under the line whether or not the
block is open, and the block frames itself in the attention color. Approval uses the chat's
`approveToolCallAsync()` and `denyToolCallAsync()`, as a tool row does. A question with up to
three `choices` in its input shows them as buttons, and more show in a select. The answer goes to
the chat's `addToolOutputAsync()`. A tool `renderer` replaces the buttons. A transcript shows the
question with no controls, and no approval panel.

Open, the block shows the pinned plan, then a tree of rows:

- **Calls** - status or kind icon, title, a one-line summary of the input, and the time taken.
  Status words replace the summary when a call fails, waits or is denied. A row opens to its
  Input, Output and Error panes, or to the tool's `renderer`. Panes mount on open, scroll inside
  240px, show at most 500 lines, and offer Copy.
- **Batches** - three or more calls of one tool in a row, with no narration between, merge into
  one row with a count and the time they span.
- **Sub-agents** - the calls of a sub-agent nest under its row, 20px per level, and its result
  closes the group. A sub-agent row starts open while it runs and closed once done. Below three
  levels, a row names its parent in place of more indent. A sub-agent runs only while its reply
  streams. One left running when its run ends, as on an error or a dropped stream, shows as
  failed, and one open at a stop shows as cancelled.
- **Narration and reasoning** - text between two timeline calls renders at 12px, aligned with
  the titles. Text after the last call stays below the block, as the answer, until another
  timeline call starts. Then it moves into the block.

The line is a button with `aria-expanded`. The tree is `role="tree"` with one tab stop. Up and
Down move between rows, and Home and End jump to the ends. Right opens a row or enters its first
child. Left closes it or goes to its parent. Enter and Space toggle a row. Escape inside a row's
details returns to the row.

The timeline announces a step that fails while the reply runs. The message list announces a
failed call shown as a card the same way. After two minutes with no data, the timeline announces
once what it waits on. It never announces its done summary. The reply's announcement says it instead, as "Analyst replied
after 7 tools and 1 agent, 42 seconds, 1 failed."

Below 480px, the block takes the `xh-chat-timeline--narrow` class. It drops the step count
first, shows failures as a count beside the warning icon, and shortens its words.

A backend shows sub-agents with AG-UI's `SUBAGENT_STARTED`, `SUBAGENT_FINISHED` and
`SUBAGENT_ERROR` events, and marks a sub-agent's calls with `subagentRunId` on `TOOL_CALL_START`.
`subagentEvents()` scripts the same events for `ScriptedChatTransport`.

### Fixed "not found" replies

A `data` part with the `dataType` `xh.chat.noAnswer` renders as `ChatNoAnswer`: a fixed template
in a dotted frame, tagged "Fixed reply", that lists the documents searched. Its wording never
comes from the model. The reply shows no sources list and no Regenerate. Its only thumb is the
thumbs down, labeled "It is in these documents". Register a renderer for the type in
`dataRenderers` to replace the template.

## Configuration Pattern

Create the `ChatModel` in your own model, and render it with `chatPanel`. Pass any Panel props
for the chrome around it.

```typescript
import {chatClearButton, chatPanel} from '@xh/hoist-chat-kit/desktop/cmp/chat';
import {hoistCmp, uses} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {AssistantModel} from './AssistantModel';

export const assistantPanel = hoistCmp.factory({
    displayName: 'AssistantPanel',
    model: uses(AssistantModel),

    render({model}) {
        const {chatModel} = model;
        return chatPanel({
            model: chatModel,
            title: 'Assistant',
            icon: Icon.ai(),
            compactHeader: true,
            headerItems: [chatClearButton({chatModel})],
            suggestions: ['What can you do?', 'Summarize my portfolio'],
            composerProps: {placeholder: 'Ask about your portfolio...'},
            messageListProps: {assistantName: 'Assistant'}
        });
    }
});
```

`chatClearButton` clears the conversation and starts a new thread. It is disabled while the
conversation is empty, and asks the user to confirm while a reply streams. Pass `onClick` to do
more, such as to discard saved history too.

The Toolbox Weather V2 example renders its Dashboard Agent this way, and the Toolbox Chat Kit
example shows each feature in a demo of its own.

## Common Usage Patterns

### Customize the composer

Pass `composerProps` to `ChatPanel`, or props to `chatComposer` directly. `leftItems` fills the
left slot of the composer's bar, for pills. `rightItems` goes before the attach and Send
buttons, for a context meter. `topItems` adds content above the input, such as context chips.

```typescript
chatPanel({
    model: chatModel,
    composerProps: {
        placeholder: 'Ask about this dashboard...',
        maxRows: 6,
        leftItems: [agentPill(), chatScopeChip({documents})],
        topItems: contextChips()
    }
});
```

Attachments are a model setting: set `composer: {enableAttachments: true}` on the
`ChatModelConfig`. The user can then attach files with the paperclip button, a paste, or a drop
on the composer. A paste that carries text stays a paste, even when the clipboard also holds an
image of the copied cells.

To hold the user back until the app is ready, set `sendBlocker` on the `ChatModelConfig`. It
returns the reason sending must wait, or null. The composer disables Send and shows the reason
as the button's tooltip. The status region above the composer states the reason too:

```typescript
new ChatModel({
    transport,
    sendBlocker: () => (this.documentId ? null : 'Choose a document first.')
});
```

While a reply is in progress, Send becomes a Stop button with the word "Stop", if the host is a
`ChatModel`. The user can type the next message, and Enter does nothing until the reply ends.

### Add a pill to the composer

`chatComposerPill` is a small chip for the left slot. It shows an icon, its words, a count and a
chevron, and opens a menu or a popover upward. Bind its choices to
`chatModel.runOptions`, so that each turn records them and a change never reaches a reply in
progress.

```typescript
chatComposerPill({
    icon: Icon.tools(),
    text: 'Tools',
    count: enabledTools.length,
    content: toolList()
});
```

Pass `menuItems` for a single choice, or `content` for a list of checkboxes. A pill with neither
opens nothing. In a compact host, a pill shows only its icon and count.

### Scope questions to documents

`chatScopeChip` scopes the next question to some of the app's documents. The app supplies the
documents, each with an `id`, a `name` and an optional `icon`. The chip reads "All documents"
with none chosen, else "Documents" with the count. Its popover lists the documents as
checkboxes, with a search box for a long list, and Clear.

```typescript
chatPanel({
    model: chatModel,
    composerProps: {leftItems: chatScopeChip({documents: this.documents})}
});
```

The chip writes the chosen ids to `chatModel.runOptions.documentIds`. Each question records a
copy as `metadata.runOptions`, and a retry, regenerate or edit re-runs with that copy. Under
`ChatThreadsModel`, the scope belongs to the thread, and a thread opens with the scope of its
last question. To keep the scope in your own state, pass `value` and `onChange` instead.

### Recover from a failed reply

`ChatPanel` renders a `ChatStatusRegion` above the composer. It shows one line, the most urgent
status of the thread, with at most one action. A custom layout renders it with
`chatStatusRegion()` above the composer. Screen readers hear each new status once. The status a
thread already has when the region mounts, or when the thread opens, is not announced.

| Status | Shows | Action |
|---|---|---|
| Sending blocked | The `sendBlockedReason` | None |
| Offline | "Offline. Your draft is kept; send it when you're back online." | None |
| Failed, retry-safe | "The reply failed." and the cause | Try Again |
| Failed, not retry-safe | The cause, and "It may still be running." | Refresh Status, else Try Again |
| Interrupted or cancelled by the server | The server's reason | Try Again, or Refresh Status |
| Left running on the server | "Still working on the server." | Refresh Status |
| Stalled | "No response for 34s." | Refresh Status |
| Server asked for a wait | "Waiting to retry, 42 s." | Cancel. The turn retries at zero, at most 3 times in a row |
| Waiting for the user | "Waiting for your answer above." | None |
| Reply in progress | "Assistant is working · Esc to stop" | None |
| Draft restored | "Draft from 10:31am restored." | Discard |

A failure is retry-safe unless the server's `RUN_ERROR` sets `metadata.retrySafe: false`. In
server mode, the kit's own `stalled`, `incomplete-stream` and `connection-lost` errors are not
retry-safe either, because the server may still be running the turn. Refresh Status shows only
when the chat can reload the thread. `ChatThreadsModel` supplies that for its chats. See
[Recover from a failed reply](../../../core/README.md#recover-from-a-failed-reply).

### Keep drafts

The composer saves its draft text per thread through `XH.localStorageService`, after each pause
of 500 ms. When the thread opens again, the composer restores the text and the status region
shows "Draft from 10:31am restored." with Discard. A chat that moves to a thread with no draft
empties its composer. The draft goes when its message sends.
Attachments stay in memory only. `XH.localStorageService` keys each draft by app and user, so
another user never sees it. See [Keep drafts](../../../core/README.md#keep-drafts) for the
settings.

### Use the composer without a ChatModel

The composer needs only a `ChatComposerHost`: `isBusy` and `sendAsync()`, plus optional
`messages` and `sendBlockedReason`. Create a `ChatComposerModel` with that host, and render it
with `chatComposer`. On send, the composer passes the draft to `sendAsync()` and clears it. Stop,
per-thread drafts and the status region need a `ChatModel`, so they do not show. See
[Use the composer without a ChatModel](../../../core/README.md#use-the-composer-without-a-chatmodel)
for the host and an example.

```typescript
chatComposer({model: notesModel.composerModel, placeholder: 'Add a note...'});
```

### Show messages without a ChatModel

To show a conversation read-only, such as an admin's chat log or a saved conversation, pass a
`ChatTranscript` as `host`: `messages`, plus optional `dataRenderers` and `catalog`. `ChatModel`
implements it. The list renders every part, with Copy and any `messageActions`. Calls to the
catalog's tools show as their components, as in the live chat. Edit, Regenerate, Undo, feedback,
approvals and Stop need the turn loop, so they show only for a `ChatModel`. Part renderers
receive a context whose `chatModel` is null.

```typescript
export class NotesModel extends HoistModel implements ChatTranscript {
    @observableRef accessor messages: ChatMessage[] = [];
}

chatMessageList({host: notesModel});
```

### Replace the empty state

`emptyStateProps` sets the heading, supporting text and icon of the default empty state.
`suggestions` adds prompt cards under the centered composer, each with an optional icon and
`description`. A click on a suggestion fills the composer and focuses it, and never sends. The
cards hide while the composer has text. Pass `onSelect` to `chatSuggestions` to act on a click
yourself.

```typescript
chatPanel({
    model: chatModel,
    emptyStateProps: {
        title: 'What should we build?',
        text: 'Describe a dashboard and the agent will build it.'
    },
    suggestions: [
        {
            text: 'Compare two cities',
            description: 'Weather side by side',
            prompt: 'Compare weather in New York and Tokyo'
        },
        'What can you help me do?'
    ]
});
```

To show other content instead, pass it as `emptyState`. The message list shows it, and the
composer stays at the bottom.

### Collect feedback

Each reply shows thumbs up and down once its turn ends, if the chat can submit feedback. Set the
rules in `ChatModelConfig.feedback` - see
[Rate a reply](../../../core/README.md#rate-a-reply). A failed reply shows no thumbs.

```typescript
// A backend that rejects a down vote without a comment, and cannot clear a rating.
new ChatModel({
    transport,
    feedback: {
        submitAsync: spec => XH.postJson({url: 'chat/feedback', body: spec}),
        requireComment: true,
        clearable: false,
        maxCommentLength: 2000
    }
});
```

A thumbs up saves on click and shows "Thanks" for 3 s. An "Add a comment" link then stays until
the next send, and opens an optional form. A thumbs down opens the comment form inline, under the
action bar, with focus in the comment. The form never opens in a popover, so an outside click
cannot lose the comment. With `allowComment: false`, both thumbs save on click and offer no
comment.

| Config | A thumbs down |
|---|---|
| `requireComment: true` | Saves nothing until the user sends a non-blank comment. The thumb shows pressed meanwhile. Cancel or Escape restores the earlier rating. |
| `requireComment: false` | Saves at once, and opens an optional form. The comment follows as an update. Cancel or Escape keeps the rating. |

Send enables once the comment has text. In the form, Enter adds a new line, and Ctrl/Cmd+Enter
sends. A counter shows from 90% of `maxCommentLength`. While the form sends, the
thumbs and the form disable, and Cancel goes, as the request is already on its way.

Failures show inline, never as a toast. A rating that fails to save un-presses, and "Couldn't save
rating" shows beside the thumbs for 8 s, with Retry. A form that fails to send keeps the comment,
with Retry. A server that refuses the comment itself, with a 400, 413 or 422 status, has its
reason shown under the field, with no Retry, as resending the same comment cannot work. After a
send, the form closes and focus returns to the thumb.

One form is open per chat. A thumb on another reply closes an empty form, but waits while the
open form has a draft. The chat holds the draft in `feedbackDrafts`, so it survives a scroll or a
new view of the message list. It goes when the comment is sent, when the form is cancelled, and
when the chat clears or loads a thread. Regenerate closes the form of the reply it replaces.

After a reload, the chosen thumb shows alone, from `metadata.feedback`. The comment does not come
back, so the reply shows no comment mark. The announcer reads "Feedback sent." on a save,
and reads a failure at once.

### Approve a tool call

A call that waits for approval frames its row in the attention color and shows the approval
panel: the prompt, from the tool's `approvalPrompt`, and any `preview`. Below them sit Allow,
Deny and an optional reason, which goes to the agent with either decision. Allow comes first, as
in a form. Enter in the reason sends nothing, and no shortcut ever allows a call.

When a request arrives, focus moves to Allow only if focus was in the conversation and the
composer is empty. A user who is typing keeps the keyboard. Allow and Deny move focus to the
reply, as the panel goes once the call is decided.

### Answer an agent's questions

A server agent's questions, from AG-UI interrupts, show in one framed panel at the foot of the
reply. It follows Claude Code's clarifying questions, framed in the attention color. It names who
asks, the assistant or a sub-agent, then shows the question and an answer control chosen from
its `responseSchema`:

| Schema | Control |
|--------|---------|
| None | A text box, with Send |
| One choice of three options or fewer | Large rows, one per option, with its description. A click answers. |
| A string enum or a boolean | Choice rows, or Yes and No |
| A flat object of simple fields | A Hoist form, with Send |
| Anything else | The question, with "This question cannot be answered here." |

Every question offers Decline. A lone question resumes the run as soon as the user answers it.
Several show one at a time, then a review step that lists each answer, with Change and Submit.
A question past its `expiresAt` shows as expired and goes back declined. Once the run resumes,
each question shrinks to one line with its answer, such as "How often? - Weekly".

A server tool call that an interrupt asks to approve shows the approval panel on its call, in
the agent's words. See
[Answer an agent's questions](../../../core/README.md#answer-an-agents-questions) for the model
API.

### Undo a reply's changes

Undo shows in the action bar of the reply whose changes the user can undo - see
`ChatModel.canUndoTurn()`. While the undo runs, the button shows a spinner. A failed undo shows
under the reply with its cause and Retry, never as a toast, while the reply can still be undone.
Once undone, the reply notes "Changes undone." and focus on Undo moves to the reply. There is no
Redo: the user can ask again.

### Add message actions, such as feedback

`messageActions` adds buttons to each message's action bar, after the built-in ones: Copy,
Edit, Regenerate, Undo and the thumbs. Undo shows on a reply whose changes the user can undo -
see `ChatModel.canUndoTurn()`. The function receives the message and its render context, and
returns elements. For feedback buttons of your own, leave `ChatModelConfig.feedback` unset, so
the built-in thumbs stay hidden. Keep the feedback state in your own model, so it survives a
re-render and can go to your server.

```typescript
export class AssistantModel extends HoistModel {
    @managed readonly chatModel: ChatModel;

    /** Feedback by message id. (observable) */
    @observableRef accessor feedback: Record<string, 'up' | 'down'> = {};

    // An arrow function field, so the prop stays stable across renders.
    renderActions = (message: ChatMessage): ReactNode[] => {
        if (!message.isAssistant) return [];
        const value = this.feedback[message.id];
        return [
            button({
                key: 'up',
                icon: Icon.thumbsUp({prefix: value === 'up' ? 'fas' : 'far'}),
                tooltip: 'Helpful',
                onClick: () => this.setFeedback(message.id, 'up')
            }),
            button({
                key: 'down',
                icon: Icon.thumbsDown({prefix: value === 'down' ? 'fas' : 'far'}),
                tooltip: 'Not helpful',
                onClick: () => this.setFeedback(message.id, 'down')
            })
        ];
    };

    @action
    setFeedback(messageId: string, value: 'up' | 'down') {
        this.feedback = {...this.feedback, [messageId]: value};
        // Send it to your server here.
    }
}

chatPanel({model: chatModel, messageListProps: {messageActions: model.renderActions}});
```

`messageHeaderItems` works the same way. Its items show in an assistant message's header, after
the name and the time taken, for example the model that answered.

### Render a tool call as UI

A tool's `renderer` replaces the default input and output JSON in its card. It receives the call
and the render context. The renderer renders as a component of its own, and mounts only while
the card is open. So it can use hooks, and a model it creates with `useLocalModel()` lives as
long as the card shows.

```typescript
const forecastTool: ChatToolSpec = {
    name: 'get_forecast',
    description: 'Get the 5-day forecast for a city.',
    parameters: {type: 'object', properties: {city: {type: 'string'}}, required: ['city']},
    displayName: 'Forecast',
    icon: Icon.sun(),
    summary: ({input}) => input?.city,
    execute: ({city}) => XH.weatherService.getForecastAsync(city),
    renderer: part =>
        part.state === 'output-available' ? forecastChart({data: part.output}) : null
};

// A component of your own, with a model it owns.
interface ForecastChartProps extends HoistProps {
    data: PlainObject[];
}

const forecastChart = hoistCmp.factory<ForecastChartProps>(({data}) => {
    const impl = useLocalModel(() => new ForecastChartModel(data));
    return chart({model: impl.chartModel});
});
```

A tool with `display: 'inline'` shows its renderer's output as part of the reply, with no card. The
output is the call's progress. A quiet status line shows under it only while the input streams or
waits for approval, and after the call fails or is denied. A failed call shows a short message for
the user, with the error for the model behind a "View input" toggle that appears on hover. A
denied call renders no output. A call that waits for approval renders none either, unless the
tool sets `preview: true` to show what it will display. A `ChatUiCatalog` declares its
tools this way - see [`/genui/`](../../../genui/README.md).

An interactive tool needs a renderer, because the default card has no controls for an answer.
`ChatModel` logs a warning for an interactive tool with no `renderer`. While a call waits for
its answer, the card shows "Waiting for you". See
[`/core/`](../../../core/README.md#let-the-user-answer-a-tool-call) for the full pattern.

### Render data parts

A data renderer receives the data part and the same render context, and renders as the part's
own component. Register it by `dataType` in `ChatModelConfig.dataRenderers`.

```typescript
new ChatModel({
    transport,
    dataRenderers: {
        'price-chart': (part, {chatModel}) =>
            priceChart({symbol: part.data.symbol, onAsk: q => chatModel.sendAsync(q)})
    }
});
```

### Allow images

Markdown images in a reply do not load by default. Each shows as a link with its alt text, and
the user can open it. Loading an image sends a request to its URL. A reply that a prompt
injection wrote can hide data in that URL, so the request leaks the data the moment the image
renders. A link needs a click, so the user sees the URL first.

Allow images that you trust with a function, or all images with `true`:

```typescript
// ✅ Do: Allow images from your own server only
chatPanel({model: chatModel, allowImages: src => src.startsWith('/api/charts/')});

// ❌ Don't: Allow every image in a chat that reads untrusted content
chatPanel({model: chatModel, allowImages: true});
```

The same setting covers file parts with an image at a URL, such as a file a backend sends with
`xh.chat.file`. Their chips show an icon in place of a thumbnail until allowed. An image with
inline `data`, such as the user's own attachment, always shows, as it loads nothing.

`ChatPanel` passes `allowImages` to the message list. On a custom layout, set it on
`chatMessageList`.

### Show citation markers and open sources in the app

Turn on `citationMarkers` when the backend writes `[n]` markers in its text. Give each source a
`marker` if the numbers do not follow the order of the sources, and a `sourceType`. In a
`ChatWorkspace`, give the model a `documentRenderer`, and a document's marker opens it in the side
panel:

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

Outside a workspace, pass `onSourceClick` to open a source in the app. A document with no `url`
is then clickable too.

```typescript
chatPanel({
    model: chatModel,
    citationMarkers: true,
    onSourceClick: this.openSource
});

// An arrow function field, so that it stays the same function.
openSource = (source: ChatSourcePart) => {
    this.documentViewerModel.open(source.metadata.documentId, source.metadata.page);
};
```

### Render math and other markdown extensions

`markdownPlugins` adds remark and rehype plugins to the markdown of assistant text and
reasoning, after the kit's own. The kit takes no math dependency. To render math with KaTeX, add
`remark-math`, `rehype-katex` and `katex` to the app:

```typescript
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

const MATH_PLUGINS: ChatMarkdownPlugins = {remark: [remarkMath], rehype: [rehypeKatex]};

chatPanel({model: chatModel, markdownPlugins: MATH_PLUGINS});
```

Define the object once, at module level, so the markdown blocks stay memoized.

### Replace markdown elements

`markdownComponents` swaps how markdown elements render in assistant messages, keyed by tag
name. The kit renders fenced code with `ChatCodeBlock` by default, and your entries merge over
that default. Pass a module-level constant, so the markdown blocks stay memoized.

The kit also supplies `table`. A table of up to 100 body rows renders plain. A longer one renders
as a card with its first 100 rows, the footer "Showing 100 of N rows", and Show All. Set
`ChatKit.defaults.markdownTableMaxRows` to change the limit. The card has no side panel view,
because a markdown table carries no result set. A `table` entry replaces both.

```typescript
const MARKDOWN_COMPONENTS: ChatMarkdownComponents = {
    table: ({children}) => div({className: 'my-app-table', items: children})
};

chatPanel({model: chatModel, messageListProps: {markdownComponents: MARKDOWN_COMPONENTS}});
```

### Make the chat collapsible or resizable

`ChatPanel` does not take a `modelConfig`, because its model is the `ChatModel`. Wrap it in a
panel that owns a `PanelModel`:

```typescript
panel({
    modelConfig: {side: 'right', defaultSize: 420, minSize: 320},
    item: chatPanel({model: chatModel, flex: 1})
});
```

### Show a reply's status

`ChatStatusCue` draws a status in the kit's words, icon and color. `ChatElapsed` ticks the time
taken. Use them to show a reply's status in a layout of your own, such as a docked header.

```typescript
const MyReplyStatus = hoistCmp.factory<{chatModel: ChatModel}>(({chatModel}) => {
    const {lastMessage: message, lastActivityAt, stallAfterMs} = chatModel;
    if (!message?.isStreaming) return null;

    const status = getChatReplyStatus({message, lastActivityAt, stallAfterMs});
    return hbox(chatStatusCue({status}), chatElapsed({startedAt: message.createdAt}));
});
```

`getChatReplyStatus()` reads the clock at each call. Nothing observable changes while a reply is
quiet, so to show a stall, render the component again each second, for example from a
`useEffect` interval. `ChatElapsed` ticks on its own.

### Build a custom layout

For a layout of your own, compose `chatMessageList` and `chatComposer` directly. Both find the
`ChatModel` in context, or take it as `model`.

```typescript
vframe({
    items: [
        chatMessageList({model: chatModel, assistantName: 'Analyst'}),
        toolbar(chatComposer({model: chatModel.composerModel, flex: 1}))
    ]
});
```

## Properties/API Reference

See each component's source for the full doc comments.

### ChatPanel

Accepts all `PanelProps` except `model`, `modelConfig` and `modelRef`.

| Property | Type | Description |
|----------|------|-------------|
| `model` | `ChatModel` | The chat to render. Found in context if not given. |
| `emptyState` | `ReactNode` | Content for a conversation with no messages, in the list, in place of the default. The composer stays at the bottom. |
| `emptyStateProps` | `{title, text, icon}` | Heading, supporting text and icon of the default empty state. |
| `suggestions` | `Array<ChatSuggestion \| string>` | Prompt cards under the centered composer of the default empty state. |
| `allowImages` | `boolean \| (src) => boolean` | Model-written images, and file images at a URL, to load. Default false. |
| `citationMarkers` | `boolean` | True to render `[n]` markers in assistant text as buttons for their sources. Default false. |
| `onSourceClick` | `(source, context) => void` | Called when the user clicks a source or a marker. Default opens a document in the side panel when one is in reach, and a web page in a new tab. Pass a stable function. |
| `markdownPlugins` | `ChatMarkdownPlugins` | Remark and rehype plugins for assistant text and reasoning. Pass a stable object. |
| `composerProps` | `ChatComposerProps` | Props for the composer. |
| `messageListProps` | `ChatMessageListProps` | Props for the message list. |

### ChatMessageList

Accepts layout props, `testId`, `ref` and other box props.

| Property | Type | Description |
|----------|------|-------------|
| `model` | `ChatModel` | The chat to render. Found in context if not given. |
| `host` | `ChatTranscript` | A read-only conversation to render in place of a `ChatModel`. |
| `emptyState` | `ReactNode` | Content for a conversation with no messages. |
| `suggestions` | `Array<ChatSuggestion \| string>` | Prompt cards for the default empty state. They fill the chat's composer, and show only for a `ChatModel`. |
| `assistantName` | `string` | Name on assistant messages. Default `'Assistant'`. |
| `assistantIcon` | `ReactElement` | Icon on assistant messages. Default from `ChatKit.defaults.assistantIcon`. |
| `markdownComponents` | `ChatMarkdownComponents` | Markdown element overrides. Pass a stable object. |
| `allowImages` | `boolean \| (src) => boolean` | Model-written images, and file images at a URL, to load. Default false. |
| `citationMarkers` | `boolean` | True to render `[n]` markers in assistant text as buttons for their sources. Default false. |
| `onSourceClick` | `(source, context) => void` | Called when the user clicks a source or a marker. Default opens a document in the side panel when one is in reach, and a web page in a new tab. Pass a stable function. |
| `markdownPlugins` | `ChatMarkdownPlugins` | Remark and rehype plugins for assistant text and reasoning. Pass a stable object. |
| `messageActions` | `(message, context) => ReactNode[]` | Buttons after Copy, Edit, Regenerate, Undo and the thumbs. Edit and Regenerate show only while the chat's `allowEdit` and `allowRegenerate` are true. Pass a stable function. |
| `messageHeaderItems` | `(message, context) => ReactNode[]` | Items in an assistant message's header. Pass a stable function. |

Each message is a focusable `article`, named for its author and time. With a message focused, Up
and Down move to the one before or after. Escape stops a reply in progress while focus is in the
list, for a `ChatModel`, then focuses the composer. See [Keyboard](#keyboard). Its action
bar is a `role="group"` named "Message actions", with each action a tab stop. Regenerate moves
focus to the composer.

### ChatComposer

Accepts layout props, `testId`, `ref` and other box props.

| Property | Type | Description |
|----------|------|-------------|
| `model` | `ChatComposerModel` | The draft to edit. Default the `composerModel` of the `ChatModel` in context. A composer model over another `ChatComposerHost` needs no `ChatModel`. |
| `placeholder` | `string` | Prompt in the empty input. Default `'Send a message...'`, or `'Or tell the assistant what to do instead...'` while a reply waits for the user. |
| `maxRows` | `number` | Rows the input grows to before it scrolls. Default 8. |
| `topItems` | `ReactNode` | Content above the input, inside the composer. |
| `leftItems` | `ReactNode` | The left slot of the bar, for pills such as `chatComposerPill` and `chatScopeChip`. |
| `rightItems` | `ReactNode` | The right slot of the bar, before the attach and Send buttons. |
| `autoFocus` | `boolean` | True to focus the input on mount. |

Enter sends, and Shift+Enter starts a new line. An Enter that confirms an IME candidate does not
send. Up arrow in an empty input recalls the last user message. While a reply streams, Send
becomes a Stop button, and Escape stops too, for a `ChatModel`. Focus returns to the
input after Stop. A disabled Send with a reason - blocked, offline, or waiting to retry - sits
in a focusable wrapper, so that keyboard users reach its tooltip. The composer names any file it
cannot attach under the attachments, such as one of the wrong type, too large, or over the limit.
The names come from the composer model's `attachmentErrors`, and stay until the user dismisses
them or adds more files. Screen readers hear them once, through `chatAnnouncer`.

### ChatMessageView

Renders one message. `ChatMessageList` renders one per message, and passes it the props above.
Use it directly only for a list of your own.

| Property | Type | Description |
|----------|------|-------------|
| `message` | `ChatMessage` | The message to show. |
| `host` | `ChatTranscript \| ChatModel` | The conversation that holds the message. A transcript shows it read-only. |
| `assistantName`, `assistantIcon`, `markdownComponents`, `allowImages`, `citationMarkers`, `onSourceClick`, `markdownPlugins`, `messageActions`, `messageHeaderItems` | - | As on `ChatMessageList`. |

### Part components

| Component | Props | Use it to |
|-----------|-------|-----------|
| `ChatToolCall` | `part`, `context` | Show a tool call row, for example inside a renderer of your own. Reads tool specs and approvals from `context.chatModel`. |
| `ChatTimeline` | `message`, `host`, `parts`, `pinned`, `context`, `isFollowed`, `isLast` | Show a reply's activity timeline in a layout of your own. `parts` and `pinned` default to the reply's first timeline block. `isFollowed` says the answer has started below it. |
| `ChatClearButton` | `chatModel`, and any `ButtonProps` | Clear the conversation, from a panel header. |
| `ChatReasoning` | `part`, `markdownComponents`, `markdownPlugins`, `allowImages` | Show a reasoning part. |
| `ChatSources` | `sources`, `defaultExpanded`, `onSourceClick` | Show a list of sources. Each shows its `marker`, else its position. |
| `ChatNoAnswer` | `part`, `onEditQuestion` | Show a fixed "not found" reply, for example inside an app's own renderer for `xh.chat.noAnswer`. |
| `ChatSidePanel` | `model`, `panelProps` | Frame the open request of a `ChatSidePanelModel`: title, Back, Close, and the content - the app's viewer with its status, or the full table or chart of a result card. |
| `ChatCodeBlock` | `content`, `language`, `isStreaming` | Show code in a card with a copy button. A finished block over 20 lines shows its first 20, with a button for the rest. |
| `ChatFileChip` | `file`, `onRemove`, `allowImages` | Show a file, with a remove button when `onRemove` is set. An image at a URL shows a thumbnail only if `allowImages` permits it. |
| `ChatEmptyState` | `icon`, `title`, `text`, `suggestions`, `composerModel` | Welcome the user to an empty chat. |
| `ChatSuggestions` | `suggestions`, `onSelect`, `composerModel` | Show prompt cards that fill the composer: `composerModel`, else the `ChatModel`'s. `onSelect` replaces the fill. With neither, it renders nothing. |
| `ChatStatusRegion` | `model`, `assistantName` | Show the thread's next action above a composer, in a custom layout. |
| `ChatComposerPill` | `text`, `icon`, `count`, `menuItems`, `content`, `tooltip` | Add a pill to the composer's left slot. |
| `ChatScopeChip` | `documents`, `runOption`, `value`, `onChange`, `searchThreshold`, `tooltip` | Scope the next question to some documents. Default binds `runOptions.documentIds`. |
| `ChatStatusCue` | `status`, `label`, `stalledMs`, `showSpinner` | Show a reply's status as its icon and words. `label` replaces the words, for example with a tool's verb. `showSpinner: false` drops the spinner when another element nearby shows one. |
| `ChatElapsed` | `startedAt`, `endedAt` | Show the time taken, in whole seconds from 1 s, as `6s` or `1m 02s`. Ticks each second until `endedAt` is set. |

## Theming

Each `--xh-chat-*` variable defaults to a value built from Hoist's theme variables, so the chat
follows the app's light or dark theme. Only `--xh-chat-meta-text-color` has its own dark value.
The defaults live in `styles/vars.scss`, on `body`, beside Hoist's own variables.

To change a variable, set it on `body.xh-app`, as with Hoist's own variables. A size or a time
carries its unit.

```scss
// ✅ Do: Override the --xh-chat-* variable on body.xh-app, with its unit
body.xh-app {
  --xh-chat-turn-gap: 32px;
  --xh-chat-user-bg: var(--xh-intent-primary-trans1);
}

// ❌ Don't: Leave off the unit, or set a variable that other variables derive from on a descendant
.my-app-assistant {
  --xh-chat-turn-gap: 32;
}
```

A variable set on a descendant reaches only the CSS that reads it directly. Variables derived from
it keep the values computed on `body`. Set leaf variables there, such as colors, and set sizes
that others derive from on `body.xh-app`.

| Group | Main variables | Default |
|-------|----------------|---------|
| Type | `--xh-chat-font-size` | `--xh-font-size` (13px) |
| | `--xh-chat-line-height` | `1.5` |
| | `--xh-chat-heading-font-size` | `--xh-font-size-large`, for markdown H1 and H2 |
| | `--xh-chat-code-font-size` | `--xh-font-size` minus 1 |
| | `--xh-chat-meta-font-size` | `--xh-font-size` times 0.9 |
| Layout | `--xh-chat-column-max-width` | `1100px`, for the thread, cards and composer |
| | `--xh-chat-prose-max-width` | `640px`, for markdown text |
| | `--xh-chat-side-pad` | `--xh-pad-double` (20px) |
| | `--xh-chat-turn-gap` | `24px`, between messages |
| | `--xh-chat-part-gap`, `--xh-chat-process-gap` | `--xh-pad`, `--xh-pad-half` |
| | `--xh-chat-part-header-height` | `28px`, for card header strips |
| | `--xh-chat-user-max-width` | `75%`, for the user bubble |
| | `--xh-chat-border-radius` | `--xh-border-radius` (4px), for every frame |
| Color | `--xh-chat-bg`, `--xh-chat-text-color` | `--xh-bg`, `--xh-text-color` |
| | `--xh-chat-meta-text-color` | `--xh-blue-gray`, `--xh-text-color-muted` in dark |
| | `--xh-chat-user-bg`, `--xh-chat-user-text-color` | `--xh-bg-alt`, `--xh-text-color` |
| | `--xh-chat-part-border-color` | `--xh-border-color` |
| | `--xh-chat-part-header-bg` | `--xh-bg-alt` |
| | `--xh-chat-code-bg` | `--xh-grid-bg-odd` |
| Status | `--xh-chat-busy-color` | `--xh-intent-primary-text-color` |
| | `--xh-chat-attention-color` | `--xh-card-primary-color` |
| | `--xh-chat-success-color`, `--xh-chat-warning-color`, `--xh-chat-error-color` | Hoist's intent text colors |
| Composer | `--xh-chat-composer-bg` | `--xh-input-bg` |
| | `--xh-chat-composer-border-color` | `--xh-border-color` |
| | `--xh-chat-composer-focus-border-color` | `--xh-form-field-focused-border-color` |

`styles/vars.scss` also declares the variables of each feature area, with a comment per group:
`--xh-chat-timeline-*`, `--xh-chat-citation-*`, `--xh-chat-viewer-*`, `--xh-chat-card-*`,
`--xh-chat-sidebar-*`, `--xh-chat-composer-*` and the motion timings.
`--xh-chat-viewer-page-bg` and `--xh-chat-viewer-page-text-color` are for the app's document
renderer, which draws the pages in the side panel.

Layout widths are not CSS variables. The workspace sets the widths of its sidebar and side panel
by breakpoint, and the user can resize both. These widths feed the layout math, so they live in
code.

### Compact density

Add the `xh-chat--compact` class to a parent of the chat for a narrow host, such as a docked
side panel. It sets the side padding to `--xh-pad` (10px), the user bubble width to 85%, and the
chart height to 160px.

### Reduced motion

Every moving cue in chat has a static twin. The twins apply when the browser reports
`prefers-reduced-motion: reduce`, or inside an element with the `xh-chat--reduced-motion` class.
Add that class to a parent of the chat to show the twins whatever the browser reports.

| Cue | Static twin |
|-----|-------------|
| Spinner | A static stopwatch icon. The words and the ticking time still say the reply is busy. |
| Caret | Solid while text arrives, then the same dimmed rest. |
| Skeleton shimmer | No band. |
| Reasoning label | No sweep. |

Hoist's own `Spinner` keeps spinning under reduced motion on purpose, because Citrix sessions
often report it. To keep that behavior in chat too, set `ChatKit.defaults.reducedMotionSpinner`
to `'spin'`.

Spacing inside the components scales with Hoist's `--xh-pad`, so a denser app gets a denser
chat. Class names follow BEM under `xh-chat-`, for example `xh-chat-message__bubble`.

## Extension Points

- **Composer slots** - `topItems`, `leftItems` and `rightItems` on `ChatComposer`.
- **Empty state** - `emptyState` and `suggestions` on `ChatPanel` and `ChatMessageList`.
- **Message actions and header items** - `messageActions` and `messageHeaderItems` on
  `ChatMessageList`, passed through `ChatPanel.messageListProps`.
- **Tool display** - `displayName`, `icon`, `summary`, `renderer` and `display` on
  `ChatToolSpec`. See [`/core/`](../../../core/README.md#chattoolspec).
- **Data renderers** - `ChatModelConfig.dataRenderers`, for app content and generative UI.
- **Sources** - `citationMarkers` for inline `[n]` markers, `onSourceClick` to open a source in
  the app, and a `ChatSidePanelHost` in model context to open documents beside the chat.
- **Markdown** - `markdownComponents` for element overrides, `markdownPlugins` for remark and
  rehype plugins, and `allowImages` for the image policy.
- **Theme** - the `--xh-chat-*` variables above, `xh-chat--compact`, `xh-chat--reduced-motion`,
  and the BEM class names.

## Common Pitfalls

### Passing a new function or object on every render

`messageActions`, `messageHeaderItems`, `onSourceClick`, `markdownComponents` and
`markdownPlugins` are props of memoized components. A new value on each render re-renders every
message. A new `markdownComponents` or `markdownPlugins` also re-parses every markdown block.

```typescript
// ✅ Do: An arrow function field on your model, or a module-level constant
messageListProps: {messageActions: model.renderActions}

// ❌ Don't: An inline function, new on every render
messageListProps: {messageActions: m => [feedbackButtons(m)]}
```

### Reading the message in a renderer that does not need it

`chatModel.getMessage(messageId)` returns the latest message, and the renderer then re-renders
on every streamed change. Read the `part` you are given. Read the message only for data the part
does not hold.

### Breaking the rules of hooks in a renderer

A renderer that calls hooks must call the same hooks on every render. Do not return early
before a hook. Put a renderer with state into a component of its own, as `forecastChart` does
above, and return that component from the renderer.

### Creating a model inside a renderer

A renderer runs on each render of its part. A model created with `new` in the renderer leaks
one instance per render. Create it with `useLocalModel()` in a component, so Hoist destroys it
when the part unmounts.

### Expecting a collapsed card to keep its renderer's state

The body of a tool card mounts only while the card is open. Closing the card unmounts the
renderer, along with any local state. Keep state that must survive in a model outside the
renderer.

## Related Packages

- [`/core/`](../../../core/README.md) - `ChatModel`, messages, parts, tools and the composer model
- [`/cmp/markdown/`](../../../cmp/markdown/README.md) - the streaming markdown renderer
- [`/genui/`](../../../genui/README.md) - the generative UI catalog, shown as inline tool calls
- [`/desktop/cmp/genui/`](../genui/README.md) - the built-in grid, chart, metrics and card
- [Protocols](../../../docs/protocols.md) - generative UI protocols and data parts
- [`/transport/`](../../../transport/README.md) - transports and codecs
- [Architecture](../../../docs/architecture.md) - layers, the flow of a turn, render performance
- Hoist `Panel` (`@xh/hoist/desktop/cmp/panel`) - the chrome around `ChatPanel`
