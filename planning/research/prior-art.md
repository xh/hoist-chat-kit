# Prior art: chat UI libraries and the claude.ai / ChatGPT UX

Date: 2026-10-13. Purpose: inform the component inventory for `@xh/hoist-chat-kit`.

## Evidence legend

- **[V]** verified this session by fetching the cited URL. WebFetch returns a model-written summary of the page, not raw text, so exact identifiers are only as good as that summary.
- **[K]** from my own knowledge (cutoff June 2026). Not verified live. Treat as a hypothesis.
- **[U]** tried and could not verify. Several deep doc pages returned 404 or 403.

---

## 1. Library survey

### 1.1 assistant-ui (assistant-ui.com, github.com/assistant-ui/assistant-ui)

**Shape.** Composable, unstyled "primitives" (Radix-style) plus a CLI that copies a styled shadcn-based starter into your project, in Base UI (default) or Radix flavor. MIT. Optional paid "Assistant Cloud" for thread history, telemetry and file storage. [V: github.com/assistant-ui/assistant-ui, assistant-ui.com/docs]

**Primitives named on the primitives page.** Composer, Thread, Message, ActionBar, BranchPicker, ThreadList, AssistantModal, Attachment, Suggestion, SelectionToolbar, Error, ChainOfThought. Related references: MessagePartPrimitive, ThreadListItemPrimitive, ThreadListItemMorePrimitive, ActionBarMorePrimitive, AuiIf. Sub-parts confirmed: `ComposerPrimitive.Root/Input/Send`, `ThreadPrimitive.Messages` (an iterator that takes a component per role), `MessagePrimitive.Root`, `MessagePrimitive.Parts`, `ThreadPrimitive.Viewport`. [V: assistant-ui.com/docs/primitives]
Other sub-parts I recall (`ThreadPrimitive.Empty`, `ScrollToBottom`, `Suggestion`, `ActionBarPrimitive.Copy/Reload/Edit/FeedbackPositive/FeedbackNegative`, `BranchPickerPrimitive.Previous/Next/Number/Count`, `ComposerPrimitive.Cancel/AddAttachment/Attachments`) [K, unverified].

**Runtime abstraction.** Two core runtimes; everything else is an adapter over them. [V: assistant-ui.com/docs/runtimes/pick-a-runtime]
- `LocalRuntime` - the runtime owns conversation state; you supply a `ChatModelAdapter` that calls your API. Simplest wiring.
- `ExternalStoreRuntime` - you own messages in Redux/Zustand/TanStack Query/etc. and the runtime renders from them.
- Framework adapters: `useChatRuntime` (Vercel AI SDK, default), `useLangGraphRuntime`, `useDataStreamRuntime`, plus packages for LangChain, AG-UI, A2A, Google ADK, OpenCode. [V: repo README]
- `ChatModelAdapter` is a `run({messages, abortSignal, ...})` that returns a promise or async generator of content parts, with optional attachment, history, feedback and speech adapters. [K; the doc page returned 404 - U]
- Note: `unstable_`-prefixed APIs may change at any release. [V]

