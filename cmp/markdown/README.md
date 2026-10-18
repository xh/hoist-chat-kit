# Streaming Markdown

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What `ChatMarkdown` does, and the key features |
| [Architecture](#architecture) | Block rendering, syntax closing, the image policy and citation markers |
| [Common Usage Patterns](#common-usage-patterns) | Streaming text, element overrides, images, links, citations, plugins |
| [Properties/API Reference](#propertiesapi-reference) | `ChatMarkdownProps` |
| [Extension Points](#extension-points) | Components, plugins and policies |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | Chat components and Hoist's `Markdown` |

## Overview

The `/cmp/markdown/` package holds `ChatMarkdown`, which renders markdown that a language model
writes, including while the text streams in. It builds on Hoist's `Markdown` component, so it
supports GitHub Flavored Markdown: tables, task lists and strikethrough. It imports nothing from
`@xh/hoist/desktop`, so a mobile chat can use it too.

Import from `@xh/hoist-chat-kit/cmp/markdown`.

Key features:

- **Cheap streaming** - the text renders as top-level blocks. A finished block renders once,
  and only the last block re-renders as text arrives.
- **No raw markers** - while text streams, `ChatMarkdown` closes open syntax in the last
  block. A half-written `**bold` or code fence renders as it will once complete.
- **Safe output** - raw HTML renders as plain text. Images do not load unless `allowImages`
  permits them. Links open in a new tab, with `rel="noopener noreferrer"`.
- **Element overrides** - `components` replaces how any element renders, keyed by tag name.
- **Citation markers** - with `citations` set, `[1]`, `[1, 2]` and `[1][2]` in the text render
  as compact buttons for the sources they cite.
- **App plugins** - `markdownPlugins` adds remark and rehype plugins, such as those for math.
  The kit takes no math dependency.

## Architecture

### Blocks

`ChatMarkdown` splits its content at blank lines into top-level blocks, such as paragraphs,
lists, tables and code fences. It never splits inside a code fence. It keeps a list, or a line
indented under it, in one block with the line before it. Each block renders through Hoist's
memoized `markdown` component, so a block whose text did not change skips its render.

The block layout stays the same when streaming ends. The reply's DOM therefore stays mounted:
a text selection survives, and custom components keep their state. Text with reference-style
link definitions (`[id]: url`) or footnotes (`[^1]`) is the exception. Once streaming ends, it
renders as one document, because a reference resolves only within its own document.

### Closing open syntax

While `isStreaming` is true, the last block passes through `closeMarkdownSyntax()` before it
renders. It closes an open code fence, inline code, bold and italic (with `*` or `_`),
strikethrough, and a link whose URL is still arriving. It removes a marker that has nothing after
it yet, and a partial image. An underscore opens or closes emphasis only at a word boundary, so
`snake_case` is left alone.

### Images

A markdown image sends a request to its URL as soon as it renders. A prompt injection in a
document or a tool result can steer the model. Such a reply can put data in an image URL, and
the request then sends the data to that server. So `ChatMarkdown` does not load images by
default. Each image shows as a link, labeled with its alt text, that the user can choose to
open. A link needs a click, so the user sees the URL before anything loads.

### Citation markers

With `citations` set, a remark plugin reads the parsed markdown and replaces each marker in the
text, such as `[1]`, `[1, 2]` or `[1][2]`, with a citation element. `[n]` cites the source with
`marker` n. When no source has a marker, `[n]` cites the nth source, counting from 1. A range
such as `[2-5]` stays as written.

The plugin skips code, inline code, links and link references, so `arr[1]` and `[1](url)` stay
as written. Footnote syntax (`[^1]`) never matches. A marker converts only if every number in it
cites a source. So `[3]` with two sources, and `[1, 3]`, stay plain text. While text streams, a
partial marker such as a trailing `[1` stays plain text until its closing bracket arrives.

Each run of markers sits in a span with the word before it and the punctuation after it. The span
does not wrap, so a marker never starts a line.

Each number renders as its own button, labeled for screen readers as "Source 1: <title>". A
click calls `citations.onClick`, or opens the source's `url` in a new tab. The button shows the
source title and excerpt as a native tooltip. The excerpt is `metadata.excerpt`, or else the
source's `snippet`. `citations.renderMarker` replaces each button, for example to add a card of
the platform's own. A marker of four or more sources collapses to one button. It reads "2–5" when
the numbers are consecutive, and "4 sources" when they are not. Its tooltip lists every source,
but a click opens only the first. `citations.renderGroup` replaces that button, to offer each source. The desktop chat
uses both for its citation cards.

The plugin needs the sources to decide which markers convert, so the blocks re-parse when the
sources change. `ChatMarkdown` compares the sources by value, so a new array of the same
sources on each streamed flush costs nothing.

## Common Usage Patterns

### Render streaming text

Pass the text and whether it is still arriving. The chat's text parts do exactly this.

```typescript
import {chatMarkdown} from '@xh/hoist-chat-kit/cmp/markdown';

chatMarkdown({content: part.text, isStreaming: part.state === 'streaming'});
```

### Replace elements

`components` maps a tag name to a component that receives the element's props, including
`children`. Define the map once, at module level.

```typescript
const COMPONENTS: ChatMarkdownComponents = {
    pre: ({children}) => myCodeBlock({children}),
    table: ({children}) => div({className: 'my-app-table', items: children})
};

chatMarkdown({content, components: COMPONENTS});
```

The desktop chat merges your `markdownComponents` over its own map, which renders fenced code
with `ChatCodeBlock`.

A component in the map can call `useChatMarkdownStreaming()`. It returns true while the block that
holds the component still streams. `ChatCodeBlock` uses it to wait for the end of a block before
it collapses long code.

### Allow images from a trusted source

```typescript
// ✅ Do: Allow images from your own server only
chatMarkdown({content, allowImages: src => src.startsWith('/api/charts/')});

// ❌ Don't: Allow every image in text that a model wrote from untrusted content
chatMarkdown({content, allowImages: true});
```

### Track link clicks

`onLinkClick` runs before a link opens. Call `e.preventDefault()` in it to handle the link in the
app instead, for example to open a record.

```typescript
chatMarkdown({
    content,
    onLinkClick: (href, e) => {
        if (href.startsWith('app://')) {
            e.preventDefault();
            this.openRecord(href);
        }
    }
});
```

### Add content at the end of the last paragraph

`trailingContent` puts inline content at the end of the last paragraph or list item, as the chat
does with citation chips. A code block, a table, a quote or a heading at the end does not take
it. The last paragraph before them does. Content with no paragraph shows it on a line of its own.

```typescript
const chips = useMemo(() => citationChips({citations}), [citations]);
chatMarkdown({content, isStreaming, trailingContent: chips});
```

Memoize the content. A new value re-renders the block that holds it.

### Render citation markers

Pass the sources the text may cite. Give each source a `marker` when the model numbers its
sources itself. Without markers, `[n]` cites the nth source.

```typescript
chatMarkdown({
    content: 'Loans above the limit need a second review [2].',
    isStreaming,
    citations: {
        sources: message.parts.filter(it => it.type === 'source'),
        onClick: source => this.openDocument(source.metadata.documentId)
    }
});
```

### Add markdown plugins

`markdownPlugins` takes remark plugins, which transform the markdown tree, and rehype plugins,
which transform the HTML tree. Each list runs after the kit's own plugins. Define the object
once, at module level.

To render math with KaTeX, add `remark-math`, `rehype-katex` and `katex` to the app, and load
the KaTeX stylesheet:

```typescript
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

const MATH_PLUGINS: ChatMarkdownPlugins = {remark: [remarkMath], rehype: [rehypeKatex]};

chatMarkdown({content, isStreaming, markdownPlugins: MATH_PLUGINS});
```

On the desktop chat, pass the same object as `markdownPlugins` on `chatPanel` or
`chatMessageList`.

## Properties/API Reference

See `ChatMarkdown.ts` for the full doc comments.

| Property | Type | Description |
|----------|------|-------------|
| `content` | `string` | Markdown text to render. |
| `isStreaming` | `boolean` | True while `content` still grows. Closes open syntax in the last block. Default false. |
| `components` | `ChatMarkdownComponents` | Element overrides, keyed by tag name. Pass a stable object. |
| `lineBreaks` | `boolean` | True to render single line breaks as breaks. Default true. |
| `allowImages` | `boolean \| (src) => boolean` | Images to load. A blocked image shows as a link. Default false. |
| `onLinkClick` | `(href, e) => void` | Called when the user clicks a link, before it opens. |
| `trailingContent` | `ReactNode` | Inline content at the end of the last paragraph or list item, such as citation chips. Memoize it. |
| `citations` | `ChatMarkdownCitations` | Sources for citation markers. Default null, which leaves markers as written. |
| `markdownPlugins` | `ChatMarkdownPlugins` | Remark and rehype plugins, run after the kit's own. Pass a stable object. |

`ChatMarkdownCitations` has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `sources` | `ChatSourcePart[]` | Sources the text may cite, in the order reported. |
| `onClick` | `(source) => void` | Called when the user clicks a marker. Default opens the source's `url` in a new tab. |
| `renderMarker` | `(marker, source, number) => ReactNode` | Replaces the button of each cited source, for example to wrap it in a card. Replaces the native tooltip. |
| `renderGroup` | `(marker, cited) => ReactNode` | Replaces the one button for a marker of four or more sources, whose click opens only the first. `cited` holds each `{number, source}`. |

`ChatMarkdown` calls an `allowImages` function as each image renders, and `onLinkClick` as each
link is clicked. It reads the `citations` callbacks the same way. A new function on each render
therefore costs nothing. A change from `false` to
`true`, or to a function, re-renders the blocks.

## Extension Points

- **`components`** - render any element with your own component, such as charts for code fences
  of a given language. `useChatMarkdownStreaming()` tells the component if its block still
  streams.
- **`allowImages`** - set the image policy per chat, or per source URL. `isChatImageAllowed()`
  applies a policy to a URL, for components of your own that show images.
- **`onLinkClick`** - route links into the app.
- **`citations`** - route citation clicks into the app, and wrap markers in a tooltip of your own.
- **`markdownPlugins`** - add remark and rehype plugins, such as `remark-math` and
  `rehype-katex`. A plugin can render its own elements through `components`.
- **Styles** - the markdown styles sit under `.xh-chat-markdown` and use the `--xh-chat-*`
  theme variables. See [`/desktop/cmp/chat/`](../../desktop/cmp/chat/README.md#theming).

## Common Pitfalls

### Passing a new components object on every render

The block cache keys on `components`. A new object re-parses every block on every render.

```typescript
// ✅ Do: A module-level constant
chatMarkdown({content, components: COMPONENTS});

// ❌ Don't: An inline object, new on every render
chatMarkdown({content, components: {pre: myCodeBlock}});
```

### Passing a new markdownPlugins object on every render

The block cache keys on `markdownPlugins`, as it does on `components`. A new object re-parses
every block on every render. Use a module-level constant.

### Sanitizing away the citation elements

A citation marker renders through a custom element, `xh-chat-citation`. A rehype sanitizer in
`markdownPlugins.rehype`, such as `rehype-sanitize` with its default schema, unwraps unknown
elements, so the markers show as plain `[1]` again. Add the element and its `data-markers`
attribute to the schema.

### Leaving isStreaming on after the text is complete

While `isStreaming` is true, the last block has its open syntax closed. Text that legitimately
ends with a lone `*` or `_` then loses it. Set `isStreaming` to false once the part is done.

## Related Packages

- [`/desktop/cmp/chat/`](../../desktop/cmp/chat/README.md) - the chat components that render
  text parts with `ChatMarkdown`
- [Architecture](../../docs/architecture.md#memoized-markdown-blocks) - render performance
- Hoist `Markdown` (`@xh/hoist/cmp/markdown`) - the renderer underneath
