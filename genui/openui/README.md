# OpenUI Lang

> **Experimental.** The OpenUI Lang format is new, and no app integration runs it yet. Its
> APIs can change in a minor release while they settle. OpenUI Lang itself is young and ships
> often.

| Section | Description |
|---------|-------------|
| [Overview](#overview) | What the format does, and when to use it |
| [Architecture](#architecture) | Catalog to library to parser to document, what lang-core does here, state, inline mode, streaming, the parser cache |
| [Configuration Pattern](#configuration-pattern) | Installing the peer, and wiring the format to a catalog and a `ChatModel` |
| [Common Usage Patterns](#common-usage-patterns) | The prompt, state and forms, queries and mutations, the export, component names, slots, data parts, examples, parser findings |
| [Properties/API Reference](#propertiesapi-reference) | Format, library and adapter options, the export, actions, functions |
| [Extension Points](#extension-points) | Names, slots, prompt text, and formats of your own |
| [Common Pitfalls](#common-pitfalls) | Mistakes that compile but misbehave |
| [Related Packages](#related-packages) | The catalog, the built-in components, and the protocols doc |

## Overview

The `/genui/openui/` package lets a model write UI in OpenUI Lang, the streaming UI language of
Thesys OpenUI, and renders it with the app's own catalog components. A program streams in as
reply text or in a data part. The kit parses it as it arrives, turns it into a
`ChatUiDocument`, and renders each element once its statement completes.

```
root = Stack([lead, rev, mar], "column", "medium")
lead = Text("Q3 at a glance.")
rev = Metrics([{label: "Revenue", value: 1250000}])
mar = Metrics([{label: "Margin", value: 0.184}])
```

Each statement assigns a component call to a name. The root statement holds the rest by name.
Arguments are positional, in the order of the component's signature. A container takes its
children first, as in OpenUI's own components.

Import from `@xh/hoist-chat-kit/genui/openui`. The package needs the optional peer dependency
`@openuidev/lang-core`. Apps that never import the package never load it.

Key features:

- **One catalog** - the format reads OpenUI Lang into the same `ChatUiCatalog` that serves tools,
  tags and documents. The catalog keeps its schemas, checks, actions, data by reference and
  rendering.
- **Streaming per element** - each element renders, and passes its full checks, as soon as its
  statement completes. An element the program has not written yet is absent until it arrives.
- **Prose around UI** - in inline mode, the default, fenced programs render in place and the text
  around them stays markdown.
- **Thesys's own prompt** - the prompt section comes from lang-core's generator, with the kit's
  rules added. A server can load it, or the library schema, from the catalog's export.
- **Two ways in** - `openUiLangFormat()` reads programs from reply text. `openUiLangAdapter()`
  reads one from a data part.
- **Fallbacks** - a statement that cannot render shows as a fallback with the parser's errors.
  The rest of the program still renders.
- **State, on request** - with `bindings`, a program has `$variables` that inputs write and
  expressions read, and buttons that run `@Set` and `@Reset`. It runs on lang-core's own store
  and evaluator.
- **Live data, for tools the app lists** - `Query()` and `Mutation()` call the chat's tools, and
  only those named in `queryTools` and `mutationTools`.

Use this format when a backend, prompt or eval set already speaks OpenUI Lang. For a new app,
component tools or tags need no extra dependency. See
[Delivery modes](../README.md#delivery-modes).

## Architecture

```
ChatUiCatalog
└── textFormats: [openUiLangFormat({root})]
    ├── toOpenUiLibrary()          # Catalog -> OpenUI library: JSON Schema and signatures
    ├── parse()                    # Text -> markdown and document segments, as it streams
    │   ├── createStreamingParser  # lang-core: program -> element tree
    │   ├── openUiToDocument()     # Element tree -> ChatUiDocument
    │   │   └── openUiToAction()   # Action expression -> ChatUiAction
    │   └── document.state         # With state: lang-core's store, evaluator and query manager
    ├── toPrompt()                 # lang-core's generateSystemPrompt, with the kit's rules
    └── toExport()                 # {root, schema, components, prompt}, for a server
```

The format works in four steps:

1. **Catalog to library.** `toOpenUiLibrary()` turns the catalog into an OpenUI library. Each
   component becomes a JSON Schema definition, a signature and a description. Its `default` slot
   comes first, as `children`, then its props in the order of its props schema, then its named
   slots. A slot is an array of the components it accepts. A prop typed with
   `chatUiActionSchema()` takes an OpenUI action expression. The description adds a `Props:` line
   with the first line of each prop description, such as `metrics[].value: A number...`.
2. **Library to parser.** lang-core's streaming parser reads the program against the library
   schema, and returns an element tree with a statement id per element.
3. **Parser to document.** `openUiToDocument()` turns the tree into a `ChatUiDocument`. Each
   statement becomes the element of its id. An inline call becomes an element with an id from its
   parent and position, such as `root.children[2]`. Child calls move to `children` or `slots`.
   Action expressions become `ChatUiAction` values. An action that the prop's schema refuses, by
   its type or its url, drops with a warning, and the element keeps its other actions.
4. **Document to components.** The catalog repairs, checks and renders the document, as it does
   any other.

### What lang-core does here

`@openuidev/lang-core` is the headless core of OpenUI. The kit uses it for the grammar and the
prompt, and for state where the app turns it on:

| lang-core part | Use in the kit |
|----------------|----------------|
| `createStreamingParser()` | Parses each program of reply text as it streams. |
| `createParser()` | Parses the program in a data part, for the adapter. |
| `generateSystemPrompt()` | Writes the prompt section, with inline mode off, and with the sections for bindings, built-in functions and tool calls that the options turn on. |
| `buildSignature()` | Writes the signature of each component. |
| `createStore()` | Holds the `$variables` of a program with state. |
| `evaluateRoot()`, `evaluate()` | Evaluate the props of a program against its state, and the value of a `@Set`. |
| `resolveStateField()` | Reads and writes a `$variable` that a prop binds. |
| `createQueryManager()` | Runs and caches the tool calls of `Query()` and `Mutation()`. |

The kit does not use `@openuidev/react-lang` or the Zod library helpers. The library is plain
JSON Schema built from the catalog, so the app writes no Zod schemas. The kit has no evaluator of
its own.

By default the kit runs none of OpenUI state. The options below turn each part on:

| Part of OpenUI Lang | Runs with |
|---------------------|-----------|
| `$variables`, expressions on them, `@Set`, `@Reset` | `bindings` |
| Built-in functions, such as `@Count` and `@Each` | `builtinFunctions`, on by default with `bindings` |
| `Query()`, and `@Run` of a query | `queryTools` |
| `Mutation()`, and `@Run` of a mutation | `mutationTools` |

The prompt tells the model not to use a part that is off. If it does, the kit drops the prop that
holds one. For example, with `bindings` off a button with `@Set(...)` renders with no action.

The kit never runs these:

- App-defined actions. `openUiToAction()` maps a call to an action in `schema.actions` to an `app`
  action, but `toOpenUiLibrary()` declares no `schema.actions` yet. A call to one becomes no
  action.
- OpenUI's message markers, `]]>openui:content` and `]]>openui:end`.
- Edit mode, in which a later reply patches an earlier program.

### State

With `bindings`, `builtinFunctions` or a tool option, a program runs with state. The document that
the format returns then has a `state`, which the catalog creates once per rendered program. See
[Give a document state](../README.md#give-a-document-state).

```
ChatUiDocument.state                  # ChatUiStateSpec, one per parse
├── create()   -> OpenUiRuntime       # Once per rendered program, kept while it streams
│   ├── createStore()                 # lang-core: the $variables
│   └── createQueryManager()          # lang-core: Query and Mutation, one manager each
└── resolve()                         # On each render, in a MobX observer
    ├── store.initialize(defaults)    # Declares the $variables of the newest parse
    ├── evaluateRoot()                # lang-core: props for the current state
    └── openUiToDocument()            # Evaluated tree -> plain ChatUiDocument
```

The state belongs to one rendered program:

- It survives each new parse while the reply streams. A value the user set stays, and a default
  that arrives later replaces only a default.
- It survives each render. Two programs in one reply have a state each.
- The catalog destroys it when the message goes away. A reply loaded from history starts again
  from its defaults.

lang-core's store and query manager notify plain listeners. The runtime bumps an observable
version on each notice, and every read of a `$variable` or a query result reads that version
first. The component that resolves the document is a MobX observer, so it renders again on each
change. The whole program evaluates again, as in OpenUI's own renderer. An expression can
therefore add or remove components, as `@Each` and a ternary do.

The catalog checks each resolved document as any other. A value that evaluates to the wrong type
renders its element as a fallback, and the caps on elements and depth count the components that
an `@Each` builds.

### Inline and whole-reply modes

With `inline: true`, the default, the format reads fenced code blocks tagged `openui-lang` or
`openui` as programs. Each program becomes a `document` segment, and the text around it stays
markdown. The prompt tells the model to tag each fence `openui-lang`.

A reply is one bare program, with no prose, when its first line is `root = ...` or a statement
that calls a component of the library, such as `rev = Metrics(...)`. Prose such as
`Total = revenue - cost` stays markdown. While the reply streams, a first line that can still
start a program, or a fence opener still being written, shows as a placeholder.

The kit does not use lang-core's inline mode. Its prompt text describes a persistent dashboard,
which the model patches with changed statements. Each kit program stands alone in its reply. So
the kit writes its own inline rules: put each program in a fence, write prose outside it, and
write every program in full, starting with `root`.

With `inline: false`, the whole reply is one program. The prompt tells the model to write only
the program.

### Streaming and errors

While a program streams, only the elements of the statement still being written are partial. The
rest render complete and pass their full checks. A statement that a newline has closed is
complete.

A chunk can cut a statement anywhere: inside a key, a number or a string. lang-core closes what
is open, so a half-written object has a key cut short and no value. The kit leaves out the last
item of a list at the end of that statement, and a key with no value yet. The element renders what
has arrived, and never shows a fallback for a value that is only half-written. An unclosed fence is a program still streaming. A fence that
has closed is a complete program, even while the rest of the reply streams. A program cut off
when the reply ends counts as complete, as nothing more will arrive.

A program with no root statement yet shows as a placeholder. Once the reply ends, a fenced
program with no root shows as a fallback. A bare program with no root renders as markdown, with
a warning in the console, as the model likely wrote prose.

lang-core drops a statement it cannot render, such as a call to an unknown component. The kit
puts a stand-in for it at the end of the root's children, so it renders there as a fallback with
the parser's errors. It does not render in the place the model wrote it. The adapter discards the
parser's text, so its stand-ins render with the catalog's own messages. For a statement
lang-core keeps, it drops only the bad prop or inline call. The catalog then checks what remains.
The format logs those errors once per message, once the program is complete.

lang-core also drops a reference to a statement the program has not written. So an element still
to come is absent from the document, not a placeholder, until its statement arrives.

### Slips the format corrects or reports

A text format gets no retry. What the model writes is what the user sees. So the kit reads a slip
that has one clear meaning, and shows an error where a slip would render wrong:

| The model writes | The kit does |
|------------------|--------------|
| One value where a prop takes a list, such as `Card(..., @ToAssistant("More"))` | Reads it as a list of one. |
| An argument by name, such as `Stack([a], direction: "row")` | Renders the element as a fallback that names the argument. lang-core reads the name as a reference and shifts the arguments after it, so the element would render with the wrong props. |
| An action that the prop's schema refuses | Drops the action with a warning, and renders the rest. The prompt offers each prop only the steps it accepts. |
| A reference to a name the program never defines | Drops the reference, logs it once the program is complete, and reports it on the segment. |

The adapter for data parts gets no element errors from the parser, so an argument by name renders
there with shifted props.

### The parser cache

A streaming parser keeps its state between chunks, so each chunk parses only what it adds. The
format keeps one parser per program of a text part, keyed by message id, part id, markdown piece
and program. It keeps the parser until the reply ends, and the last parse of the part drops it.
Text with no message or part id, such as text outside a chat, gets a new parser on each call. The
format holds at most 100 parsers, and clears them all when full. It builds the library once per
catalog.

## Configuration Pattern

Install the peer, and Zod, which lang-core needs:

```bash
pnpm add @openuidev/lang-core zod
```

lang-core runs a telemetry script when it installs. See
[Letting lang-core send install telemetry](#letting-lang-core-send-install-telemetry).

Add the format to the catalog's `textFormats`, and name it in `modes`. Its root must be a
container. The built-in `chatUiStackSpec()` is one, and `chatUiTextSpec()` gives a program text
of its own:

```typescript
import {ChatModel} from '@xh/hoist-chat-kit/core';
import {
    chatUiChartSpec,
    chatUiGridSpec,
    chatUiMetricsSpec,
    chatUiStackSpec,
    chatUiTextSpec
} from '@xh/hoist-chat-kit/desktop/cmp/genui';
import {ChatUiCatalog} from '@xh/hoist-chat-kit/genui';
import {openUiLangFormat} from '@xh/hoist-chat-kit/genui/openui';
import {AnthropicCodec, HoistChatTransport} from '@xh/hoist-chat-kit/transport';
import {HoistModel, managed} from '@xh/hoist/core';

export class AnalystModel extends HoistModel {
    readonly catalog = new ChatUiCatalog({
        components: [
            chatUiStackSpec(),
            chatUiTextSpec(),
            chatUiMetricsSpec(),
            chatUiGridSpec({maxRows: 50}),
            chatUiChartSpec()
        ],
        textFormats: [openUiLangFormat({root: 'stack'})],
        modes: ['openui'],
        instructions: 'Use a grid for positions and trades, and a chart for performance.'
    });

    @managed readonly chatModel = new ChatModel({
        transport: new HoistChatTransport({
            url: 'llm/stream',
            codec: new AnthropicCodec({system: `${APP_PROMPT}\n\n${this.catalog.instructions}`})
        }),
        catalog: this.catalog
    });
}
```

Every component of the catalog is a component of the program. For more variety, add the
built-in specs over Hoist's `TabContainer`, `Card`, `Banner`, `Badge` and `TreeMap`: a program
can then write `Tabs([chart, table], ["Chart", "Data"])` or `Callout("warning", "Limit breach", "VaR is over its limit.")`.
See [`/desktop/cmp/genui/`](../../desktop/cmp/genui/README.md#group-tab-and-call-out-parts-of-an-answer).

The format's name is `openui`. With only `openui` in `modes`, the chat sends no catalog tools.
The model writes UI in its reply, and the message view renders it in place as the reply
streams. Copy and the announcement of a finished reply read each program as words.

`textFormats` replaces the default tag format. List `chatUiTagFormat()` too, to read tags as well.

## Common Usage Patterns

### Put the OpenUI prompt in the system prompt

`catalog.instructions` holds the prompt for the catalog's `modes`. With `openui` in `modes`, it
holds the format's section: lang-core's grammar, a signature and description per component,
examples, and the rules. The kit adds these rules, before your own:

- In inline mode, write prose where it helps, fence each program as `openui-lang`, and write each
  program in full, starting with `root`. Show UI where it answers best, and words where they do.
- Do not use the parts of OpenUI Lang that are off. By default these are `$variables`, `Query`,
  `Mutation`, `@Set`, `@Reset` and `@Run`.
- Keep a `@ToAssistant` message to 200 characters, and its context to a flat object of at most 8
  short values. This rule shows only when a component takes actions.
- Do not use an action step that no component accepts, such as `@OpenUrl` in a catalog whose
  action props take only `send`.
- What lang-core's text names that the catalog lacks. Its Action section shows a `Button` in its
  examples, and its rules suggest forms for input. The kit says so when the catalog has no
  `Button`, or no component with `stateProps`.
- Stay within the catalog's `limits` on components, depth and list items.

The kit places these rules, and yours, at the end of lang-core's own list of rules, ahead of its
final checks.

Each action prop lists the steps that its schema accepts. A prop that takes only `send` actions
is typed `@ToAssistant`, and a list of them `@ToAssistant[]`. A prop that takes every step on
offer stays an `ActionExpression`.

Add your own rules with `additionalRules`, and say which component suits which question with the
catalog's `instructions`:

```typescript
openUiLangFormat({
    root: 'stack',
    additionalRules: ['Lead each program with a Text that states the answer.']
});
```

### Run programs with state

Turn `bindings` on, and add components that the user can change. The built-in form components
are such components:

```typescript
import {
    chatUiInputSpecs,
    chatUiMetricsSpec,
    chatUiStackSpec,
    chatUiTextSpec
} from '@xh/hoist-chat-kit/desktop/cmp/genui';

const catalog = new ChatUiCatalog({
    components: [chatUiStackSpec(), chatUiTextSpec(), chatUiMetricsSpec(), ...chatUiInputSpecs()],
    textFormats: [openUiLangFormat({root: 'stack', bindings: true})],
    modes: ['openui']
});
```

The model can then write a program such as this one:

```
root = Stack([region, note, form])
$region = "emea"
region = Select("region", [{value: "emea", label: "EMEA"}, {value: "apac", label: "APAC"}], "Region", null, null, null, $region)
note = Text("Showing " + ($region == "apac" ? "Asia Pacific" : "Europe"))
form = Form([name, submit], "Details")
name = TextInput("name", "Name", null, {required: true}, $name)
submit = Button("Submit", @ToAssistant("Use these details", {name: $name, region: $region}), "primary")
```

- `$region = "emea"` declares a variable with a default. A variable with no declaration starts
  as null.
- A prop that a component lists in its `stateProps` binds both ways. Its signature marks it
  `$binding<type>`. Here the select writes `$region`, and the text input writes `$name`.
- Any other prop reads a variable, alone or in an expression. The text renders again when the
  select changes.
- A `@ToAssistant` sends the values the state holds when its button renders. The button's
  tooltip shows them, and the sent message holds the same ones.
- `@Set($x, value)` and `@Reset($x)` change the state on a click. Several steps go in an
  `Action([...])`, and run in order. The kit turns them into one `state` action, whose tooltip
  says what each step does, such as `Sets $step to 2, then sends: "Next"`.

The prompt gains lang-core's text for `$variables`, expressions, the built-in functions and the
`@Set` and `@Reset` steps. The kit adds one example that binds a `$variable` to the first
component with a state prop. Pass `examples` of your own to show the model a whole form.

A component needs a prop that takes `state` actions to run a `@Set`. The built-in button takes
them by default. For a component of your own, list `state` in its action types:

```typescript
properties: {action: chatUiActionSchema({types: ['send', 'state']})}
```

### Let a program read and write through the chat's tools

`Query()` reads data through a tool, and reads it again when a `$variable` in its arguments
changes. `Mutation()` writes through a tool on a click. A model writes the program, so the kit
runs only the tools that the app lists:

```typescript
openUiLangFormat({
    root: 'stack',
    queryTools: [salesTool],
    mutationTools: ['save_filter']
});
```

Each entry is the name of a client tool in the chat's `tools`, or a spec that also describes the
tool in the prompt. A `ChatToolSpec` serves as one: the prompt then shows its `description` and
its `parameters`. Add `returns`, the JSON Schema of the result, so the model can write the
defaults of a query. Listing a tool turns `bindings` on.

```
root = Stack([region, total, save])
$region = "emea"
region = Select("region", ["emea", "apac"], "Region", null, null, null, $region)
sales = Query("get_sales", {region: $region}, {total: 0})
total = Metrics([{label: "Sales", value: sales.total, format: "currency"}])
saved = Mutation("save_filter", {region: $region})
save = Button("Save filter", Action([@Run(saved), @Run(sales)]))
```

The kit runs a call only where the app and the user would allow it:

| Check | Query | Mutation |
|-------|-------|----------|
| The tool is in the list for its kind. Default no tool. | Required | Required |
| The tool is a client tool of the chat, with an `execute`. | Required | Required |
| The arguments pass the tool's schema, and the kit can check that schema in full. | Required | Required |
| The tool needs approval for the arguments. | Refused, as a query runs with no click | Asks the user first, with the tool's own prompt |
| The chat is busy. | Runs | Refused: the mutation fails, and the user clicks again once the reply ends |
| When it runs. | Once the program is complete, and when a `$variable` in its arguments changes | On a click, as a step of a button's action |

A query shows its defaults until its first result, and while the program streams. A query that
fails keeps its defaults, and the kit logs why. A program can ask for an automatic refresh, and
`minRefreshSeconds` holds the interval to a floor of 10 seconds. The refreshes stop when the
message goes away.

A mutation is a step of a `state` action, so its button says what it runs before the click, such
as `Runs the tool save_filter with {"region":"emea"}`. A mutation that fails stops the steps after
it. The program reads `saved.status`, `saved.data` and `saved.error`.

A call from a program is not part of the history. The model does not see its result, unless a
`@ToAssistant` sends it. A tool that the server runs cannot be called from a program.

**Avoid:** listing a tool that changes data in `queryTools`. A query runs with no click, as often
as its arguments change.

### Read what the parser found

lang-core drops what it cannot use and renders the rest. The document segment of a program
carries what it found, for an inspector, a log or an eval:

```typescript
import {isOpenUiDocumentSegment} from '@xh/hoist-chat-kit/genui/openui';

catalog.parseText(text, {messageId, partId}).forEach(segment => {
    if (!isOpenUiDocumentSegment(segment)) return;
    const {errors, unresolved, orphaned} = segment.openui;
    // errors: props and inline calls that the parser dropped
    // unresolved: names the program refers to and does not define
    // orphaned: statements that nothing under the root refers to
});
```

Problems with whole statements are in the segment's `elementErrors`, by element id. Each such
element renders as a fallback.

### Export the OpenUI library for a server

A server that runs the loop loads the prompt from a build-time export, as for other modes. See
[Export the catalog for a server](../README.md#export-the-catalog-for-a-server). The format adds
its own entry to the export, under `formats.openui`:

```typescript
const json = catalog.toExport({modes: ['openui']});
// json.formats.openui: {root, schema, components, prompt}
```

A server that checks programs with Thesys's own parser loads `schema` and `root`. A server that
writes its own prompt reads the signatures in `components`. The build script that writes the
export needs lang-core installed where it runs.

### Map component names for a client's prompts

By default, each OpenUI name is the catalog name with its first letter in uppercase, such as
`Stack` for `stack`. A client whose prompts and evals use other names can map them. This one keeps
the names `Table` and `BarChart`:

```typescript
import {upperFirst} from 'lodash';

const NAMES = {grid: 'Table', chart: 'BarChart'};

openUiLangFormat({
    root: 'stack',
    componentName: spec => NAMES[spec.name] ?? upperFirst(spec.name)
});
```

The model writes `Table(...)`, and the kit renders the catalog's `grid`. Each name must be unique,
start with an uppercase letter, and hold only letters, digits and `_`.

### Narrow what a slot accepts

By default, every slot accepts every catalog component. `slotAccepts` narrows a slot, by catalog
name: component, then slot, then the components it accepts. The schema and the signature then
list only those:

```typescript
openUiLangFormat({
    root: 'stack',
    slotAccepts: {stack: {default: ['text', 'metrics', 'grid', 'chart']}}
});
```

The default examples follow the root's `default` slot. A component that the slot does not accept
gets no example.

### Render a program sent in a data part

A server that sends UI apart from the reply's text can send the program in a data part, as an
`xh.chat.data` event or an AG-UI `ACTIVITY_SNAPSHOT`. Register `openUiLangAdapter()` with the
catalog's data renderers:

```typescript
import {openUiLangAdapter} from '@xh/hoist-chat-kit/genui/openui';

const chatModel = new ChatModel({
    transport,
    catalog,
    dataRenderers: catalog.createDataRenderers([openUiLangAdapter({root: 'stack'})])
});
```

The part's `dataType` is `openui` by default. Its `data` is the program as a string, or an object
with the program in `program`. The program renders element by element while the reply streams.
Pass the same library options as the format, so both read the same names.

### Write prompt examples with `formatOpenUiProgram()`

By default, the prompt holds one example per component with an `example`, inside the root.
`formatOpenUiProgram()` writes a document as a program, in the form the model writes. Use it for
examples of your own, and for scripted demos and specs:

```typescript
import {
    formatOpenUiProgram,
    openUiLangFormat,
    toOpenUiLibrary
} from '@xh/hoist-chat-kit/genui/openui';

const library = toOpenUiLibrary(catalog, {root: 'stack'}),
    program = formatOpenUiProgram(catalog, library, {
        root: 'root',
        elements: {
            root: {component: 'stack', props: {direction: 'column'}, children: ['rev']},
            rev: {component: 'metrics', props: {metrics: [{label: 'Revenue', value: 1250000}]}}
        }
    });
// root = Stack([rev], "column")
// rev = Metrics([{label: "Revenue", value: 1250000}])

const format = openUiLangFormat({root: 'stack', examples: [program]});
```

Build the library with the same options as the format. `examples` replaces the default examples.
`formatOpenUiProgram()` writes a `send` action as `@ToAssistant(...)` and an `openUrl` action as
`@OpenUrl(...)`. It skips `navigate`, `callTool`, `app` and `state` actions. OpenUI Lang has no
syntax for the first three, and a `state` action keeps its steps in the state of its program.

## Properties/API Reference

### OpenUiLangFormatOptions

Options for `openUiLangFormat()`. Extends `OpenUiLibraryOptions`.

| Property | Type | Description |
|----------|------|-------------|
| `root` | `string` | Catalog name of the root component, a container with a `default` slot. Required. |
| `componentName` | `(spec) => string` | The OpenUI name of a catalog component. Default the catalog name with its first letter in uppercase. |
| `slotAccepts` | `Record<string, Record<string, string[]>>` | The components each slot accepts, by catalog name: component, then slot. Default every component, for every slot. |
| `inline` | `boolean` | True to read fenced programs and keep the text around them as markdown. False to read the whole text as one program. Default true. |
| `examples` | `string[]` | Programs to show the model in the prompt. Default one per component with an `example`, inside the root. |
| `preamble` | `string` | The first paragraph of the prompt section. Default a line that introduces OpenUI Lang. |
| `additionalRules` | `string[]` | Rules for the model, added after the kit's own rules. |
| `bindings` | `boolean` | True to run `$variables`, the expressions that read them, `@Set` and `@Reset`. Default false, or true when a tool is listed. |
| `builtinFunctions` | `boolean` | True to run the built-in functions, such as `@Count` and `@Each`, and to list them in the prompt. Default the value of `bindings`. |
| `queryTools` | `(string \| OpenUiToolSpec)[]` | The chat tools that `Query()` may call. Default none: a query keeps its defaults. |
| `mutationTools` | `(string \| OpenUiToolSpec)[]` | The chat tools that `Mutation()` may call, on a click. Default none: a mutation fails. |
| `minRefreshSeconds` | `number` | The least seconds between two automatic refreshes of a query. Default 10. |

The format's `version` covers `inline`, `examples`, `preamble`, `additionalRules`, `root` and
`slotAccepts`, so a change to one changes `catalog.version`. It covers the state options too, once
one of them is on. A format with none of them keeps the version it had.

### OpenUiToolSpec

A chat tool that a program may call, as the prompt describes it. A `ChatToolSpec` serves as one.

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Name of the tool, as the chat's `tools` list it. Required. |
| `description` | `string` | What the tool does, for the model. |
| `parameters` | `PlainObject` | JSON Schema of the tool's input, so the model knows its arguments. |
| `returns` | `PlainObject` | JSON Schema of the tool's result, so the model can write the defaults of a query. |

### OpenUiLibraryOptions

Options for `toOpenUiLibrary()`: `root`, `componentName` and `slotAccepts`, as above. `bindings`
marks each state prop as `$binding<type>`, and `toolCalls` offers `@Run` to a prop that takes
`state` actions. The format sets both from its own options. The library
throws when the root is not a catalog container with a `default` slot, when a name is not a valid
OpenUI name or is not unique, when `slotAccepts` names a slot that does not exist, and when a slot
would replace a prop of the same name.

### OpenUiLibrary

What `toOpenUiLibrary()` returns.

| Property | Type | Description |
|----------|------|-------------|
| `schema` | `LibraryJSONSchema` | The library's JSON Schema, for lang-core's parsers and prompt generator. A definition per component, under `$defs`. |
| `root` | `string` | OpenUI name of the root component. |
| `components` | `Record<string, {signature, description}>` | The prompt signature and description of each component, by OpenUI name. The description ends with a `Props:` line of prop guidance, capped at 600 characters. |
| `toCatalogName` | `(openUiName) => string` | The catalog name of a component, by its OpenUI name. Null for an unknown name. |
| `actionSteps` | `string[]` | The action steps that some component accepts, such as `ToAssistant`. A step that is not here has no prop to go in. |

### The format's export

The format's `toExport()` is the entry under `toExport().formats.openui`.

| Property | Type | Description |
|----------|------|-------------|
| `root` | `string` | OpenUI name of the root component. |
| `schema` | `LibraryJSONSchema` | The library's JSON Schema. |
| `components` | `Record<string, {signature, description}>` | The signature and description of each component. |
| `prompt` | `string` | The format's prompt section, as `toPrompt()` writes it. |

### OpenUiLangAdapterOptions

Options for `openUiLangAdapter()`. Extends `OpenUiLangFormatOptions`. The adapter uses the
library options, and the options for state and tools.

| Property | Type | Description |
|----------|------|-------------|
| `dataType` | `string` | The `dataType` of the data parts that hold a program. Default `openui`. |

### Actions

`openUiToAction()` turns an action expression into a `ChatUiAction`, which the catalog checks
before it runs:

| OpenUI Lang | Kit action |
|-------------|------------|
| `@ToAssistant(message, context)` | `send`. The text is cut to 200 characters. The context becomes a flat object of at most 8 entries, each a string, number or boolean, with a string cut to 100 characters. A nested value becomes its JSON. A context that is not an object becomes `{value: ...}`. |
| `@OpenUrl(url)` | `openUrl`. `urlAllowList` still applies. |
| `@Name(...)`, for an action in `schema.actions` | `app`, with the call's arguments as its params. `toOpenUiLibrary()` declares no `schema.actions` yet. |
| `Action([...])` | Its one step the kit can run: the first `send`, or else the first step. The kit drops the rest with a warning. With state on, one `state` action that runs every step in order. |
| `@Set`, `@Reset`, `@Run` | No action, and the kit drops the prop. With state on, a `state` action. |

With state on, lang-core evaluates each action first. One step that is a `@ToAssistant`, an
`@OpenUrl` or a library action is that kit action. Anything else is a `state` action: its
`summary` says what each step does, and the program's state holds the steps. A `state` action
takes at most 8 steps, and a summary of at most 1,000 characters. The kit drops a longer one. A
`@ToAssistant` among the steps sends the values its button showed, through the catalog's own
checks. A step that fails stops the rest.

Where a prop's action schema requires a `label`, as the built-in card's actions do, the kit fills
one: the text of a `send`, cut to 40 characters, or the host of an `openUrl`.

With a catalog, the kit drops an action that the prop's action schema refuses, with a warning. It
checks the action's type, and the url of an `openUrl` against the schema's pattern. The element
keeps its other actions. An action list left empty stays empty, or drops where the schema sets
`minItems`.

### Functions

| Function | Description |
|----------|-------------|
| `openUiLangFormat(opts)` | The OpenUI Lang text format, named `openui`. |
| `openUiLangAdapter(opts)` | A `ChatUiAdapter` for a program in a data part. |
| `toOpenUiLibrary(catalog, opts)` | A catalog as an OpenUI library. |
| `openUiToDocument(result, library, opts)` | lang-core's parse result as a document, with the parser's errors, undefined names and unused statements. For a format or adapter of your own. |
| `isOpenUiDocumentSegment(segment)` | True for a document segment that the format parsed, which carries `openui`: what the parser found. |
| `openUiToAction(node, library)` | An action expression as a `ChatUiAction`, or null. |
| `formatOpenUiProgram(catalog, library, doc)` | A document as a program, for prompt examples, specs and scripted demos. |
| `isChatUiActionSchema(schema)` | From `/genui/`. True for a schema that `chatUiActionSchema()` returned. |

## Extension Points

- **Names** - `componentName` maps catalog names to the names a client's prompts use.
- **Slots** - `slotAccepts` narrows what each slot accepts, in the schema and the prompt.
- **Prompt text** - `preamble`, `examples` and `additionalRules` change the format's section.
  The catalog's `instructions` add guidance for every mode.
- **A format of your own** - build the library with `toOpenUiLibrary()`, parse with lang-core,
  and translate with `openUiToDocument()`. Wrap them in a `ChatUiTextFormat` for another way to
  find programs in text. See [Add a text format](../README.md#add-a-text-format).
- **Fallbacks and placeholders** - the catalog's `fallback` and `placeholder` draw them for
  OpenUI programs too.

## Common Pitfalls

### Cloning the action schema

The library finds an action prop by the exact object that `chatUiActionSchema()` returned. A
clone, such as one from `cloneDeep()` or a spread, is a plain object prop to the library. The
prompt then does not teach the model to write `@ToAssistant(...)` in that prop.

```typescript
// ✅ Do: Place the schema as the helper returns it
properties: {action: chatUiActionSchema({types: ['send']})}

// ❌ Don't: Clone it, which hides it from the OpenUI library
properties: {action: {...chatUiActionSchema({types: ['send']}), description: 'On click.'}}
```

A second copy of the kit in the app's bundle has its own set of action schemas, with the same
result.

### A root with no default slot

The root holds the rest of the program as its children, so it must list `default` in `slots`.
`toOpenUiLibrary()` throws for a root without one, and for a root that is not in the catalog.

### Lowercase OpenUI names

lang-core reads a lowercase call, such as `stack(...)`, as a reference to a variable. A
`componentName` that returns a lowercase name throws. Keep the default, or return names that
start with an uppercase letter.

### Teaching `$state` in an app prompt with state off

By default the kit does not run OpenUI state, queries or mutations, and its rules tell the model
not to use them. An app prompt or eval set that teaches `$state`, `Query()` or `Mutation()`
contradicts those rules. The kit drops each prop that holds one, so the UI renders, but without
that behavior. Turn on `bindings`, and list the tools, to run them.

### Binding a `$variable` to a prop that is not a state prop

A `$variable` binds both ways only in a prop that its component lists in `stateProps`. In any
other prop it is read. A component of your own that shows an input must list the prop, and write
it with `context.setProp()`.

```typescript
// ✅ Do: List the prop, so that a $variable binds to it
stateProps: ['value'],
render: ({value}, {setProp}) => select({value, options, onChange: v => setProp('value', v)})

// ❌ Don't: Leave the prop out of stateProps - the kit then drops a $variable written there
render: ({value}) => select({value, options})
```

### Expecting a state action to run on a prop that does not take one

A `@Set`, `@Reset` or `@Run` becomes a `state` action. A prop runs it only if its schema lists
`state` among its action types. The built-in card takes `send` by default, so the kit drops a
`@Set` there, with a warning. The prompt offers each prop only the steps it accepts.

### Expecting a reply loaded from history to keep its state

The state of a program lives with the component that shows it. A thread that loads again shows
each program from its declared defaults.

### Forgetting Zod

lang-core imports Zod as it loads. Install `zod` with `@openuidev/lang-core`, or the app's build
fails to resolve it.

### Letting lang-core send install telemetry

lang-core runs a script that sends telemetry when it installs, unless `OPENUI_TELEMETRY_DISABLED`
is `1`. Set that variable in the environment of every install, CI included. With pnpm, also
refuse the package's build script, so it never runs. The kit lists
`'@openuidev/lang-core': false` under `allowBuilds` in its `pnpm-workspace.yaml`, and sets the
variable in CI.

## Related Packages

- [`/genui/`](../README.md) - the catalog, text formats, the document model and adapters
- [`/desktop/cmp/genui/`](../../desktop/cmp/genui/README.md) - the built-in components, including
  the stack and text that suit a program's root and prose
- [Protocols](../../docs/protocols.md#openui-thesys) - how OpenUI relates to the kit
