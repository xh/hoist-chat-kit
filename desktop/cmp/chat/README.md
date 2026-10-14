# Desktop Chat Components

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the components do, and the key features |
| [Architecture](#architecture) | The component tree, and how a message renders its parts |
| [Configuration Pattern](#configuration-pattern) | Putting a `ChatModel` on screen with `ChatPanel` |
| [Common Usage Patterns](#common-usage-patterns) | Composer, empty state, actions, renderers, images, layout |
| [Properties/API Reference](#propertiesapi-reference) | Props of each component |
| [Theming](#theming) | The `--xh-chat-*` CSS variables and their overrides |
| [Extension Points](#extension-points) | Slots, renderers and markdown components |
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
- **Quiet tool calls** - two or more consecutive tool calls of one step fold into one row, such
  as "Used 3 tools". A call that waits for the user stays in view as a card, and asks for
  approval in the words of the tool's `approvalPrompt`.
- **Inline generative UI** - a tool with `display: 'inline'` shows its rendered output as part
  of the reply, with a status only while it streams, waits or fails.
- **Citations in place** - numbered citation chips sit at the end of the paragraph they support,
  and keep their numbers while the reply streams. The source list shares the numbers.
- **Renderers as components** - a tool `renderer` or a data renderer renders as a component of
  its own, so it can use hooks such as `useLocalModel()`.
- **Safe markdown** - raw HTML renders as text, and model-written images do not load unless the
  app allows them.
- **App slots** - toolbar items in the composer, an empty state with suggestions, message
  actions and message header items.
- **Theme variables** - colors, widths and radii come from `--xh-chat-*` CSS variables, built
  from Hoist's own variables, with light and dark defaults.

## Architecture

```
ChatPanel (Panel)                       # uses(ChatModel)
├── ChatMessageList                     # Scrolls, sticks to the bottom while a reply streams
│   ├── ChatEmptyState                  # When the conversation has no messages
│   │   └── ChatSuggestions             # Prompt chips that send on click
│   ├── ChatMessageView (per message)   # A user bubble, or an assistant reply
│   │   ├── header                      # Name, time taken, thinking time, messageHeaderItems
│   │   ├── parts, in order:
│   │   │   ├── text                    # ChatMarkdown, with inline citation chips
│   │   │   ├── ChatReasoning           # "Thought for 12s" disclosure
│   │   │   ├── ChatToolCall            # A card, or inline renderer output
│   │   │   ├── tool call group         # "Used 3 tools", opens to show each call
│   │   │   ├── files                   # ChatFileChip row
│   │   │   └── data                    # ChatModelConfig.dataRenderers
│   │   ├── ChatSources                 # "3 sources" list
│   │   └── action bar                  # Copy, Edit, Regenerate, then messageActions
│   └── error banner                    # The error that ended the last turn, with Retry
└── ChatComposer                        # uses(ChatComposerModel), or the chat's composerModel
```

### Render context

`ChatModel` replaces a message with a new object on every streamed change. If a part received
the message, every part would re-render on every flush. So `ChatMessageView` gives each part a
`ChatPartRenderContext` instead: `{chatModel, messageId}`. The view builds the context once per
message id, so it stays the same object while the message streams.

Tool renderers, data renderers, `messageActions` and `messageHeaderItems` all receive this
context. A renderer that needs the whole message reads `chatModel.getMessage(messageId)`. It
then re-renders whenever the message changes, so do this only when you need to.

### Scroll behavior

`ChatMessageList` follows a streaming reply by staying scrolled to the bottom. A wheel or scroll
up releases the list, so the user can read back while the reply streams. A round button then
offers a way back down. Scrolling back to the bottom, or sending a message, sticks the list
again. Content that grows when no reply streams, such as a tool card the user opens, stays in
place. In the last message of a list scrolled to the bottom, the list follows it down instead,
so that it opens into view.

### Citations

A text part's citations show as numbered chips at the end of its last paragraph or list item. A
part that ends in a code block, a table or a quote puts them on the last paragraph before it.
Numbers run across the whole reply, in order of first citation, and never change once given.
Sources that arrive after the text take the numbers of their citations. The "3 sources" list
shows the same numbers, with any source cited but not listed.

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

Pass `composerProps` to `ChatPanel`, or props to `chatComposer` directly. `leftItems` and
`rightItems` add toolbar items around the send button. `topItems` adds content above the input,
such as context chips.

```typescript
chatPanel({
    model: chatModel,
    composerProps: {
        placeholder: 'Ask about this dashboard...',
        maxRows: 6,
        leftItems: [modelPicker()],
        topItems: contextChips()
    }
});
```

Attachments are a model setting: set `composer: {enableAttachments: true}` on the
`ChatModelConfig`. The user can then attach files with the paperclip button, a paste, or a drop
on the composer. A paste that carries text stays a paste, even when the clipboard also holds an
image of the copied cells.

### Replace the empty state

`suggestions` adds prompt chips to the default empty state. For your own heading and text, pass
a `chatEmptyState` as `emptyState`. A click on a suggestion sends it and moves focus to the
composer.

```typescript
chatPanel({
    model: chatModel,
    emptyState: chatEmptyState({
        title: 'What should we build?',
        text: 'Describe a dashboard and the agent will build it.',
        suggestions: [
            {text: 'Compare two cities', prompt: 'Compare weather in New York and Tokyo'},
            'What can you help me do?'
        ]
    })
});
```

### Add message actions, such as feedback

`messageActions` adds buttons to each message's action bar, after Copy, Edit and Regenerate. It
receives the message and its render context, and returns elements. Keep the feedback state in
your own model, so it survives a re-render and can go to your server.

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
`ChatUiCatalog` declares its tools this way - see [`/genui/`](../../../genui/README.md).

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

`ChatPanel` passes `allowImages` to the message list. On a custom layout, set it on
`chatMessageList`.

### Replace markdown elements

`markdownComponents` swaps how markdown elements render in assistant messages, keyed by tag
name. The kit renders fenced code with `ChatCodeBlock` by default, and your entries merge over
that default. Pass a module-level constant, so the markdown blocks stay memoized.

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
| `emptyState` | `ReactNode` | Content for a conversation with no messages, in place of the default. |
| `suggestions` | `Array<ChatSuggestion \| string>` | Prompt chips for the default empty state. |
| `allowImages` | `boolean \| (src) => boolean` | Model-written images to load. Default false. |
| `composerProps` | `ChatComposerProps` | Props for the composer. |
| `messageListProps` | `ChatMessageListProps` | Props for the message list. |

### ChatMessageList

Accepts layout props, `testId`, `ref` and other box props.

| Property | Type | Description |
|----------|------|-------------|
| `model` | `ChatModel` | The chat to render. Found in context if not given. |
| `emptyState` | `ReactNode` | Content for a conversation with no messages. |
| `suggestions` | `Array<ChatSuggestion \| string>` | Prompt chips for the default empty state. |
| `assistantName` | `string` | Name on assistant messages. Default `'Assistant'`. |
| `assistantIcon` | `ReactElement` | Icon on assistant messages. Default a sparkles icon. |
| `markdownComponents` | `ChatMarkdownComponents` | Markdown element overrides. Pass a stable object. |
| `allowImages` | `boolean \| (src) => boolean` | Model-written images to load. Default false. |
| `messageActions` | `(message, context) => ReactNode[]` | Buttons after Copy, Edit and Regenerate. Pass a stable function. |
| `messageHeaderItems` | `(message, context) => ReactNode[]` | Items in an assistant message's header. Pass a stable function. |

### ChatComposer

Accepts layout props, `testId`, `ref` and other box props.

| Property | Type | Description |
|----------|------|-------------|
| `model` | `ChatComposerModel` | The draft to edit. Default the `composerModel` of the `ChatModel` in context. |
| `placeholder` | `string` | Prompt in the empty input. Default `'Send a message...'`. |
| `maxRows` | `number` | Rows the input grows to before it scrolls. Default 10. |
| `topItems` | `ReactNode` | Content above the input, inside the composer. |
| `leftItems` | `ReactNode` | Toolbar items on the left. |
| `rightItems` | `ReactNode` | Toolbar items on the right, before the send button. |
| `autoFocus` | `boolean` | True to focus the input on mount. |

Enter sends, and Shift+Enter starts a new line. An Enter that confirms an IME candidate does not
send. Up arrow in an empty input recalls the last user message. While a reply streams, the send
button stops it, and so does Escape. The composer names any file it cannot attach under the
attachments, such as one of the wrong type, too large, or over the limit. The names come from the
composer model's `attachmentErrors`, and stay until the user dismisses them or adds more files.

### ChatMessageView

Renders one message. `ChatMessageList` renders one per message, and passes it the props above.
Use it directly only for a list of your own.

| Property | Type | Description |
|----------|------|-------------|
| `message` | `ChatMessage` | The message to show. |
| `chatModel` | `ChatModel` | The chat that holds the message. |
| `assistantName`, `assistantIcon`, `markdownComponents`, `allowImages`, `messageActions`, `messageHeaderItems` | - | As on `ChatMessageList`. |

### Part components

| Component | Props | Use it to |
|-----------|-------|-----------|
| `ChatToolCall` | `part`, `context` | Show a tool call card, for example inside a renderer of your own. |
| `ChatClearButton` | `chatModel`, and any `ButtonProps` | Clear the conversation, from a panel header. |
| `ChatReasoning` | `part`, `markdownComponents`, `allowImages` | Show a reasoning part. |
| `ChatSources` | `sources`, `defaultExpanded` | Show a list of sources. |
| `ChatCodeBlock` | `content`, `language` | Show code with a copy button. |
| `ChatFileChip` | `file`, `onRemove` | Show a file, with a remove button when `onRemove` is set. |
| `ChatEmptyState` | `icon`, `title`, `text`, `suggestions` | Welcome the user to an empty chat. |
| `ChatSuggestions` | `suggestions`, `onSelect` | Show prompt chips. `onSelect` replaces the default send. |

## Theming

Each `--xh-chat-*` variable defaults to a value built from Hoist's theme variables, so the chat
follows the app's light or dark theme. To change one, set the same name without the `xh-`
prefix, for example `--chat-user-bg`, on `body` or on a parent of the chat. The defaults live in
`styles/vars.scss`.

```scss
// ✅ Do: Set the override name
.my-app-assistant {
  --chat-content-max-width: 680px;
  --chat-user-bg: var(--xh-intent-primary-trans1);
}

// ❌ Don't: Set the --xh-chat-* name, which the kit defines on body
.my-app-assistant {
  --xh-chat-user-bg: red;
}
```

| Group | Variables (set without `xh-`, as `--chat-*`) |
|-------|-----------------------------------------------|
| Layout | `--xh-chat-bg`, `--xh-chat-content-max-width`, `--xh-chat-gutter-px`, `--xh-chat-message-gap-px`, `--xh-chat-part-gap-px`, `--xh-chat-radius-px` |
| Text | `--xh-chat-font-size-px`, `--xh-chat-line-height`, `--xh-chat-text-color`, `--xh-chat-muted-text-color`, `--xh-chat-meta-font-size-px`, `--xh-chat-link-color` |
| Borders and surfaces | `--xh-chat-border-color`, `--xh-chat-surface-bg`, `--xh-chat-hover-bg`, `--xh-chat-shadow` |
| User bubble | `--xh-chat-user-bg`, `--xh-chat-user-text-color`, `--xh-chat-bubble-radius-px`, `--xh-chat-bubble-max-width` |
| Code | `--xh-chat-code-font-family`, `--xh-chat-code-font-size-px`, `--xh-chat-code-bg`, `--xh-chat-code-header-bg`, `--xh-chat-inline-code-bg`, `--xh-chat-inline-code-text-color` |
| Composer | `--xh-chat-composer-bg`, `--xh-chat-composer-border-color`, `--xh-chat-composer-focus-border-color`, `--xh-chat-composer-focus-ring`, `--xh-chat-composer-radius-px`, `--xh-chat-send-bg`, `--xh-chat-send-text-color` |
| Chips | `--xh-chat-chip-bg`, `--xh-chat-chip-hover-bg`, `--xh-chat-citation-bg` |
| Status | `--xh-chat-success-color`, `--xh-chat-warning-color`, `--xh-chat-danger-color`, `--xh-chat-approval-bg`, `--xh-chat-error-bg` |
| Motion | `--xh-chat-shimmer-highlight` |

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
- **Markdown** - `markdownComponents` for element overrides, and `allowImages` for the image
  policy.
- **Theme** - the `--chat-*` overrides above, and the BEM class names.

## Common Pitfalls

### Passing a new function or object on every render

`messageActions`, `messageHeaderItems` and `markdownComponents` are props of memoized
components. A new value on each render re-renders every message, and a new
`markdownComponents` re-parses every markdown block.

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
