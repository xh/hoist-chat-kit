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
  It opens to a tree of rows, with sub-agents, batches and narration.
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
│   │   ├── header                      # Name, status, time, time taken, Retried, header items
│   │   ├── parts, in order:
│   │   │   ├── process block           # Reasoning and tool rows, at the process gap
│   │   │   │   ├── ChatReasoning       # "Thought for 12s" disclosure
│   │   │   │   ├── ChatToolCall        # A 28px row that opens
│   │   │   │   └── tool call group     # "Used 3 tools", opens to show each call
│   │   │   ├── text                    # Markdown with citation chips, or textRenderer
│   │   │   ├── ChatToolCall (inline)   # Renderer output, as part of the reply
│   │   │   ├── files                   # ChatFileChip row
│   │   │   └── data                    # dataRenderers, or ChatNoAnswer
│   │   ├── how it ended                # Failed row, "Stopped", or the length cut
│   │   ├── ChatSources                 # Sources list, in marker order
│   │   ├── action bar                  # Copy, Regenerate, thumbs, messageActions
│   │   └── feedback form               # Under the action bar, for a comment
│   └── announcer regions               # Hidden live regions that read finished replies
├── ChatStatusRegion                    # One line: the thread's next action, such as Try Again
└── ChatComposer                        # uses(ChatComposerModel), or the chat's composerModel
    ├── attachment tray                 # File chips, then any files left out
    ├── input                           # startItems, then text that grows to 8 lines
    ├── bar                             # leftItems pills | rightItems, attach, Send or Stop
    └── bottomItems                     # A row of its own under the input, in both layouts
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
that part fails. It shows "This part could not be displayed." with Try Again, which renders the
part once more, and the error message in a Details disclosure. Hoist's exception handler logs the error, with no alert. A streaming part that
failed renders again when its state changes, for example when its input completes. A data part
renders again when it is replaced.

The boundary is `ChatErrorBoundary`, with a `subject` of `message` or `part` and a `resetKey`.
An app that hosts a kit component outside the message list can wrap it the same way.

### Scroll behavior

`ChatMessageList` follows a streaming reply by staying scrolled to the bottom. A wheel or scroll
up releases the list, so the user can read back while the reply streams. A round button then
offers a way back down. Scrolling back to the bottom, or sending a message, sticks the list
again. Content that grows when no reply streams, such as a tool card the user opens, stays in
place. In the last message of a list scrolled to the bottom, the list follows it down instead,
so that it opens into view.

### Live cues

While a turn runs, the reply's header shows its status and the time taken so far, as "Thinking 1s",
"Writing 6s" or "Running tools 12s". A list with `showMessageHeader: false` has no such line, and
shows no "Retried" or failed tools. Until its first content arrives, the reply shows the same live
status in its body instead. Set `ChatKit.defaults.workingCue` to show a cue of your own there, such
as a brand loader. Each status has one icon, one label and one color, drawn by `ChatStatusCue` from
one table. The status comes from `getChatReplyStatus()` in
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

A frame of the app's own binds the workspace's shortcuts with `getChatHotkeys()`. It returns
hotkeys for the actions given, keyed from `ChatKit.defaults.shortcuts`, for a Panel's `hotkeys`
or Hoist's `useHotkeys`. A `ChatPanel` inside the frame still binds `focusComposer` itself.

```typescript
panel({
    hotkeys: getChatHotkeys({
        newChat: () => threadsModel.newThread(),
        toggleSidebar: () => sidebarModel.toggleCollapsed()
    }),
    items: [sidebar(), conversation()]
});
```

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
Three rows show, and the rest sit behind "Show N More". To change that for every reply, set
`ChatSources.defaults.visibleRows` at startup, or null to show every row. A source that a citing
reply never cites takes no number and no row.

The heading opens and closes the list, as a tool call's row does. Closed, it still gives the
count, such as "Sources · 4". The list starts open. Set `startCollapsed`, or
`ChatSources.defaults.startCollapsed` at startup, to start every list closed. A citation marker
still opens its source while the list is closed.

```typescript
// ✅ Do: Start the lists in every reply closed, and show every row once one opens
ChatSources.defaults.startCollapsed = true;
ChatSources.defaults.visibleRows = null;
```

Every row has the same layout: the number, an icon, the title and a meta line. A source's
`sourceType` sets the icon, the meta line and what a click on the title does:

| `sourceType` | Icon and meta | Title click |
|---|---|---|
| `document` | File-type icon, then `metadata.fileName` and `metadata.page` | Opens the side panel when one is in reach, else `onSourceClick`, else its URL in a new tab |
| `url` | Globe, then the host | Opens a new tab, or `onSourceClick` in its place |

A source with `metadata.meta`, a string or an array of strings, shows that as its meta line in
place of the file name and page, or the host. `title` on the list replaces its "Sources" heading.
A row's title and meta line carry their full text as a tooltip, for when either is cut short.
Set `showNumbers` false, or `ChatSources.defaults.showNumbers`, to leave the numbers out, for
replies whose text cites no sources.

