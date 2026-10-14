# Core Package

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the core models do, and the key features |
| [Architecture](#architecture) | `ChatModel`, `ChatMessage`, parts, tools, and the turn loop |
| [Configuration Pattern](#configuration-pattern) | Creating a `ChatModel` with a transport, tools, and a composer |
| [Common Usage Patterns](#common-usage-patterns) | Sending, tools, approvals, interactive tools, persistence, errors |
| [Properties/API Reference](#propertiesapi-reference) | Config, state, methods, statuses, parts, and metadata |
| [Extension Points](#extension-points) | Tools, data renderers, transports, and app metadata |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Transports, components, markdown, and Hoist packages |

## Overview

The `/core/` package holds the platform-neutral models and types for a chat with an LLM or an
agent. It owns the conversation state and the run loop. It knows nothing about any wire format,
and it imports nothing from `@xh/hoist/desktop`, so a mobile UI can render the same models.

Import from `@xh/hoist-chat-kit/core`.

Key features:

- **`ChatModel`** - a `HoistModel` that holds the message history, streams each reply through a
  `ChatTransport`, and runs the tools that the model calls.
- **Immutable messages** - each `ChatMessage` is a plain record with an ordered list of typed
  parts: text, reasoning, tool calls, files, sources and app data. A change makes a new message,
  so memoized components re-render only what changed.
- **A client-side tool loop** - the model can call a tool that has an `execute` function. The
  chat runs it in the browser, sends the result back, and continues, up to `maxSteps`.
- **Human in the loop** - tool calls can wait for the user to approve them, or for the user to
  answer them. The turn pauses and resumes when the user responds.
- **Conversation actions** - stop, retry, regenerate, and edit a past message.
- **Persistence** - `getMessageSpecs()` returns the conversation as JSON, and `loadMessages()`
  restores it.
- **`ChatComposerModel`** - the draft text and file attachments of the next message.

## Architecture

```
ChatModel (HoistModel)
├── transport: ChatTransport          # Runs one model call per step - see /transport/
├── tools: ChatToolSpec[]             # Client, interactive and backend tools
├── composerModel: ChatComposerModel  # Draft text and attachments (@managed)
├── messages: ChatMessage[]           # History, oldest first - replaced on change (observable)
├── status: ChatStatus                # 'ready' | 'submitted' | 'streaming' | 'error'
├── lastError: Error                  # Error from the last turn, or null
├── threadId: string                  # Identifies the conversation to the backend
├── Computed:
│   ├── isBusy                        # True while a turn runs - false while paused
│   ├── isAwaitingUser                # True while a turn waits on the user
│   ├── waitingToolCalls              # Calls the paused turn waits on
│   └── pendingApprovals              # The subset that waits for approve or deny
└── Methods:
    ├── sendAsync()                   # Send a message and stream the reply
    ├── stop()                        # Stop the current turn, keep its content
    ├── retryAsync()                  # Re-run the last user message
    ├── regenerateAsync()             # Replace an assistant reply
    ├── editMessageAsync()            # Change a user message and re-run from it
    ├── approveToolCallAsync()        # Approve a waiting call
    ├── denyToolCallAsync()           # Deny a waiting call
    ├── addToolOutputAsync()          # Answer a call to an interactive tool
    ├── loadMessages() / clear()      # Replace the conversation, as a new thread
    └── getMessageSpecs()             # The conversation as JSON, for storage

ChatMessage (immutable)
├── id, role, status, createdAt, error, metadata
├── parts: ChatPart[]                 # Ordered content
└── text, toolCalls, isUser, isAssistant, isStreaming, isEmpty, withChanges(), toSpec()

ChatPart = ChatTextPart | ChatReasoningPart | ChatToolCallPart
         | ChatFilePart | ChatSourcePart | ChatDataPart
```

### Turns and steps

Each user message starts a **turn**. A turn builds one assistant message. It makes one or more
**steps**, and each step is one model call through the transport. Every part records the `step`
that produced it.

```
sendAsync('Compare Paris and Tokyo')
│
├── Append the user message and an empty assistant message ('pending')
│   status: 'submitted'
│
├── Step 0: transport.run(request)
│   ├── Events stream into the assistant message ('streaming')
│   │   status: 'streaming'
│   └── The step ends with two calls to the client tool getWeather
│
├── Run the client tools in order: 'running', then 'output-available' or 'output-error'
│
├── Step 1: transport.run(request)    # The request carries the tool results
│   └── The model answers with text, and calls no tools
│
└── The turn ends: message 'complete', status 'ready', onTurnComplete(message)
```

After each step, the chat looks at the tool calls of that step that the backend did not run:

- No such calls: the turn is complete.
- A call to a tool with no spec fails with the error result `No handler for tool '<name>'.`. The
  turn continues, so the model can recover.
- A call to a backend tool that arrived with no result also fails with an error result.
- A call that needs approval moves to `approval-requested`, and a call to an interactive tool
  stays at `input-available`. If any call waits on the user, the turn **pauses**.
- Otherwise the chat runs each client tool in order and starts the next step.

When a step would go past `maxSteps`, the turn ends as `complete`, with
`metadata.finishReason` set to `max-steps`.

### Statuses

`ChatModel.status` describes the conversation. `ChatMessage.status` describes one message.

| `ChatModel.status` | Meaning |
|--------------------|---------|
| `ready` | Idle. A paused turn is also `ready` - check `isAwaitingUser`. |
| `submitted` | A turn started, and no content has arrived yet. |
| `streaming` | Content is arriving, or client tools are running. |
| `error` | The last turn failed. See `lastError`. |

| `ChatMessage.status` | Meaning |
|----------------------|---------|
| `pending` | An assistant message that waits for its first content. |
| `streaming` | Content is arriving, or client tools are running. |
| `paused` | The turn waits for the user to answer its tool calls. Returns to `streaming` on resume. |
| `complete` | Finished normally. Also the default for a `ChatMessageSpec` with no status. |
| `error` | The turn failed. The text is in `error`, and any code is in `metadata.errorCode`. |
| `aborted` | The user stopped the turn, or it was interrupted. Content received so far stays. |

### Three kinds of tool

A `ChatToolSpec` describes one of three kinds of tool:

| Kind | Declared with | Who answers each call |
|------|---------------|-----------------------|
| Client tool | `execute` | The chat runs `execute` in the browser and sends the result to the model. |
| Interactive tool | `interactive: true` | The user, through a `renderer`. The app passes the answer to `addToolOutputAsync()`. |
| Backend tool | Neither | The backend runs it and streams the result. The spec only configures display. |

Client tools are how a model acts on the app: it changes a dashboard, opens a view, or filters a
grid. Only the browser can do these things, so the kit runs the tool loop on the client. A
server-side agent loop still works, because its backend sends both the calls and the results.

## Configuration Pattern

Create a `ChatModel` in the constructor of the model that owns the chat, and mark it `@managed`.
The chat then stops any turn in progress when its owner is destroyed.

```typescript
import {ChatModel, type ChatToolSpec} from '@xh/hoist-chat-kit/core';
import {AnthropicCodec, HoistChatTransport} from '@xh/hoist-chat-kit/transport';
import {HoistModel, managed} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import type {PortfolioModel} from './PortfolioModel';

export class AssistantModel extends HoistModel {
    @managed readonly chatModel: ChatModel;

    private readonly portfolioModel: PortfolioModel;

    constructor(portfolioModel: PortfolioModel) {
        super();
        this.portfolioModel = portfolioModel;
        this.chatModel = new ChatModel({
            transport: new HoistChatTransport({
                url: 'chat/stream',
                // Built before each step, so the model sees the app's current state.
                codec: new AnthropicCodec({system: () => this.buildSystemPrompt()})
            }),
            tools: this.createTools(),
            composer: {enableAttachments: true, accept: ['image/*', '.csv']},
            onTurnComplete: message => this.logDebug('Turn done', message.metadata)
        });
    }

    private buildSystemPrompt(): string {
        const {selectedSector} = this.portfolioModel;
        return `You help users explore their portfolio. The selected sector is ${selectedSector}.`;
    }

    private createTools(): ChatToolSpec[] {
        return [
            {
                name: 'filter_sector',
                description: 'Filter the positions grid to one sector.',
                parameters: {
                    type: 'object',
                    properties: {sector: {type: 'string', description: 'Sector name, e.g. Energy.'}},
                    required: ['sector']
                },
                displayName: 'Filter grid',
                icon: Icon.filter(),
                summary: ({input}) => input?.sector,
                execute: ({sector}) => {
                    const {store} = this.portfolioModel.gridModel;
                    store.setFilter({field: 'sector', op: '=', value: sector});
                    return `The grid shows ${store.count} positions in ${sector}.`;
                }
            }
        ];
    }
}
```

Render it with the desktop `chatPanel`, which takes the `ChatModel` as its `model`:

```typescript
import {chatPanel} from '@xh/hoist-chat-kit/desktop/cmp/chat';
import {hoistCmp, uses} from '@xh/hoist/core';
import {AssistantModel} from './AssistantModel';

export const assistantPanel = hoistCmp.factory({
    model: uses(AssistantModel),
    render({model}) {
        return chatPanel({model: model.chatModel, title: 'Assistant', flex: 1});
    }
});
```

The Toolbox Weather V2 example builds its Dashboard Agent this way. See
`client-app/src/examples/weatherv2/harness/DashboardAgentModel.ts` in Toolbox.

## Common Usage Patterns

### Send messages

`sendAsync()` with no argument sends the composer's draft and clears it. Pass a string or a
`ChatSendSpec` to send from code, for example from a button or a grid context menu. Code that
sends a message leaves the draft alone.

```typescript
// Send the draft - what the composer's Enter key and Send button do.
await chatModel.sendAsync();

// Send a prompt from code.
await chatModel.sendAsync('Summarize the selected positions.');

// Send text with files and app metadata. Files go ahead of the text.
await chatModel.sendAsync({
    text: 'What changed in this report?',
    files: [reportFilePart],
    metadata: {source: 'report-viewer'}
});

// Prefill the draft for the user to edit, then focus the input.
chatModel.composerModel.text = 'Explain the change in ';
chatModel.composerModel.focus();
```

The returned promise resolves when the turn ends or pauses, however it ends. It does not reject
for a failed turn. Read `status` and `lastError` instead. A send while a turn runs does nothing.

### Stop, retry, regenerate and edit

```typescript
chatModel.stop();                                    // Keep the partial reply, as 'aborted'
await chatModel.retryAsync();                        // Re-run the last user message
await chatModel.regenerateAsync();                   // Replace the last assistant reply
await chatModel.regenerateAsync(message.id);         // Replace a given reply, drop later messages
await chatModel.editMessageAsync(message.id, text);  // New text, same files, re-run from there
```

`retryAsync()` suits a failed turn. `regenerateAsync()` suits a reply the user did not like.
Both discard the messages after the point they re-run from. The desktop components wire these
actions to the error banner and the message hover bar.

### Ask for approval before a tool runs

Set `needsApproval` on a client tool. Use a function to decide per call.

```typescript
{
    name: 'place_order',
    description: 'Place an order for a security.',
    parameters: ORDER_SCHEMA,
    needsApproval: input => input.quantity * input.price > 10_000,
    approvalPrompt: ({side, quantity, symbol}) =>
        `${side} ${fmtNumber(quantity, {asHtml: true})} ${symbol} at market?`,
    execute: input => this.orderService.placeOrderAsync(input)
}
```

The call moves to `approval-requested` and the turn pauses. The desktop tool call card asks the
tool's `approvalPrompt`, or a generic "Allow this action to run?". Its Approve and Deny buttons call
`approveToolCallAsync()` and `denyToolCallAsync()`. When no call waits any longer, the turn resumes.
The chat runs approved calls and tells the model about denied ones, with the reason given to
`denyToolCallAsync()` or a default text.

Write `approvalPrompt` in the user's terms. Say what the call does, and name any work it
discards, such as "Discard unsaved changes and reset the dashboard?". A function of the input
may return rich content, such as an order ticket. A `renderer` on the tool also shows in the
card while it waits, under the prompt.

The time a turn waits for the user does not count toward the reply's `metadata.elapsedMs`.

### Let the user answer a tool call

An interactive tool has no `execute`. The user answers each call through the tool's `renderer`,
and the renderer passes the answer to `addToolOutputAsync()`. The answer becomes the tool
result for the model.

```typescript
import {div, hbox} from '@xh/hoist/cmp/layout';
import {button} from '@xh/hoist/desktop/cmp/button';

const askUser: ChatToolSpec = {
    name: 'ask_user',
    description: 'Ask the user to choose one of several options. Returns the chosen option.',
    parameters: {
        type: 'object',
        properties: {
            question: {type: 'string'},
            options: {type: 'array', items: {type: 'string'}}
        },
        required: ['question', 'options']
    },
    interactive: true,
    displayName: 'Question',
    // Renders as a component of its own, with the call and a stable render context.
    renderer: (part, {chatModel}) => {
        const {question, options} = part.input ?? {};
        if (part.state === 'output-available') return div(`You chose: ${part.output}`);
        if (part.state !== 'input-available') return div(part.errorText ?? question);
        return div(
            div(question),
            hbox(
                (options ?? []).map(option =>
                    button({
                        key: option,
                        text: option,
                        onClick: () => chatModel.addToolOutputAsync(part.id, option).catchDefault()
                    })
                )
            )
        );
    }
};
```

**Avoid:** an interactive tool with no `renderer`. The default tool call card has no controls
for an answer, so the turn waits with no way for the user to resume it. `ChatModel` logs a
warning for such a tool when it is created.

### Persist and restore a conversation

`getMessageSpecs()` returns the conversation as plain objects. `loadMessages()` restores it as a
new thread, or under the `threadId` you pass. Save from a reaction to the thread and its
messages that skips while a turn is busy. It then saves each finished or paused turn, and a
`clear()`, but not every streamed change.

```typescript
constructor() {
    super();
    const saved = XH.localStorageService.get(STORAGE_KEY);
    this.chatModel = new ChatModel({
        transport: this.createTransport(),
        threadId: saved?.threadId,
        initialMessages: saved?.messages ?? []
    });
    this.addReaction({
        track: () => [this.chatModel.threadId, this.chatModel.messages, this.chatModel.isBusy],
        run: ([threadId, messages, isBusy]) => {
            if (!isBusy) this.save();
        }
    });
}

private save() {
    const {threadId} = this.chatModel;
    XH.localStorageService.set(STORAGE_KEY, {threadId, messages: this.chatModel.getMessageSpecs()});
}
```

**Avoid:** saving only in `onTurnComplete`. A `clear()` with no turn running fires no turn, so a
reload restores the cleared chat. A `clear()` during a turn fires `onTurnComplete` just before
the wipe, so it saves the old messages.

A restored message that was still `pending` or `streaming` becomes `aborted`, and its unfinished
tool calls fail. A turn paused at the end of the history stays paused, so the user can still
answer it. If the user sends a new message instead, the chat closes the waiting calls. It denies
the approvals and fails the rest, so the history stays valid for the model.

`clear()` removes all messages and starts a new thread. Both `clear()` and `loadMessages()` stop
any turn in progress.

### Handle errors and finish reasons

A run error is part of the conversation. The kit shows it in the message and in the desktop error
banner. It does not raise an exception dialog. The failed message gets status `error`, and the
chat sets `lastError` and status `error`.

```typescript
import {ChatRunError} from '@xh/hoist-chat-kit/core';

this.addReaction({
    track: () => this.chatModel.lastError,
    run: error => {
        if (error instanceof ChatRunError && error.code === 'overloaded_error') {
            XH.warningToast('The model is busy. Wait a moment, then press Retry.');
        }
    }
});
```

`lastError` holds one of these:

| Error | When |
|-------|------|
| `ChatRunError` with the backend's `code` | The run reported an error: an AG-UI `RUN_ERROR`, or an Anthropic `error` event such as `overloaded_error` |
| `ChatRunError` with code `incomplete-stream` | The stream ended with neither `RUN_FINISHED` nor `RUN_ERROR`, for example on a dropped connection |
| `ChatRunError` with code `stalled` | The server sent nothing for longer than the transport's `idleTimeout` |
| `ChatRunError` with a null code | The run reported an error with no code |
| Hoist `FetchException` | The request failed before or during the stream, for example a 500 from the server |
| Any other `Error` | A codec or transport threw, for example `AnthropicCodec` with a history that has no user content |

A thrown error that is not an abort also goes to `XH.handleException` with `showAlert: false`, so
Hoist logs it. A tool that throws does not fail the turn. Its error text becomes the tool result,
and the model can recover.

A finished assistant message records why the model stopped, as `metadata.finishReason`:

| `finishReason` | Meaning |
|----------------|---------|
| `stop` | The model finished its answer. |
| `length` | The reply hit the token limit or the context window. |
| `tool-calls` | The step ended to call tools. The final step of a turn rarely ends this way. |
| `content-filter` | The model refused, or a filter stopped it. |
| `other` | Any other reason the backend gave. |
| `max-steps` | The turn hit `maxSteps`. The kit sets this value itself. |

The codec maps the provider's own reason to these values, and keeps the raw value as
`metadata.stopReason`. Check them in `onTurnComplete`:

```typescript
onTurnComplete: message => {
    if (message.metadata.finishReason === 'length') {
        XH.warningToast('The reply was cut off. Ask the assistant to continue.');
    }
}
```

### Render data parts

A data part carries content that the app or a protocol defines, keyed by `dataType`. The backend
sends one as an `xh.chat.data` event or an AG-UI `ACTIVITY_SNAPSHOT`. Register a renderer per
`dataType`. A part with no renderer shows as JSON.

```typescript
new ChatModel({
    transport,
    dataRenderers: {
        'price-chart': (part, context) => priceChart({symbol: part.data.symbol})
    }
});
```

See [Protocols](../docs/protocols.md) for how data parts carry generative UI.

## Properties/API Reference

See `ChatModel.ts`, `ChatMessage.ts`, `ChatPart.ts`, `ChatToolSpec.ts` and `ChatComposerModel.ts`
for the full doc comments.

### ChatModelConfig

| Property | Type | Description |
|----------|------|-------------|
| `transport` | `ChatTransport` | Connection to the backend. Required. See [`/transport/`](../transport/README.md). |
| `tools` | `ChatToolSpec[]` | Tools the model can call, and display config for backend tools. Names must be unique. Default none. |
| `maxSteps` | `number` | Most model calls in one turn. Each round of client tool calls takes one more. Default 10. |
| `initialMessages` | `ChatMessageSpec[]` | Messages to start with, such as a greeting or restored history. Closed as by `loadMessages()`. |
| `threadId` | `string` | Identifies the conversation to the backend. Default a new UUID. |
| `composer` | `ChatComposerConfig` | Config for the managed `composerModel`. |
| `sendBlocker` | `() => string` | Returns why sending must wait, or null to allow it. Read as a computed value. While blocked, the composer disables Send and shows the reason, and `sendAsync` and `editMessageAsync` do nothing. |
| `dataRenderers` | `Record<string, ChatDataRenderer>` | Renderers for data parts, keyed by `dataType`. A renderer is `(part, context) => ReactNode`, with a `ChatPartRenderContext`. |
| `onTurnComplete` | `(message) => void` | Called when a turn ends - complete, failed or stopped - with its final message. Not called when a turn pauses. |

`onTurnComplete` also runs for a turn that `clear()`, `loadMessages()`, `retryAsync()`,
`regenerateAsync()` or `editMessageAsync()` stops or closes, just before the chat discards its
message. An error thrown by the callback is logged and does not affect the chat.

### ChatModel state

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `ChatMessage[]` | History, oldest first. Observable. Replaced, never mutated. |
| `status` | `ChatStatus` | `ready`, `submitted`, `streaming` or `error`. Observable. |
| `lastError` | `Error` | Error from the last turn, or null. Observable. |
| `threadId` | `string` | Current thread. Observable. `clear()` and `loadMessages()` change it. |
| `isBusy` | `boolean` | True for `submitted` or `streaming`. False while a turn is paused. |
| `sendBlockedReason` | `string` | Why sending must wait, from the `sendBlocker`, or null. |
| `isEmpty` | `boolean` | True if there are no messages. |
| `lastMessage` | `ChatMessage` | The newest message, or null. |
| `waitingToolCalls` | `ChatToolCallPart[]` | Calls the paused turn waits on. Empty unless paused. |
| `isAwaitingUser` | `boolean` | True if a turn is paused for the user. |
| `pendingApprovals` | `ChatToolCallPart[]` | The calls in `waitingToolCalls` that wait for approval. |
| `composerModel` | `ChatComposerModel` | Draft of the next message. |
| `transport`, `tools`, `maxSteps`, `dataRenderers` | - | The config values, read-only. |

### ChatModel methods

| Method | Description |
|--------|-------------|
| `sendAsync(input?)` | Send a string, a `ChatSendSpec`, or the composer draft. Ignored while busy, while blocked by the `sendBlocker`, or when empty. |
| `stop()` | Stop the current turn, running or paused. Content stays, and the message becomes `aborted`. |
| `retryAsync()` | Re-run the last user message, replacing everything after it. |
| `regenerateAsync(messageId?)` | Replace an assistant reply, by default the last one. Ignored for a reply with no user message before it. |
| `editMessageAsync(messageId, text)` | Change the text of a user message, keep its files, and re-run from it. |
| `approveToolCallAsync(toolCallId)` | Approve a call in `approval-requested`. |
| `denyToolCallAsync(toolCallId, reason?)` | Deny a call in `approval-requested`. The model sees the reason. |
| `addToolOutputAsync(toolCallId, output)` | Give the result of a call to an interactive tool. |
| `clear()` | Remove all messages and start a new thread. |
| `loadMessages(specs, threadId?)` | Replace the conversation. Default a new thread id. |
| `getMessageSpecs()` | The conversation as `ChatMessageSpec[]`, for storage. |
| `getMessage(id)` | A message by id, as it is now, or null. |
| `getToolSpec(name)` | The spec for a tool, or null. |

The tool call methods log a warning and do nothing if the call does not wait on the user.

### ChatSendSpec

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | Message text. Trimmed. |
| `files` | `ChatFilePart[]` | Files to attach, sent ahead of the text. |
| `metadata` | `PlainObject` | App data to record on the user message. |

### ChatMessage

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique id. Stable across the instances that replace the message. |
| `role` | `ChatRole` | `user`, `assistant` or `system`. |
| `parts` | `ChatPart[]` | Ordered content. |
| `status` | `ChatMessageStatus` | See [Statuses](#statuses). |
| `createdAt` | `number` | Epoch millis. For a reply, when its turn started. |
| `error` | `string` | Error text for status `error`, else null. |
| `metadata` | `PlainObject` | Open-ended data. See the keys below. |
| `text` | `string` | Text of all text parts, joined with blank lines. |
| `toolCalls` | `ChatToolCallPart[]` | Tool call parts, in call order. |
| `isUser`, `isAssistant` | `boolean` | Role tests. |
| `isStreaming` | `boolean` | True for `pending` or `streaming`. False for `paused`. |
| `isEmpty` | `boolean` | True if the message has no parts. |
| `withChanges(changes)` | `ChatMessage` | A copy with changes applied. |
| `toSpec()` | `ChatMessageSpec` | The message as a plain object, safe for JSON. |

A `ChatMessageSpec` has the same fields as plain JSON, plus `content`, a shorthand for one text
part: `{role: 'assistant', content: 'Hi! How can I help?'}`.

The kit records these keys in the `metadata` of an assistant message:

| Key | Description |
|-----|-------------|
| `elapsedMs` | Time the turn ran, from its start to its end, less any time it spent paused for the user. Set on a paused message too. |
| `finishReason` | Why the model stopped. See [Handle errors and finish reasons](#handle-errors-and-finish-reasons). |
| `stopReason` | The provider's own stop reason, when the codec reports it. |
| `usage` | `ChatTokenUsage[]`, one entry per step that reported token counts. |
| `model` | The model that served the call, when the codec reports it. |
| `errorCode` | Code of a failed run. |

A backend can add its own keys through the `metadata` of its `RUN_FINISHED` event. The chat
merges them into the message.

### Parts

Every part has an `id`, unique within its message, and a `step`. User message parts have no
`step`.

| Type | Key fields | Notes |
|------|------------|-------|
| `text` | `text`, `state`, `citations?` | Markdown. `state` is `streaming`, then `done`. |
| `reasoning` | `text`, `state`, `startedAt`, `endedAt`, `encryptedValue?`, `providerData?` | The model's thinking. `encryptedValue` holds a signature that goes back with the history. |
| `toolCall` | `toolName`, `state`, `inputText`, `input`, `output`, `errorText`, `providerExecuted?` | The `id` is the provider's tool call id. |
| `file` | `name`, `mediaType`, `size?`, `url?`, `data?` | `data` is base64. |
| `source` | `url?`, `title?`, `snippet?` | A source the model consulted. |
| `data` | `dataType`, `data` | App or protocol content, drawn by `dataRenderers`. |

The `state` of a tool call follows the Vercel AI SDK names, plus `running`:

| State | Meaning |
|-------|---------|
| `input-streaming` | The model is writing the arguments. `input` holds a best-effort parse. |
| `input-available` | The arguments are complete. The call has not run. |
| `approval-requested` | The call waits for approve or deny. |
| `running` | A client tool is running. |
| `output-available` | Finished, with the result in `output`. |
| `output-error` | Failed, with the text in `errorText`. |
| `output-denied` | The user denied the call. |

`isToolCallFinal(part)` returns true for the last three.

### ChatToolSpec

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Name the model calls the tool by. Required. |
| `description` | `string` | What the tool does and when to use it. Sent to the model. |
| `parameters` | `PlainObject` | JSON Schema for the input object. Sent to the model. Default an empty object schema. |
| `execute` | `(input, context) => Awaitable<any>` | Runs a client tool. Strings go to the model as is, anything else as JSON. A thrown error becomes an error result. |
| `interactive` | `boolean` | True for a tool the user answers. Ignored if `execute` is set. Default false. |
| `needsApproval` | `boolean \| (input) => boolean` | True, or a function, to ask the user before each call runs. Client tools only. Default false. |
| `approvalPrompt` | `string \| (input) => ReactNode` | The question that asks for approval, in place of the generic one. |
| `approvalPreview` | `boolean` | True to render an inline call while it waits for approval, as a preview. Default false. |
| `sendToModel` | `boolean` | True to send the tool to the model. Default true for client and interactive tools, false for backend tools. |
| `displayName` | `string` | Title of the tool call card. Default the name, humanized. |
| `icon` | `ReactElement` | Icon of the tool call card. |
| `summary` | `(part) => string` | One-line summary next to the title, for example the city looked up. |
| `renderer` | `(part, context) => ReactNode` | Custom body for the card, in place of the input and output JSON. Required for an interactive tool. |
| `display` | `'card' \| 'inline'` | `card` shows calls as a collapsible card. `inline` shows only the `renderer` output, with a status only while the input streams, while the call waits for approval, or once it fails or is denied. A denied call renders no output. Default `card`. |

The `context` of `execute` is a `ChatToolContext`: `chatModel`, `toolCallId`, and a `signal`
that aborts when the user stops the turn.

The `context` of `renderer`, and of a data renderer, is a `ChatPartRenderContext`: `chatModel`
and the `messageId` of the message that holds the part. The context stays the same object while
the message streams, so a part re-renders only when it changes. A renderer that needs the whole
message reads `chatModel.getMessage(messageId)`, and then re-renders on every change to it.

The chat renders each renderer as a component of its own, so a renderer may call hooks, such as
`useLocalModel()` for a model it owns. A card's renderer mounts only while the card is open. See
[`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md#render-a-tool-call-as-ui).

### ChatComposerConfig and ChatComposerModel

Pass the config as `ChatModelConfig.composer`. The `ChatModel` creates and manages the composer.
Presentation settings, such as `placeholder` and `maxRows`, are props of the `ChatComposer`
component. See [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md#customize-the-composer).

| Property | Type | Description |
|----------|------|-------------|
| `enableAttachments` | `boolean` | True to let the user attach files. Default false. |
| `accept` | `string[]` | MIME types (`image/*`, `application/pdf`) or extensions (`.csv`). Default any. |
| `maxFiles` | `number` | Most files per message. Default 10. |
| `maxFileSize` | `number` | Largest file, in bytes. Default 10 MB. |

All four are also `@bindable` members of the model, so an app can change them after
construction, for example to allow files only while an agent that reads them is selected.

| Member | Description |
|--------|-------------|
| `text` | Draft text. `@bindable` - assign it directly. |
| `attachments` | Files attached to the draft, as `ChatFilePart[]`. |
| `isEmpty` | True if the draft has no text and no files. |
| `canSend` | True if the draft is not empty, the chat is not busy, and the `sendBlocker` gives no reason to wait. |
| `submitAsync()` | Send the draft, if it can be sent. |
| `addFilesAsync(files)` | Read files into base64 parts. Files that break the rules are left out, and `attachmentErrors` names them. Throws if attachments are off. |
| `removeAttachment(id)` | Remove one attachment. |
| `clear()` | Clear the text and the attachments. |
| `recallLastMessage()` | Put the text of the last user message into an empty draft. |
| `focus()` | Focus the input, through `inputRef`. A composer component sets the ref. |

## Extension Points

- **Tools** - add client, interactive and backend tools with `ChatToolSpec`. Customize their
  cards with `displayName`, `icon`, `summary` and `renderer`.
- **Data renderers** - draw app content and generative UI from data parts with
  `dataRenderers`. See [Protocols](../docs/protocols.md).
- **Transports and codecs** - connect to any backend. See [`/transport/`](../transport/README.md).
- **Live context** - build the system prompt or the agent context per step, with a function on
  the codec. The function runs before every step, so it sees changes that tools made earlier in
  the turn.
- **Metadata** - record app data on a user message through `ChatSendSpec.metadata`. A backend
  adds keys to an assistant message through the `metadata` of `RUN_FINISHED`.
- **Message records** - build history in code with `ChatMessageSpec` and `loadMessages()`, for
  example a greeting, or a thread loaded from your server.

## Common Pitfalls

### Mutating messages or parts

Messages and parts are immutable. The components rely on new objects to know what changed.

```typescript
// ✅ Do: Replace the conversation through the model
const {threadId} = chatModel;
chatModel.loadMessages([...chatModel.getMessageSpecs(), {role: 'assistant', content: 'Noted.'}], threadId);

// ❌ Don't: Change a message in place - nothing re-renders, and the history is corrupt
chatModel.lastMessage.parts.push(myPart);
```

### Tracking a message by identity

Each streamed change replaces the message object. Compare messages by `id`.

```typescript
// ✅ Do
const isSelected = message.id === this.selectedMessageId;

// ❌ Don't: The reference goes stale with the next streamed token
const isSelected = message === this.selectedMessage;
```

### Treating a paused turn as busy

While a turn waits for an approval or an answer, `isBusy` is false and `status` is `ready`. Use
`isAwaitingUser` to show that the chat waits on the user. A new message closes the waiting calls.

### Forgetting `execute` on a client tool

A spec with no `execute` and no `interactive` flag is a backend tool. The kit does not send it to
the model, and a call to it with no streamed result fails with
`No result for tool '<name>' - the backend runs it, and sent none.`

### Returning large results from tools

Every tool result goes back to the model, and stays in the history for every later step. Return a
short summary that the model needs, not a full dataset. Throw an `Error` with a message written
for the model when the input is wrong, so it can correct the call.

### Ignoring the abort signal in long tools

`stop()` ends the turn at once, even while a tool runs. The tool's own work goes on unless it
honors `context.signal`. Pass the signal to any fetch the tool makes, through
`fetchOpts: {signal}`.

### Storing attachments with the history

`getMessageSpecs()` keeps the base64 `data` of every attached file. A stored conversation with
images or PDFs can be large. Strip or move file data before you save to a size-limited store,
such as local storage.

### Expecting `sendAsync()` to queue

A send while a turn runs does nothing, and logs at debug level. Wait for the promise from the
previous call, or check `isBusy`, before you send from code.

## Related Packages

- [`/transport/`](../transport/README.md) - transports, codecs, `ChatEvent`, and server contracts
- [`/desktop/cmp/chat/`](../desktop/cmp/chat/README.md) - desktop components that render a
  `ChatModel`
- [`/genui/`](../genui/README.md) - the generative UI catalog, whose components are inline tools
- [`/cmp/markdown/`](../cmp/markdown/README.md) - the streaming markdown renderer
- [Architecture](../docs/architecture.md) - layers, the flow of one turn, and render performance
- [Protocols](../docs/protocols.md) - AG-UI, Anthropic, generative UI, and the Vercel AI SDK
  vocabulary
- hoist-react `/core/` - `HoistModel`, `@managed`, and element factories
- hoist-react `/mobx/` - `@bindable` and observable state