**Message parts.** Page confirms typed parts and `MessagePrimitive.Parts`; mentions text, image, streaming. [V, partial]. The full set I recall: `text`, `reasoning`, `source`, `image`, `file`, `audio`, `tool-call` (with `toolName`, `args`, `argsText`, `result`, `status`), `data`, `ui`. Tool-call status values: `running`, `requires-action`, `complete`, `incomplete`. [K, U - the source file 404'd]

**Tool UI.** `makeAssistantToolUI` is confirmed as the named tool-rendering API, with a `get_weather` card example, inline human approval, and frontend actions exposed to the model. [V: README] I recall it takes `{toolName, render}` where `render` receives `args`, `result`, `status`, `addResult` (human-in-the-loop), and returns a component you mount inside the runtime provider; plus `makeAssistantTool` for frontend-executed tools and a fallback renderer for unregistered tools. [K, U]

**Distinctive ideas.** Primitives, not a monolith. Backend-agnostic runtime hook swap. Thread list as a first-class runtime concept (multi-thread, archive, rename). Branching and attachments are guides, not afterthoughts. "Agent skills" and MCP docs for AI coding assistants. [V: docs landing page lists Guides: Attachments, Branching, Voice, Persistence, Migrations]

### 1.2 Vercel AI Elements and AI SDK UI

**Shape.** "A component library and custom registry built on top of shadcn/ui." Components are copied into your repo. 48 components at time of fetch. [V: elements.ai-sdk.dev]

**Component list.** [V]
- Chatbot: Attachments, Chain of Thought, Checkpoint, Confirmation, Context, Conversation, Inline Citation, Message, Model Selector, Plan, Prompt Input, Queue, Reasoning, Shimmer, Sources, Suggestion, Task, Tool.
- Code: Agent, Artifact, Code Block, Commit, Environment Variables, File Tree, JSX Preview, Package Info, Sandbox, Schema Display, Snippet, Stack Trace, Terminal, Test Results, Web Preview.
- Voice: Audio Player, Mic Selector, Persona, Speech Input, Transcription, Voice Selector.
- Workflow: Canvas, Connection, Controls, Edge, Node, Panel, Toolbar.
- Utilities: Image, Open In Chat.
- The brief's names `Response`, `Loader`, `Branch`, `Actions` did not appear in this list. `Response` appears to have become `MessageResponse`, `Branch` is `MessageBranch`, `Actions` is `MessageActions`. `Loader` was not listed [V by omission]. The older names may still exist [K].

**Details verified per component.**
- `Message` (`from="user"|"assistant"|"system"`): user messages get a secondary background, assistant messages span full width. `MessageContent`, `MessageActions`, and `MessageBranch` (`defaultBranch`, `onBranchChange`) with `MessageBranchPrevious/Next/Page`. [V: /components/message]
- `PromptInput`: a form with `PromptInputHeader` (attachments), `Body`, `Textarea` (auto-resize, min/max height), `Footer`, `Tools`, `Button` (tooltip with shortcut hint), `Submit` (icon changes with `status`: submitted/streaming/error), action menu ("Add photos or files", "Add screenshot"), model select family, Web Speech button. File rules: `accept`, `multiple`, `maxFiles`, `maxFileSize`, `onError` with codes `max_files|max_file_size|accept`. `globalDrop` extends drag-drop to the whole document. `PromptInputProvider` lifts state out so other components can read and set the input (`usePromptInputController`, `usePromptInputAttachments`, `usePromptInputReferencedSources`). Enter submits, Shift+Enter newline. Paste handling is undocumented. [V: /components/prompt-input]
- `Reasoning`: collapsible, `isStreaming` auto-opens while streaming and closes when done; `duration` prop; `ReasoningTrigger getThinkingMessage(isStreaming, duration)`; content rendered through Streamdown. [V: /components/reasoning]
- `Tool`: collapsible; `ToolHeader` (type, state), `ToolContent`, `ToolInput` (JSON), `ToolOutput` (node or `errorText`). States: `input-streaming`, `input-available`, `output-available`, `output-error`, plus `approval-requested`, `approval-responded`, `output-denied`. Badge labels: Pending, Running, Awaiting Approval, Responded, Completed, Error, Denied. Completed tools open by default. [V: /components/tool]
- `InlineCitation`: pill trigger showing hostname plus "+N", `HoverCard` body, carousel for multiple sources with "1/5" index, `Source` (title, URL, description), `Quote`. The doc approach parses `[n]` markers in generated text; there is no Streamdown support for citations yet. [V: /components/inline-citation]

**AI SDK UI data model (`useChat`).** [V: ai-sdk.dev/docs/ai-sdk-ui/chatbot]
- `status`: `submitted` | `streaming` | `ready` | `error`.
- `UIMessage.parts[]`: `text`, `reasoning`, `reasoning-file`, `source-url`, `source-document`, `file`, `tool-*` (typed per tool), `data-*` (custom).
- `stop()` aborts the fetch; `regenerate()` replaces the last reply; `sendReasoning` and `sendSources` are opt-in server flags.
- This is the closest thing to a de facto part vocabulary. assistant-ui, prompt-kit and LlamaIndex chat-ui all integrate with it. [V: repo and docs pages]

**Distinctive ideas.** Status-driven submit button; tool state machine including approval; reasoning duration; `PromptInputProvider` for external control; code-oriented elements (Terminal, Stack Trace, Test Results) aimed at agent UIs.

### 1.3 CopilotKit

- Docs landing: framework connecting your app to agents; chat, generative UI (Controlled, Declarative, Open-ended), human-in-the-loop, frontend tools, "AG-UI Streams" for saving and resuming threads with generative UI and app state. [V: docs.copilotkit.ai]
- Components: `CopilotChat` (connects an agent to a chat view), `CopilotSidebar` (fixed side panel variant), `CopilotPopup` (floating panel with toggle button). Props: `agentId`, `threadId`, `labels`, `chatView`, `onError`, `isModalDefaultOpen`. [V: reference/v2/components/CopilotChat]
- **Slots** pattern: `messageView`, `input`, `suggestionView` each accept a component (replace), a class string (merge), or a partial props object (spread). `children` and `welcomeScreen` accept render functions receiving the composed slot elements. [V]
- Hooks: `useFrontendTool` (client-side tool handler with optional UI rendering), `useRenderToolCall` (returns a renderer for tool calls), `useHumanInTheLoop` (tool that pauses the agent and waits for user input). [V: reference page]
- Props of render callbacks (`status`, `args`, `result`, `respond`) are from memory only. [K, U]
- Distinctive: the protocol (AG-UI) shares state between agent and app, so the UI can read and write agent state. Sidebar and popup chrome are built in.

### 1.4 Others

| Library | Status and source | Distinctive ideas |
|---|---|---|
| **prompt-kit** | Components: Chain of Thought, Chat Container, Code Block, Feedback Bar, File Upload, Image, Loader, Markdown, Message, Prompt Input, Prompt Suggestion, Reasoning, Scroll Button, Source, Steps, System Message, Text Shimmer, Thinking Bar, Tool. Has a "Primitives" section and a "Blocks" section. Ships llms.txt. [V: prompt-kit.com/docs] | Small, shadcn-style parts. `Feedback Bar`, `Thinking Bar`, `Text Shimmer`, `System Message` are small niceties. `Chat Container` wraps stick-to-bottom (the Scroll Button pairs with it) [K]. |
| **shadcn-chat** | Maintainer states it is no longer maintained and points to AI Elements and prompt-kit. [V: github.com/jakobhoeg/shadcn-chat] | Historical only. Do not mine it. |
| **LlamaIndex chat-ui** | `ChatSection` (wraps a handler such as `useChat`), `ChatMessages`, `ChatInput` with `.Form/.Field/.Upload/.Submit/.Preview`. [V: github.com/run-llama/chat-ui] | Composition by nesting child parts; pluggable language renderers for code blocks (Mermaid example); extra request data hook (for example, selected model); KaTeX, highlight.js, PDF viewer. It has annotation-based rich widgets for citations/sources [K, U]. |
| **Chainlit** | Python framework with its own UI. Overview page highlights multi-step reasoning visualization ("Steps"). [V, shallow: docs.chainlit.io] | Nested "steps" tree as the unit of agent activity; "elements" (files, images, PDFs) and "actions" (buttons) attached to messages; chat settings panel; ask-user prompts; embeddable "copilot" widget [K, U]. |
| **NLUX** | `<AiChat/>`, `useChatAdapter`; adapters for ChatGPT, LangServe, Hugging Face, custom (stream or batch); `@nlux/markdown` stream parser; personas (name, avatar); RSC generative UI; zero-dependency core. 1,023 commits, 1.4k stars. Maintenance status unclear from the page. [V: github.com/nlkitai/nlux] | Adapter interface with stream/batch modes is a clean, UI-agnostic seam. Persona object for assistant and user. |
| **Deep Chat** | Web component; connects to many APIs; speech, camera, mixed files. [V, thin: deepchat.dev; the page text was mostly navigation] | Framework-agnostic custom element; built-in multimodal capture (mic, camera) and direct-to-provider connections. |
| **OpenAI ChatKit** | Exists. `<openai-chatkit>` web component, `@openai/chatkit-react` (`<ChatKit/>`, `useChatKit`), script from cdn.platform.openai.com. Features: streaming, in-chat widgets, file/image upload, thread management, source annotations, entity tagging, chain-of-thought views. Two backends: hosted Agent Builder workflow, or your server with the ChatKit Python SDK. OpenAI docs say Agent Builder is being deprecated with shutdown on 2026-11-30; for new work use your own server-side agent. [V: github.com/openai/chatkit-js, developers.openai.com/api/docs/guides/chatkit] | Server-driven "widgets" (declarative JSON UI the server emits). Entities (`@`-tag references). Detailed option names (theme, startScreen prompts, onEffect, client tools) not verified. [U] It is a black-box embed, so it is a UX reference, not a code reference. |

### 1.5 Cross-library convergence

1. **Parts, not strings.** Every serious library models an assistant message as an ordered list of typed parts (text, reasoning, sources, files, tool calls, custom data).
2. **Status enum drives UI.** `submitted/streaming/ready/error` controls submit-to-stop morph, loaders and retry.
3. **Tool call has a small state machine.** Input streaming, running, awaiting approval, complete, error, denied.
4. **Adapter seam between UI and transport.** `ChatModelAdapter`, NLUX adapters, ExternalStoreRuntime, AI SDK transport. The UI never speaks HTTP.
5. **Override by slot or registry.** assistant-ui registers tool UIs by tool name; CopilotKit uses slots; AI Elements gives you the source.
6. **Collapsible disclosure** is the shared idiom for reasoning, tool calls and steps.
7. **Distribution split.** The React ecosystem copies source into your app (shadcn model). A Hoist kit published as source via `extraIncludePaths` is the closest analogue and gives the same override ability.

---

## 2. Streaming markdown and auto-scroll

### 2.1 Streamdown (github.com/vercel/streamdown) [V: README and remend package page]

- Drop-in replacement for `react-markdown` aimed at streaming. Features: "unterminated block parsing", memoized rendering, GFM (tables, task lists, strikethrough), Shiki code highlighting, Mermaid (rendered via a button), KaTeX math, security hardening via `rehype-harden`. Props `animated` and `isAnimating` exist; their semantics were not documented on the page. [V]
- Optional plugins as separate packages: `@streamdown/code`, `@streamdown/mermaid`, `@streamdown/math`, `@streamdown/cjk`. `components` overrides tags; `fallbackComponent` and `allowedTags` handle custom tags. [V]
- **`remend`** (a separate dependency-free package) is the "close the open syntax" pre-pass. It completes: bold, italic, bold-italic, inline code, strikethrough, links (an unfinished `[text](url` gets the placeholder target `streamdown:incomplete-link`), block math `$$`, opt-in inline math; it drops incomplete images; it escapes single tildes between word characters (such as `20~25`); setext headings via an option. The page does not mention code fences or tables. [V]
- How Streamdown handles unterminated fences and partial tables is **not verified**. [U] The usual approach in this class of library, which I believe Streamdown follows, is to split the document into top-level blocks (via a markdown lexer), memoize each finished block so only the last block re-parses, and let the parser treat an unclosed fence as running to end of input. [K, unverified for Streamdown specifically]

### 2.2 Techniques to reuse (design guidance)

| Problem | Technique | Basis |
|---|---|---|
| Partial syntax flicker (`**bo`) | Pre-pass that closes open constructs before parsing (remend model) | [V] |
| Re-parsing the whole message per token | Split into blocks, memoize completed blocks, re-render only the tail | [V: Streamdown lists memoized rendering; block splitting is K] |
| Unclosed code fence | Render as a code block immediately; show a "streaming" state; defer syntax highlighting until the fence closes or throttle it | [K] |
| Partial table | Hide the table until the header separator row arrives, or render the completed rows only | [K, design choice] |
| Unsafe output (links, images, HTML) | Sanitize and harden the rehype pipeline; allow-list link and image origins | [V: rehype-harden] |
| Token flood | Batch updates to animation frames (`requestAnimationFrame`) so React renders at most once per frame | [K] |
| Citations `[1]` | Post-process text markers into chip components; Streamdown has no native support | [V: AI Elements docs] |

For Hoist, the parser should sit behind a small seam, so apps can swap it. MobX makes block memoization natural: a `MessagePart` model holds `text` as an observable and a computed list of blocks. [K, design suggestion]

### 2.3 Stick to bottom (`use-stick-to-bottom`, github.com/stackblitz-labs/use-stick-to-bottom) [V]

- API: `<StickToBottom>` with `<StickToBottom.Content>`, props `resize` and `initial` (animation mode, "smooth" in the demo); `useStickToBottomContext()` gives `isAtBottom` and `scrollToBottom` (returns `Promise<boolean>`, false if cancelled). Hook form `useStickToBottom()` returns `scrollRef` and `contentRef`.
- Spring animation rather than duration easing, because streamed content changes size unpredictably. Spring parameters are configurable.
- `ResizeObserver` for growth and shrink of content.
- User scroll-up escapes stickiness. It distinguishes user scrolls from its own without debouncing. Works on mobile. Does not depend on CSS `overflow-anchor` (Safari lacks it).
- Pairs with a "scroll to bottom" pill shown when `!isAtBottom`.
- assistant-ui offers the same via `ThreadPrimitive.Viewport` with `ScrollToBottom` [V for Viewport, K for the rest].

---

## 3. UX patterns of claude.ai and ChatGPT

**Provenance.** I could not load either product (login required) and could not fetch ChatGPT help pages (403). Release notes for Claude were fetched [V]. Everything else is my own recollection of the products as of mid-2026 [K]. Both UIs change often, so treat details as approximate and re-check in a browser before copying.

### 3.1 Composer

| Aspect | claude.ai [K unless noted] | ChatGPT [K] |
|---|---|---|
| Container | Rounded card at bottom of a centered column, soft border, shadow on focus. | Pill-shaped rounded bar, centered, same column width as messages. |
| Textarea | Auto-grows to a max height, then scrolls. | Same; the pill becomes a rounded rectangle as it grows. |
| Enter / Shift+Enter | Enter sends; Shift+Enter newline. | Same. |
| "+" menu | Attach files, add from connected sources (Drive and others), project/knowledge, take screenshot, "Use style", web search toggle, extended thinking toggle, research mode, connectors. | "+" for add photos and files, connect apps, create image, deep research, web search, study mode, canvas, and others. Menu contents shift across releases. |
| Tool/connector toggles | A "tools" or sliders icon opens a panel of toggles for search, thinking and connectors; selected ones show as chips near the composer. | Selected tools appear as removable chips inside the composer (for example "Search"). |
| Model picker | Dropdown at bottom right of the composer showing the model name; includes an extended-thinking switch. | Model switcher at top left of the page header, with options such as Auto/Fast/Thinking. |
| Send / stop | Up-arrow send button, disabled when empty; becomes a square stop button while generating. | Up-arrow in a circle, replaced by a stop square while streaming. A voice/waveform button shows when the input is empty. |
| Drag and drop | Drop overlay over the whole window ("Drop files here"). | Same overlay. |
| Paste | Pasting images or files creates attachments. Very long pasted text converts to an attachment card (I recall this on Claude). | Pasting images attaches them. Long text stays inline. |
| Attachment previews | Thumbnail or file-type card above the text area with a remove "x". | Thumbnail row inside the composer with "x" on hover. |
| Shortcuts | Release notes list only a Ctrl+Option+C for the Excel add-in [V]; web shortcuts I recall: Cmd/Ctrl+K search chats, Cmd/Ctrl+Shift+O new chat, Cmd/Ctrl+. toggle sidebar [K, unverified]. | Cmd/Ctrl+Shift+O new chat, Cmd/Ctrl+K search, Shift+Esc focus input, Cmd/Ctrl+Shift+; copy last code block, Cmd/Ctrl+Shift+C copy last response [K, the official help page returned 403]. |
| Editing a prior message | Up arrow in an empty composer is not standard [K, unsure]. | Same [unsure]. |

### 3.2 Message layout [K]

- **User:** right-aligned bubble with a tinted background (a muted gray/warm tone), rounded corners, max width about 70-80 percent of the column. No avatar. Claude shows the user's initial in a small circle in some layouts; ChatGPT shows none.
- **Assistant:** full column width, no bubble, no background. Claude shows a small starburst/logo mark at the end of the response or beside it while streaming; ChatGPT shows no avatar on the message.
- **Column:** a single centered column, about 700-800 px wide. Messages separated by whitespace, not borders.
- **Hover action bar (assistant):** appears under the response: Copy, thumbs up, thumbs down, Retry/Regenerate (with a model submenu in some builds), and sometimes Share or Read aloud. On Claude the bar is always visible for the last message and hover-only for older ones [K, unsure]. On ChatGPT it is visible for the last message, hover-only for older ones [K, unsure].
- **Hover action bar (user):** Edit (pencil) and Copy, shown below or to the left of the bubble.
- **Edit mode:** the bubble becomes an inline textarea with Cancel and Save/Send. Saving creates a new branch.
- **Branch navigation:** a compact "< 2/3 >" control under the edited user message (and under regenerated responses on ChatGPT). Arrows swap the entire downstream conversation. [K]
- **Feedback:** thumbs down opens a small form with reason chips and free text. [K]

### 3.3 Streaming behavior [K]

- **Thinking disclosure (Claude):** a collapsed row such as "Thought for 12s" with a chevron. While thinking, the label is animated ("Thinking...") and may show the live summary line. Expanding shows the reasoning text in muted, smaller type, usually in a bordered or indented block. Collapses automatically when the answer starts.
- **ChatGPT:** "Thinking" with shimmer text during reasoning, then "Thought for 14 seconds" collapsed. Expanding shows summarized chain of thought and, for tool use, intermediate steps.
- **Stop:** the send button morphs into a stop square. After stop, the partial response is kept. Claude shows a muted "Response was interrupted" or similar; I am not sure of exact wording.
- **Streaming cursor:** ChatGPT historically showed a black dot/block cursor at the end of streamed text; newer builds animate text in without a cursor. Claude streams text with no visible cursor and shows the logo mark animating. [K, unsure which is current]
- **Scroll:** auto-follows the stream until the user scrolls up; then a circular "scroll to bottom" arrow button appears above the composer. When the user sends a message, the view scrolls so the user turn is near the top (ChatGPT and Claude both do a variant of this) [K, unsure].
- **Rate/network errors:** inline red or amber banner inside the thread, with a Retry button. Failed message shows "Something went wrong" and a regenerate action. [K]

### 3.4 Tool calls, search, citations, code [K]

- **Tool steps:** collapsible row(s) in the assistant message such as "Searched the web" or "Ran code", with an icon, a status indicator (spinner while running, check when done), and a count. Expanding shows queries, result lists (favicon, title, domain), or the code and output. Claude groups multiple steps into one expandable timeline. ChatGPT shows a compact "Searching the web..." line.
- **Web search results:** a list of source cards or a "Sources" button opening a side sheet listing all sources (ChatGPT). Claude shows a source count and a list.
- **Citations:** small numbered or domain-named chips inline at the end of a sentence or claim. Hover shows a card with title, domain, snippet and favicon; click opens the source. ChatGPT uses pill chips with the domain name (plus "+N" when several); Claude uses numbered markers or chips in search answers. This is the same pattern AI Elements implements in `InlineCitation` [V for AI Elements].
- **Code blocks:** header bar with language label left, "Copy" button right (changes to "Copied" with a check for about 2 seconds). Dark or light theme per app theme. Syntax highlighted. Long lines scroll horizontally. ChatGPT adds an "Edit" action for canvas in some cases.
- **Tables:** rendered as styled tables, horizontally scrollable; ChatGPT adds copy/download hover on tables.
- **Inline visuals (Claude):** interactive charts, diagrams and visualizations render inline, added 2026-03-12 [V: Claude release notes].

### 3.5 Artifacts and canvas [K unless noted]

- **Claude artifacts:** substantial self-contained outputs (documents, code, HTML/React, SVG, diagrams) open in a right-hand panel beside the chat, with a card in the message that reopens it. Panel has title, Code/Preview toggle, version selector (v1, v2...), Copy, Download, Publish/Share, and close. Release notes confirm artifacts are on every plan (2026-09-16), drafts open beside the conversation with highlight-and-edit applied in place (2026-06-12), and shared artifacts can be embedded (2025-08-21). [V]
- **ChatGPT canvas:** a side panel for editing documents or code collaboratively. Supports selecting text and asking for edits, inline suggestions, version back/forward arrows, and shortcut toolbar actions (for example, adjust length or reading level, add comments). [K]
- **Layout effect:** the chat column narrows to make room; on small screens the panel overlays.

### 3.6 Sidebar, branching, empty state [K]

- **Conversation list:** left sidebar, collapsible. New chat button on top, search, grouped by recency ("Today", "Yesterday", "Previous 7 days"), starred/pinned or projects section, hover "..." menu per item (rename, pin/star, delete, share, move to project). Footer holds the account menu.
- **Branching:** edit user message or regenerate creates a sibling; "< n/m >" switches. The sidebar still shows a single conversation.
- **Empty state:** Claude shows a greeting with the user's name and a centered composer, sometimes with starter chips below (categories such as Write, Learn, Code). ChatGPT shows "What can I help with?" with the composer centered and a few suggestion chips that disappear after the first message.
- **Suggestions after replies (ChatGPT):** occasional follow-up suggestion chips under a response. [K, unsure]
- **Error/retry:** covered in 3.3. Also "Regenerate" after any failure, and "Continue generating" when a response is truncated by length.

---

## 4. Recommended component inventory

Naming follows Hoist conventions: a `ChatModel`/`ChatMessageModel` layer holds state, `hoistCmp` components render it, and element factories are exported with each component. Desktop components live under `desktop/`; shared models, parts and services live outside. **VS** = first vertical slice, **Later** = after the slice. These are recommendations, not facts about any library.

### 4.1 Layout / thread

| # | Item | Purpose | Phase |
|---|---|---|---|
| 1 | `ChatPanel` | Top-level composite: thread plus composer wired to one `ChatModel`; the "just works" entry point. | VS |
| 2 | `ChatThread` | Scrollable message list with stick-to-bottom behavior and scroll-to-bottom pill. | VS |
| 3 | `ChatEmptyState` | Greeting plus suggested prompts when the thread has no messages. | VS (simple), Later (rich) |
| 4 | `ChatScrollButton` | Pill shown when scrolled away from bottom; click re-sticks. | VS |
| 5 | `ChatThreadList` | Sidebar list of conversations with grouping, search, rename, delete. | Later |
| 6 | `ChatSidePanel` | Resizable right-hand panel for artifacts or detail, built on Hoist `Panel`/`PanelModel`. | Later |
| 7 | `ChatPopup` / `ChatSidebar` | Floating and docked wrappers for embedding chat in an app screen (CopilotKit-style). | Later |

### 4.2 Message

| # | Item | Purpose | Phase |
|---|---|---|---|
| 8 | `ChatMessage` | One message. Role-driven layout: user bubble right, assistant full width. Renders an ordered list of parts. | VS |
| 9 | `ChatMessageActions` | Hover action bar: copy, retry, edit, feedback. Actions are configurable per app. | VS (copy, retry), Later (edit, feedback) |
| 10 | `ChatBranchPicker` | "< 2/3 >" navigation between sibling messages. | Later |
| 11 | `ChatErrorBanner` | Inline error with retry for a failed turn. | VS |
| 12 | `ChatTypingIndicator` | Loading/shimmer indicator for status `submitted` and for in-progress parts. | VS |

### 4.3 Content rendering

| # | Item | Purpose | Phase |
|---|---|---|---|
| 13 | `ChatMarkdown` | Streaming-safe markdown renderer with block memoization and a sanitizing pipeline, parser behind a swappable seam. | VS |
| 14 | `ChatCodeBlock` | Code with language label, copy button, optional highlight; handles an unclosed fence. | VS |
| 15 | `ChatReasoning` | Collapsible "Thinking" / "Thought for 12s" disclosure, auto-open while streaming. | VS |
| 16 | `ChatSources` + `ChatCitation` | Numbered or domain chips with hover card, plus a sources list. | Later |
| 17 | `ChatAttachmentChip` / preview | Display of image and file parts in messages and in the composer. | VS (file chip), Later (preview) |
| 18 | `ChatArtifactCard` | In-thread card that opens an artifact in the side panel. | Later |

### 4.4 Composer

| # | Item | Purpose | Phase |
|---|---|---|---|
| 19 | `ChatComposer` | Auto-growing textarea built on the Hoist `textArea` input, Enter/Shift+Enter handling, IME-safe. | VS |
| 20 | `ChatSendButton` | Send that morphs to stop based on model status. | VS |
| 21 | `ChatComposerAttachments` | "+" menu, drag-drop, paste, validation (`maxFiles`, `maxFileSize`, `accept`), chips. | Later (basic file picker could be VS) |
| 22 | `ChatModelPicker` / tool toggles | Select for model plus toggles for tools and connectors, bound to config. | Later |
| 23 | `ChatSuggestions` | Prompt chips (empty state and follow-ups). | VS (empty state) |

### 4.5 Tool / agent

| # | Item | Purpose | Phase |
|---|---|---|---|
| 24 | `ChatToolCall` | Collapsible step card with status (pending, running, awaiting approval, done, error, denied). | VS (generic card) |
| 25 | `ChatToolRegistry` | Register a custom renderer by tool name, with fallback to the generic card (assistant-ui `makeAssistantToolUI` model, but as a service-level map). | Later |
| 26 | `ChatApproval` | Human-in-the-loop approve/deny UI for a tool call that awaits permission. | Later |
| 27 | `ChatStepTimeline` | Group several tool/reasoning steps into one expandable timeline (Chainlit steps, Claude/ChatGPT). | Later |

### 4.6 Models / services

| # | Item | Purpose | Phase |
|---|---|---|---|
| 28 | `ChatModel` | `HoistModel` for one conversation: observable messages, status, send, stop, retry, regenerate. | VS |
| 29 | `ChatMessageModel` + part types | Observable message with typed parts (text, reasoning, tool-call, source, file, data) mirroring the AI SDK `UIMessage.parts` vocabulary so adapters are easy. | VS |
| 30 | `ChatTransport` (adapter interface) | Interface that streams parts from a backend (`run(messages, signal)` returning an async iterable). The UI never touches HTTP. Includes a mock transport for tests and Toolbox. | VS |
| 31 | `ChatService` / `ChatThreadStore` | Hoist service for thread persistence, listing and branching tree; local or server-backed. | Later |

### 4.7 Slice rationale

The first vertical slice should be: `ChatModel`, part types, `ChatTransport` with mock and one real SSE adapter, `ChatPanel`/`ChatThread`/`ChatMessage`, `ChatMarkdown` and `ChatCodeBlock`, `ChatReasoning`, a generic `ChatToolCall`, `ChatComposer` with the send/stop morph, error banner, scroll pill and simple empty state. That covers the full streaming round-trip from adapter to rendered part, which is where the risky design decisions (part model, status enum, markdown safety, scroll) live. Branching, threads, citations, artifacts and registry come after the part model has settled.

## 5. Open questions and unverified items

- assistant-ui `ChatModelAdapter` signature, tool-call `status` values and `makeAssistantToolUI` render props: from memory; doc pages 404'd.
- Streamdown behavior on unterminated fences and tables: not documented in what I could fetch. Read the source in `packages/streamdown` before copying the approach.
- CopilotKit render-callback arguments: not seen.
- Chainlit, Deep Chat, ChatKit option names: only surface-level pages were readable.
- All claude.ai and ChatGPT UI details except the Claude release-note dates: recalled, not observed this session. A hands-on pass in both products (and a screenshot set under `planning/research/`) is worth doing before visual design.
- OpenAI Agent Builder shutdown date (2026-11-30) comes from OpenAI's docs via a search summary; confirm at developers.openai.com/api/docs/guides/chatkit.

## Sources

- https://www.assistant-ui.com/docs , /docs/primitives , /docs/runtimes/pick-a-runtime
- https://github.com/assistant-ui/assistant-ui
- https://elements.ai-sdk.dev/ and /components/{tool,prompt-input,reasoning,message,inline-citation}
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
- https://github.com/vercel/streamdown , https://github.com/vercel/streamdown/tree/main/packages/remend
- https://github.com/stackblitz-labs/use-stick-to-bottom
- https://docs.copilotkit.ai/ , /reference , /reference/v2/components/CopilotChat
- https://www.prompt-kit.com/docs
- https://github.com/run-llama/chat-ui
- https://github.com/jakobhoeg/shadcn-chat
- https://github.com/nlkitai/nlux
- https://deepchat.dev/
- https://docs.chainlit.io/get-started/overview
- https://github.com/openai/chatkit-js , https://developers.openai.com/api/docs/guides/chatkit
- https://support.claude.com/en/articles/12138966-release-notes