A row that opens a new tab shows an external-link icon just before its host: beside the title
when compact, so that a long title truncates first, and leading the meta line when roomy. Its
title tells screen readers "(opens in a new tab)". A document that opens in the side panel, and
any row an `onSourceClick` handles, shows no icon. Set `showExternalIcon` false, or
`ChatSources.defaults.showExternalIcon`, to leave the icon out.

Rows are compact by default: one line each, with the meta line beside the title. Set `compact`
false for a roomier list in a frame, with hairlines between rows, a 28px icon tile and the meta
line under the title. A long title wraps to two lines. To change the layout for every reply, set
`ChatSources.defaults.compact` at startup. Five variables size the roomy list:
`--xh-chat-source-list-bg`, `--xh-chat-source-list-border-radius`,
`--xh-chat-source-row-padding`, `--xh-chat-source-icon-size` and `--xh-chat-source-icon-bg`.
`--xh-chat-source-icon-color` colors a row's globe or plain file icon in both layouts. It defaults
to the text color. File types that Hoist colors, such as PDF and Word, keep Hoist's colors.

```typescript
// ✅ Do: Set the layout once, at startup, for the lists in every reply
ChatSources.defaults.compact = false;

// A list the app renders itself takes the prop
chatSources({sources: webResults, title: 'Web results', compact: false});
```

A row with an excerpt expands to show it on a click on its chevron, or anywhere else on the row
outside the title. For the keyboard, the title and the chevron are the row's controls.

A Ctrl or Cmd click on a title opens the source's URL in a new tab. Only `http` and `https` URLs
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
tools with `display: 'timeline'`, and for activities with `display: 'timeline'`, such as skills
the agent loads, in place of their rows. Calls to `card` tools, and reasoning
alone, keep the process rows. See [Tool display](../../../core/README.md#tool-display).

The block is one 28px line. Its height never changes, and it changes only its words and its icon:

| State | Line | Meta |
|-------|------|------|
| Running | The latest finished sentence of narration, else the running call. "Running 3 steps" while calls run at once. | Step count, time so far, failures |
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

An agent that recovers from failed calls on its way to an answer can leave the count out of the
done summary. Set `ChatTimeline.defaults.showSummaryFailureCount` false at startup. The done
summary then shows no failure count, open or closed, and the reply's announcement leaves it out
too. In the open block, each failed step still shows as failed, with its error. A running line
still counts failures.

```ts
ChatTimeline.defaults.showSummaryFailureCount = false;
```

The block starts collapsed, and never opens or closes by itself. The one exception is a call that
waits for the user. It shows under the line whether or not the block is open, and the block frames
itself in the attention color:

- **Approval** - the approval panel, with Allow and Deny. They call the chat's
  `approveToolCallAsync()` and `denyToolCallAsync()`, as a tool row does. A transcript shows no
  approval panel.
- **An answer** - a call to an interactive tool shows as its tool call card, with the tool's
  `renderer` open. The user answers through the renderer, which passes the answer to the chat's
  `addToolOutputAsync()`. Each waiting call has its own card. The call's row in the tree does
  not open while the card shows. Once answered, the card leaves, focus inside it moves to the
  reply, and the row opens to the renderer like any other call.

The timeline has no controls of its own for a question. A browser tool asks through its
`renderer`. A server agent asks through AG-UI interrupts, in the panel at the foot of the reply.
See [Answer an agent's questions](#answer-an-agents-questions).

Open, the block shows a tree of rows:

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
- **Activities** - an activity that is not a tool call, such as a skill the agent loads, shows
  as a row with its icon, title and summary, and no time. It opens to the type's data renderer,
  or to its data. While it is the newest row, the line names it. See
  [Show an agent's skills](#show-an-agents-skills).
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

#### Show an agent's skills

A skill the agent loads, or any other activity that is not a tool call, shows in the same block
as the calls, as their peer. The backend sends it as an AG-UI `ACTIVITY_SNAPSHOT`, with an
`activityType` of the app's own, and a `subagentRunId` when a sub-agent loaded it. The app gives
the chat a `ChatActivitySpec` for the type, with `display: 'timeline'`:

```typescript
new ChatModel({
    transport,
    activities: [
        {
            dataType: 'skill',
            display: 'timeline',
            displayName: 'Loaded skill',
            summary: part => part.data.skillName,
            noun: 'skill'
        }
    ]
});
```

The done line then reads "Used 5 tools, 2 skills and 1 agent". A skill with a `subagentRunId`
nests under its sub-agent's row. One whose sub-agent is unknown stays at the top level. A
transcript gives its specs through `getActivitySpec`. `activityEvents()` scripts an activity for
`ScriptedChatTransport`. See
[Show an agent's activities](../../../core/README.md#show-an-agents-activities).

#### Show an agent's plan

The timeline does not read a plan or a to-do list from a tool's data. No protocol defines one.
An app that shows a plan renders it in one of two ways:

- **A plan tool** - give the tool `display: 'inline'` and a `renderer` that draws the plan from
  the call's input or output. The plan then shows in the reply, in the app's own design.
- **An AG-UI activity** - have the agent send the plan as an `ACTIVITY_SNAPSHOT`, and register a
  data renderer for its `activityType`. See
  [Render data parts](../../../core/README.md#render-data-parts).

```typescript
const planTool: ChatToolSpec = {
    name: 'update_plan',
    display: 'inline',
    renderer: ({input}) => planList({steps: input?.steps ?? []})
};
```

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
`startItems` leads the input row, before the text, such as a brand mark. It breathes while a reply
runs - see [Motion](#motion). To animate it yourself, pass `breatheStartItems: false`, and style it
under the composer's `xh-chat-composer--busy` class. `layout: 'inline'` puts
the bar after the text, in the same row, for a one-row composer. As the text grows, start items
and the bar stay level with its last line. In a narrow composer, pills give way before the text.

```typescript
chatPanel({
    model: chatModel,
    composerProps: {
        placeholder: 'Ask about this dashboard...',
        maxRows: 6,
        leftItems: [agentPill(), chatScopeChip({options, noun: 'document', runOption: 'documentIds'})],
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

`chatComposerPill` is a small chip for the left slot or the composer's `bottomItems`. It shows an
icon, its words, a count and a chevron, and opens a menu or a popover. Bind its choices to
`chatModel.runOptions`, so that each turn records them and a change never reaches a reply in
progress.

The menu opens upward, over the thread. While `ChatPanel` shows the composer centered in an empty
chat, the menu opens downward, so that it does not cover the composer. A menu with no room on its
side opens on the other. The menu lines up with the pill's start edge. For a pill at the end of
its row, such as a model picker on the right of `bottomItems`, set `popoverAlign: 'end'`.

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

Set `active` to show a setting that is on, such as a tool the user turned on. Set `disabled` for a
setting that cannot change now, with a `tooltip` that says why. A disabled pill keeps its tab stop,
so keyboard users reach the tooltip, and it opens nothing.

`onOpenChange` is called as the menu or popover opens and closes, the place to load fresh choices.
`content` as a function runs on each render, so it is no place for a fetch. `popoverClassName`
adds to the popover's own class, for example for a type scale.

### Choose what a question uses

`chatScopeChip` lets the user choose some of a set of options for the next question, such as the
documents to search, or the agents, skills or tools to use. The app supplies the `options`, each
with an `id`, a `name` and an optional `icon`, and names their kind with `noun`. The popover lists
the options as checkboxes, with a search box for a long list, Select All and Clear. Its rows
follow Hoist's menus. A name too long for the popover ends in an ellipsis, with the full name in a
tooltip. To widen the popover, set the CSS variable `--xh-chat-scope-popover-width`, which
defaults to 320px.

The selection is the checked options, and an empty selection means none. To start with every
option on, pass every id. The chip reads "All tools" with every option checked, "No tools" with
none, and else "Tools" with the count.

```typescript
chatPanel({
    model: chatModel,
    composerProps: {
        leftItems: chatScopeChip({
            options: this.tools,
            noun: 'tool',
            icon: Icon.tools(),
            runOption: 'toolIds'
        })
    }
});
```

An option can carry more on its row:

- `secondaryText` - short text at the end of the row, such as "Required for skill".
- `info` - content of a tooltip on an info icon at the end of the row.
- `disabled` - true to lock the option as it is, checked or not. Select All and Clear leave it
  alone. Put a required option's id in the selection to show it checked.

The chip writes the checked ids to `chatModel.runOptions` under `runOption`. Each question records
a copy as `metadata.runOptions`, and a retry, regenerate or edit re-runs with that copy. Under
`ChatThreadsModel`, the selection belongs to the thread, and a thread opens with the selection of
its last question. To keep the selection in your own state, pass `value` and `onChange` instead
of `runOption`.

The chip takes the pill's `disabled`, `onOpenChange`, `popoverClassName` and `popoverAlign`, and
they work as they do on `chatComposerPill`. For example, disable the chip while its options load,
and refresh them in `onOpenChange`.

Add your own content to the panel with `topItems`, above the list, and `bottomItems`, below it and
above Select All and Clear. Each takes content, or a function that gets a `close` function. Close
the popover before a link navigates:

```typescript
chatScopeChip({
    options: skills,
    noun: 'skill',
    value: model.skillIds,
    onChange: ids => model.setSkillIds(ids),
    topItems: model.providerSkillsDown ? 'Provider skills unavailable' : null,
    bottomItems: close =>
        button({
            text: 'Manage Skills',
            minimal: true,
            onClick: () => {
                close();
                model.openSkillSettings();
            }
        })
});
```

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

Set `showStopHint` false, or `ChatStatusRegion.defaults.showStopHint` at startup, to leave "Esc to
stop" out of the busy line and its tooltip. Esc still stops the reply. The default reaches the
region that `ChatPanel` renders:

```ts
ChatStatusRegion.defaults.showStopHint = false;
```

A chat with `allowRetry` false never offers Try Again, and never retries on its own. See
[Hide Edit, Regenerate and Try Again](../../../core/README.md#hide-edit-regenerate-and-try-again).

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
`ChatTranscript` as `host`: `messages`, plus optional `dataRenderers`, `catalog`, `getToolSpec`
and `getActivitySpec`. `ChatModel` implements it. The list renders every part, with Copy and any
`messageActions`. Calls to the catalog's tools show as their components, as in the live chat.
With `getToolSpec`, a call shows its tool's title, icon and summary, as in the live chat; without
it, the tool's name. With `getActivitySpec`, an activity such as a skill shows as a timeline row.
Without it, every data part shows inline. Edit, Regenerate, feedback, approvals and Stop need the
turn loop, so they show only for a `ChatModel`. Part renderers receive a context whose
`chatModel` is null.

```typescript
export class NotesModel extends HoistModel implements ChatTranscript {
    @observableRef accessor messages: ChatMessage[] = [];
}

chatMessageList({host: notesModel});
```

### Replace the empty state

`emptyStateProps` sets the heading, supporting text and icon of the default empty state. Its
`header` takes any content of the app's own, such as a product logo, to show above the heading,
with no kit styles. Its `belowComposer` content shows right under the centered composer, above
the suggestions, such as a line of help. Its `footer` content shows at the foot of the space
under the composer, such as a tagline or a note on what the assistant can see. The supporting
text is at the body font size, set by `--xh-chat-empty-state-text-font-size`. `suggestions` adds
prompt cards under the centered composer, each with an optional icon and `description`. A click on a suggestion fills the composer and focuses it, and never sends. The
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

Some replies cannot take feedback, such as a reply with no server id to attach a rating to. Pass
`canRate` to decide for each reply. A reply for which it returns false shows no thumbs, and hides
any rating it already has. The function cannot add thumbs to a reply that the kit leaves without
them.

```typescript
feedback: {
    submitAsync,
    canRate: message => message.metadata.serverId != null
}
```

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

With `allowChange: false`, a rating locks once it saves. The chosen thumb stays pressed, the other
disables, and "Add a comment" or the thumbs down form still sends a comment with the same rating.
A rating restored from history locks too. Until a save succeeds, the user can switch thumbs.

| Config | A thumbs down |
|---|---|
| `requireComment: true` | Saves nothing until the user sends a non-blank comment. The thumb shows pressed meanwhile. Cancel or Escape restores the earlier rating. |
| `requireComment: false` | Saves at once, and opens an optional form. The comment follows as an update. Cancel or Escape keeps the rating. |

Send enables once the comment has text. In the form, Enter adds a new line, and Ctrl/Cmd+Enter
sends. A counter shows from 90% of `maxCommentLength`, which null turns off. While the form sends, the
thumbs and the form disable, and Cancel goes, as the request is already on its way.

Failures show inline, never as a toast. A rating that fails to save un-presses, and "Couldn't save
rating" shows beside the thumbs for 8 s, with Retry. A form that fails to send keeps the comment,
with Retry. A server that refuses the comment itself, with a 400, 413 or 422 status, has its
reason shown under the field, with no Retry, as resending the same comment cannot work. After a
send, the form closes and focus returns to the thumb.

One form is open per chat. A thumb on another reply closes an empty form, but waits while the
open form has a draft. The chat holds the draft in `feedbackDrafts`, so it survives a scroll or a
new view of the message list. A `ChatThreadsModel` keeps it while the user is in another thread,
for the session. It goes when the comment is sent, when the form is cancelled, and when the chat
clears or loads another thread. Regenerate closes the form of the reply it replaces.

After a reload, the chosen thumb shows alone, from `metadata.feedback`. The comment does not come
back, so the reply shows no comment mark. The announcer reads "Feedback sent." on a save,
and reads a failure at once.

#### Collect feedback without a ChatModel

`ChatFeedbackControls` shows the same thumbs and comment form on their own, for a reply that the
app lays out itself. They behave as above. Pass the `message` and a `host`: a `ChatModel`, or a
`ChatFeedbackHost` of the app's own, for a conversation that runs elsewhere. The host gives the
conversation's id, the feedback saved on a message, and a submit that takes a `ChatFeedbackSpec`:

```typescript
class AnswerFeedbackModel extends HoistModel implements ChatFeedbackHost {
    @observableRef accessor ratings: Record<string, ChatFeedback> = {};

    constructor(readonly threadId: string) {
        super();
    }

    getFeedback(message: ChatMessage): ChatFeedback {
        return this.ratings[message.id] ?? null;
    }

    async submitFeedbackAsync(spec: ChatFeedbackSpec) {
        await XH.postJson({url: 'chat/feedback', body: spec});
        this.setRating(spec);
    }

    @action
    private setRating({messageId, rating, comment}: ChatFeedbackSpec) {
        this.ratings = {...this.ratings, [messageId]: rating ? {rating, comment} : null};
    }
}

chatFeedbackControls({message, host: answerFeedbackModel});
```

To put the app's own actions in the same bar, pass them as `items`. They lead the bar, with a
divider before the thumbs, as the message view sets its built-in actions apart. They take the
bar's quiet button style, and they show even while the reply cannot be rated, such as while it
streams.

```typescript
chatFeedbackControls({
    message,
    host: answerFeedbackModel,
    items: [chatCopyButton({getCopyText: () => message.text})]
});
```

The submit takes the rated message as a second argument, for a backend that needs the answer's
text: `submitFeedbackAsync(spec, message)`. The controls show a new rating while it saves.
Resolve the submit once saved, with `getFeedback`
then returning it, and reject if the save fails. The controls then show the saved rating again,
with Retry. A rejection with an `httpStatus` of 400, 413 or 422 counts as refused, as above.

Three members are optional. `feedbackSettings` takes `canRate`, `allowComment`, `requireComment`,
`clearable`, `allowChange` and `maxCommentLength`. `feedbackDrafts` with `setFeedbackDraft` keep the drafts in
the app, so a half-typed comment survives a new mount of its controls. Remove the drafts of
messages that go, as `ChatModel` does. Without them, the kit keeps a draft while its controls are
mounted. Either way, one form is open per host.
`messages` hides "Add a comment" once the user sends again. Without it, the link stays until the
next rating.

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

### Add message actions, such as feedback

`messageActions` adds buttons to each message's action bar, after the built-in ones: Copy,
Edit, Regenerate and the thumbs. The function receives the message and its render context, and
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

An inline tool with no `renderer` shows the call's output itself, once it has one. Text renders
as markdown, and any other value as JSON. This suits a tool whose result is the answer.

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

### Render reply text yourself

A model may write its reply in another language, such as OpenUI Lang, that the app draws with
that language's own renderer. Set `ChatModelConfig.textRenderer`. It renders each text part of a
reply, and narration in the activity timeline, in place of the kit's markdown. Return null to
render a part as markdown. Its output replaces the caret, citation chips and catalog tags too.

A text renderer runs as its part's own component, as a data renderer does, so it may call hooks.
Read `part.state` to tell streaming text from final text. Give Copy words with `getCopyText`, or
it copies the language's source. Return null from it to hide Copy. Screen readers hear a finished
reply's copy text, and no text without `getCopyText`. The activity timeline's line shows the
running step in place of the latest narration, as narration would show as source there.

```typescript
new ChatModel({
    transport,
    textRenderer: part =>
        isAppUi(part.text)
            ? appUiRenderer({source: part.text, isStreaming: part.state === 'streaming'})
            : null,
    getCopyText: message => (message.isAssistant ? toReadableText(message) : message.text)
});
```

A `ChatTranscript` takes the same `textRenderer` and `getCopyText`, so a read-only list draws
its text the same way.

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
`marker` if the numbers do not follow the order of the sources, and a `sourceType`. A source's
`marker` does not mean the text cites it: a backend may number its sources and write no markers.
The sources list then shows the numbers, and the option renders nothing inline. In a
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
that default. Pass a module-level constant, so the markdown blocks stay memoized. The kit's own
map is `CHAT_MARKDOWN_COMPONENTS`, for a `chatMarkdown` of your own outside the message list.

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
| `emptyStateProps` | `{header, title, text, icon, belowComposer, footer}` | Heading, supporting text and icon of the default empty state, and the app's own content above the heading, right under the centered composer, and at the foot of the space under it. |
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
| `messageActions` | `(message, context) => ReactNode[]` | Buttons after Copy, Edit, Regenerate and the thumbs. Edit and Regenerate show only while the chat's `allowEdit` and `allowRegenerate` are true. Pass a stable function. |
| `messageHeaderItems` | `(message, context) => ReactNode[]` | Items in an assistant message's header. Pass a stable function. |
| `showMessageHeader` | `boolean` | False to leave out each reply's header line, and all it holds: the name, live status, time, time taken, "Thought for", failed tools, "Retried" and header items. Until its first content arrives, a reply then shows its live status in its body, or `ChatKit.defaults.workingCue`. Default true. |

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
| `bottomItems` | `ReactNode` | Content below the input, inside the composer, in a row of its own in both layouts. |
| `startItems` | `ReactNode` | Content that leads the input row, level with the first line, such as a brand mark. |
| `leftItems` | `ReactNode` | The left slot of the bar, for pills such as `chatComposerPill` and `chatScopeChip`. |
| `rightItems` | `ReactNode` | The right slot of the bar, before the attach and Send buttons. |
| `autoFocus` | `boolean` | True to focus the input on mount. |
| `sendButtonProps` | `ChatComposerButtonProps` | How Send looks: `icon`, `text`, `intent`, `minimal`, `outlined`, and a `className` added to the kit's. The composer keeps what it does. A `text` label also names it for screen readers. Default a primary button with an up arrow. |
| `stopButtonProps` | `ChatComposerButtonProps` | How Stop looks, as `sendButtonProps` for Send. Default outlined, with "Stop". |
| `breatheStartItems` | `boolean` | False to keep `startItems` still while a reply runs. Default true. See [Motion](#motion). |
| `layout` | `'stacked' \| 'inline'` | `stacked` puts the bar of pills, attach and Send under the input. `inline` puts it after the input, in its row, for a one-row composer. Default `stacked`. |

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
| `showHeader` | `boolean` | As `showMessageHeader` on `ChatMessageList`. Default true. |

### Part components

`ChatSources`, `ChatCodeBlock`, `ChatCopyButton`, `ChatReasoning`, `ChatFeedbackControls`,
`ChatErrorBoundary` and the other building blocks need no model in context, so they render inside
another library's components. `chatMarkdown` cannot yet, nor can an open `ChatReasoning`, which
shows its text through it: Hoist's `Markdown`, which renders each block, looks for a model above
it.

| Component | Props | Use it to |
|-----------|-------|-----------|
| `ChatToolCall` | `part`, `context` | Show a tool call row, for example inside a renderer of your own. Reads tool specs and approvals from `context.chatModel`. |
| `ChatTimeline` | `message`, `host`, `parts`, `context`, `isFollowed`, `isLast` | Show a reply's activity timeline in a layout of your own. `parts` defaults to the reply's first timeline block. `isFollowed` says the answer has started below it. |
| `ChatClearButton` | `chatModel`, and any `ButtonProps` | Clear the conversation, from a panel header. |
| `ChatReasoning` | `part`, `markdownComponents`, `markdownPlugins`, `allowImages` | Show a reasoning part. |
| `ChatSources` | `sources`, `title`, `compact`, `showNumbers`, `showExternalIcon`, `startCollapsed`, `visibleRows`, `onSourceClick` | Show a list of sources. Each shows its `marker`, else its position. |
| `ChatNoAnswer` | `part`, `onEditQuestion` | Show a fixed "not found" reply, for example inside an app's own renderer for `xh.chat.noAnswer`. |
| `ChatSidePanel` | `model`, `panelProps` | Frame the open request of a `ChatSidePanelModel`: title, Close, and the content - the app's viewer with its status, or the full table or chart of a result card. |
| `ChatCodeBlock` | `content`, `language`, `isStreaming` | Show code in a card with a copy button. A finished block over 20 lines shows its first 20, with a button that shows the rest, then fewer. Sets its own font size and line height. |
| `ChatFileChip` | `file`, `onRemove`, `allowImages` | Show a file, with a remove button when `onRemove` is set. An image at a URL shows a thumbnail only if `allowImages` permits it. |
| `ChatEmptyState` | `header`, `icon`, `title`, `text`, `suggestions`, `footer`, `composerModel` | Welcome the user to an empty chat. |
| `ChatSuggestions` | `suggestions`, `onSelect`, `composerModel` | Show prompt cards that fill the composer: `composerModel`, else the `ChatModel`'s. `onSelect` replaces the fill. With neither, it renders nothing. |
| `ChatStatusRegion` | `model`, `assistantName`, `showStopHint` | Show the thread's next action above a composer, in a custom layout. |
| `ChatComposerPill` | `text`, `icon`, `count`, `menuItems`, `content`, `tooltip`, `active`, `disabled`, `onOpenChange`, `popoverClassName`, `popoverAlign` | Add a pill to the composer's left slot or its `bottomItems`. |
| `ChatScopeChip` | `options`, `noun`, `icon`, `runOption`, `value`, `onChange`, `searchThreshold`, `tooltip`, `topItems`, `bottomItems`, `disabled`, `onOpenChange`, `popoverClassName`, `popoverAlign` | Choose some options for the next question, such as documents, agents or tools. Binds `runOptions[runOption]`, or `value` and `onChange`. |
| `ChatStatusCue` | `status`, `label`, `stalledMs`, `showSpinner` | Show a reply's status as its icon and words. `label` replaces the words, for example with a tool's verb. `showSpinner: false` drops the spinner when another element nearby shows one. |
| `ChatElapsed` | `startedAt`, `endedAt` | Show the time taken, in whole seconds from 1 s, as `6s` or `1m 02s`. Ticks each second until `endedAt` is set. |
| `ChatCopyButton` | `getCopyText`, `showText`, `label`, `aria-label` | Copy text, confirming in place with a check for a moment. No `ChatModel` needed. `aria-label` names it for screen readers where the label alone is not enough, as a code block's "Copy python code". |
| `ChatFeedbackControls` | `message`, `host`, `items` | Rate a reply in a layout of your own: thumbs, then the comment form. `host` is a `ChatModel` or a `ChatFeedbackHost`. See [Collect feedback without a ChatModel](#collect-feedback-without-a-chatmodel). |
| `ChatErrorBoundary` | `subject`, `resetKey`, `className` | Catch a render error in a kit component you host yourself, as the message list does for each part. `className` applies to the note that takes its place. |

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
  --xh-chat-user-bg: var(--xh-bg-alt);
}

// ❌ Don't: Leave off the unit, or set a variable that other variables derive from on a descendant
.my-app-assistant {
  --xh-chat-turn-gap: 32;
}
```

A variable set on a descendant reaches only the CSS that reads it directly. Variables derived from
it keep the values computed on `body`. Set leaf variables there, such as colors, and set sizes
that others derive from on `body.xh-app`.

The same holds for Hoist's own size variables. The kit's font sizes resolve from `--xh-font-size`
once, on `body`. A container that pins another font size, such as a 14px sidebar beside 13px
pages, must restate the kit's type variables inside it: `--xh-chat-font-size`,
`--xh-chat-heading-font-size`, `--xh-chat-code-font-size`, `--xh-chat-meta-font-size` and
`--xh-chat-citation-font-size`. The list and the composer read those directly.

| Group | Main variables | Default |
|-------|----------------|---------|
| Type | `--xh-chat-font-size` | `--xh-font-size` (13px) |
| | `--xh-chat-line-height` | `1.5` |
| | `--xh-chat-heading-font-size` | `--xh-font-size-large`, for markdown H1 and H2 |
| | `--xh-chat-code-font-size` | `--xh-font-size` minus 1 |
| | `--xh-chat-meta-font-size` | `--xh-font-size` times 0.9 |
| Layout | `--xh-chat-column-max-width` | `808px`, for the thread, cards and composer. Includes the side padding, so content runs to 768px |
| | `--xh-chat-prose-max-width` | `none`. Set it for markdown text narrower than the column |
| | `--xh-chat-side-pad` | `--xh-pad-double` (20px) |
| | `--xh-chat-turn-gap` | `24px`, between messages |
| | `--xh-chat-action-button-size` | `24px`, the least height and width of a message action or feedback thumb |
| | `--xh-chat-part-gap`, `--xh-chat-process-gap` | `--xh-pad`, `--xh-pad-half` |
| | `--xh-chat-part-header-height` | `28px`, for card header strips |
| | `--xh-chat-user-max-width` | `75%`, for the user bubble |
| | `--xh-chat-user-padding` | `8px 12px`, inside the user bubble |
| | `--xh-chat-user-border-radius` | `--xh-chat-border-radius`, for the user bubble. Takes four corners, such as `16px 16px 4px 16px` for a squared tail. |
| | `--xh-chat-border-radius` | `--xh-border-radius` (4px), for every frame |
| Color | `--xh-chat-bg`, `--xh-chat-text-color` | `--xh-bg`, `--xh-text-color` |
| | `--xh-chat-meta-text-color` | `--xh-blue-gray`, `--xh-text-color-muted` in dark |
| | `--xh-chat-user-bg`, `--xh-chat-user-text-color` | `--xh-intent-primary-trans1`, a light tint of the primary color, and `--xh-text-color` |
| | `--xh-chat-part-border-color` | `--xh-border-color` |
| | `--xh-chat-part-header-bg` | `--xh-bg-alt` |
| | `--xh-chat-code-bg` | `--xh-grid-bg-odd` |
| Status | `--xh-chat-busy-color` | `--xh-intent-primary-text-color` |
| | `--xh-chat-attention-color` | `--xh-card-primary-color` |
| | `--xh-chat-success-color`, `--xh-chat-warning-color`, `--xh-chat-error-color` | Hoist's intent text colors |
| | `--xh-chat-rated-color`, `--xh-chat-rated-bg` | `--xh-intent-primary-text-color` and `--xh-chat-mention-bg`, for the chosen feedback thumb |
| Composer | `--xh-chat-composer-bg` | `--xh-input-bg` |
| | `--xh-chat-composer-border-color` | `--xh-border-color` |
| | `--xh-chat-composer-focus-border-color` | `--xh-form-field-focused-border-color` |
| | `--xh-chat-composer-bar-gap` | `6px` |
| | `--xh-chat-composer-toolbar-padding` | `4px`, then `--xh-pad-px` at the sides and bottom, around the bar of pills and Send |
| | `--xh-chat-composer-row-gap` | `--xh-pad-px`, between the box and the `topItems` and `bottomItems` rows |
| | `--xh-chat-composer-pill-height` | `24px` |
| | `--xh-chat-composer-pill-padding` | `0 6px 0 8px` |
| | `--xh-chat-composer-pill-gap` | `6px`, between a pill's icon, words and count |
| | `--xh-chat-composer-pill-chevron-gap` | `4px`, before a pill's chevron |
| | `--xh-chat-composer-inline-padding` | `0` |
| | `--xh-chat-composer-status-inset` | `4px`, the room before the status region's line |

`styles/vars.scss` also declares the variables of each feature area, with a comment per group:
`--xh-chat-timeline-*`, `--xh-chat-citation-*`, `--xh-chat-source-*`, `--xh-chat-viewer-*`,
`--xh-chat-card-*`, `--xh-chat-sidebar-*`, `--xh-chat-composer-*` and the motion timings.
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
| Settle | A 120ms fade, with no rise and no sequence. |
| Composer growth | The field takes its new height at once. |
| Start items breathing | No breathing. |

Citrix sessions often report reduced motion whether or not the user wants it. An app whose users run
over Citrix adds `xh-chat--motion` to an ancestor of the chat, `body` say, to keep every cue moving
whatever the browser reports. The `xh-chat--reduced-motion` class on a container still forces the
twins there, so the app decides for itself. Hoist's own `Spinner` keeps spinning under reduced
motion for the same reason. To keep only the chat spinner spinning, set
`ChatKit.defaults.reducedMotionSpinner` to `'spin'`.

Spacing inside the components scales with Hoist's `--xh-pad`, so a denser app gets a denser
chat. Class names follow BEM under `xh-chat-`, for example `xh-chat-message__bubble`.

### Motion

Beyond its live cues, the chat moves little, and calmly. Its motion animates only opacity and
transform, apart from the composer's height. No single animation runs longer than 360ms, and none
makes input wait. Its one loop runs only while a reply runs.

- **Settle.** A new chat's empty state arrives in sequence: the heading, the supporting text, the
  composer, then everything below it, as one: the `belowComposer` content, the suggestions and
  the footer. Each fades in while it rises 8px, over 360ms, 60ms after the one before. It plays once as the layout mounts, on New Chat too, and never as it
  re-renders. The composer settles only while centered, never as it docks. To settle content of
  your own, such as an intro in a layout of your own, add the class `xh-chat-settle`, and
  `xh-chat-settle--1` to `--5` for its place in the sequence.
- **Composer growth.** As lines come and go, the composer eases to its new height over 160ms. The
  input keeps resizing at once inside a field that clips it and holds it to its bottom, so the
  line being typed never moves.
- **Start items breathe.** While a reply runs, the composer's `startItems` slowly fade and shrink
  a little, in a 2.4s loop that starts after 150ms, so a quick reply never blinks. When the reply
  ends, however it ends, they ease back to rest over 200ms rather than snap. This suits a mark,
  not a control. Pass `breatheStartItems: false` to keep them still.

| Variable | Default | For |
|----------|---------|-----|
| `--xh-chat-motion-ease` | `cubic-bezier(0.2, 0, 0, 1)` | State changes, such as a reveal or a size |
| `--xh-chat-motion-ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | Things arriving: a fast start and a long, soft settle |
| `--xh-chat-motion-enter`, `--xh-chat-motion-rise`, `--xh-chat-motion-stagger` | `360ms`, `8px`, `60ms` | The settle |
| `--xh-chat-motion-grow` | `160ms` | Composer growth. `0ms` turns it off. |

To turn the settle off, set `--xh-chat-motion-enter` and `--xh-chat-motion-stagger` to `0ms`.
Every one of these gives way to reduced motion, as above. Script motion checks reduced motion as
it starts, so a change mid-loop applies from the next reply. Over a remote desktop, the moving
areas stay small, so they repaint cheaply.

## Extension Points

- **Composer slots** - `topItems`, `startItems`, `leftItems` and `rightItems` on `ChatComposer`.
- **Empty state** - `emptyState` and `suggestions` on `ChatPanel` and `ChatMessageList`.
- **Message actions and header items** - `messageActions` and `messageHeaderItems` on
  `ChatMessageList`, passed through `ChatPanel.messageListProps`.
- **Tool display** - `displayName`, `icon`, `summary`, `renderer` and `display` on
  `ChatToolSpec`. See [`/core/`](../../../core/README.md#chattoolspec).
- **Data renderers** - `ChatModelConfig.dataRenderers`, for app content and generative UI.
- **Text renderer** - `ChatModelConfig.textRenderer`, for reply text in another language, with
  `getCopyText` for what Copy copies.
- **Sources** - `citationMarkers` for inline `[n]` markers, `onSourceClick` to open a source in
  the app, and a `ChatSidePanelHost` in model context to open documents beside the chat.
- **Markdown** - `markdownComponents` for element overrides, `markdownPlugins` for remark and
  rehype plugins, and `allowImages` for the image policy.
- **Theme** - the `--xh-chat-*` variables above, `xh-chat--compact`, `xh-chat--reduced-motion`,
  `xh-chat--motion`, and the BEM class names.

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
