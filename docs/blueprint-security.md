# Blueprint Security

What a blueprint, a chat answer and a link can reach, and what they cannot. A blueprint is data
that a person, an LLM or a link can write, so the kit treats every value in it as untrusted. The
browser checks what it can. The app's servers stay the boundary for data and storage.

Read this before you write a widget, an action, a data provider or a repository. The registry's
contracts are in [Extending Blueprints](./blueprint-extensions.md), and the format in
[Blueprint Format](./blueprint-format.md).

## The Server Is the Boundary

Nothing in the browser decides what data a user may see, or which blueprints they may open.

- **Data.** A link or a prompt can set a source param, such as `fund=OTHER`. The dataset's
  server must check the user's access to every param of every request. A catalog that an app
  narrows in the browser is a presentation scope, not a security boundary.
- **Storage.** The repository's server refuses a draft or an older publish to a reader, and
  checks write access on every save, publish, share and delete. `BlueprintDocumentModel` refuses
  them too, but a user controls their browser. A repository that cannot refuse them on a server says
  so in its docs.
- **Types.** A repository scopes every read and write to its type, so one app cannot reach
  another app's blueprints by id. `BlueprintDocumentModel` also refuses a record of another type,
  in case a repository fails to scope.
- **Nothing reveals.** A repository answers the same for a blueprint that is missing and one the
  user may not read, so a guessed id learns nothing.

## What a Blueprint Can Reach

A blueprint configures registered entries, and nothing else:

- **No code.** Config holds plain data. It names widgets, resolvers, actions and renderers from
  the registry, and holds no functions, expressions or elements.
- **Only declared values move.** A value reaches a widget's config only at a path its schema marks
  `x-binding`, and the validator checks the variable's type against it. A value in a variable or
  a source never becomes an element or an action.
- **Every key is known.** Every object refuses keys it does not know, and every value passes its
  schema, before any widget sees it. A chart's `highchartsConfig` is the one exception below its
  top level, with its own guards. An ID is never `__proto__`, `prototype` or `constructor`.
- **Bounded size.** Inline sources hold at most 50 rows outside an answer, a `dashContainer`
  layout at most 20,000 characters, and a chart's `highchartsConfig` at most 20,000 characters
  and 10 levels.

## Text Never Becomes Markup

Text from a blueprint, its data or a model reaches the screen as text:

- **Highcharts.** Highcharts reads titles, labels, categories and formatter output as HTML. Every
  built-in chart widget escapes them, and an app's chart widget must too.
- **Markdown.** `markdown` and `callout` render through `chatMarkdown`, which blocks raw HTML and
  images. A template's values fill in as text.
- **Renderers.** A renderer draws values with components, and uses the field's format for text.
  It never treats a value as markup.
- **Data.** A field's values show through its format and renderer, never as HTML.

## A Chart's Highcharts Options

A `chart` may pass a few Highcharts options straight through, in its `highchartsConfig`. The
validator allows only `title`, `subtitle`, `legend`, `tooltip`, `xAxis`, `yAxis`, `plotOptions` and
`chart` at its top, and refuses, anywhere inside:

- Text that holds `<`, text that loads from a URL with `url(`, and a backslash in a style.
- The options `renderTo`, `useHTML`, `events`, `series`, `data`, `plotBackgroundImage`, `href`,
  `url`, `libURL` and `src`. `plotOptions.series` stays allowed, as it holds options for every
  series.
- An axis's `categories`, and `keys` under `plotOptions`, which would remap the chart's data.
- Any binding, which would reach the chart unchecked.

Each refusal is `chart.highchartsConfig`, at the path of the refused value. A binding also shows
as `schema.invalid`, from the config's schema check.

## A Grid's Styles

A grid's conditional styles take a closed allowlist, stricter than `highchartsConfig`'s refusals.
Each key takes a value from a list, or a color matching `^#[0-9a-fA-F]{6}$`, so no style can spell
`url(`, `var(` or an expression. A binding goes only in a rule's `when`, never in its style. The
widget maps each value to CSS itself, and drops anything outside the list.

## What an Action Can Do

- **Typed and checked.** An action names a registered type. The runner checks every step's params
  against the type's schema before the first step runs, and runs at most 8 steps.
- **What it shows is what it runs.** An action's description, built from its resolved params, is
  its tooltip and the text of any confirmation.
- **Limited writes.** An action sets only a variable a link could set, never one an output or a
  resolver sets.
- **Side effects ask.** An action type that changes data declares `sideEffects: true`. It always
  asks the user to confirm, and a chat answer cannot use it.
- **URLs on a list.** `openUrl` opens only http and https URLs that the app's `urlAllowList`
  permits, and the list is empty by default. An entry matches by parsed origin and path prefix,
  so `https://a.com` does not allow `https://a.com.evil.com`.
- **Drill-ins open as links do.** `openBlueprint` opens its target through the host's repository,
  as the user, so it opens only what the user may read, of the same type. Its values pass through
  the target's link parser, with every limit a link meets. It opens read only, cannot open
  another, and a chat answer cannot use it.
- **Params stay untrusted.** An app action's `run` gets params that passed the schema, but a
  model or a user may have chosen them. Check them as the app checks any input.

## What a Chat Answer Can Do

A chat answer is a blueprint that an LLM writes during a reply:

- It only reads. It cannot use an action with side effects, or one not allowed in answers.
- Its dataset sources load within the chat's bounds: only the latest reply loads at once, every
  load draws on the chat's budget for the minute, and an artifact over 5,000 rows does not load.
- It has no design mode and no publishing, and it is fixed once its turn ends.
- To change a dashboard, the Architect needs design mode, which a user with write access approves
  on the chat's card. The edit tools check mode and access on every call, whatever the prompt
  says.

## What a Feature Request Can Send

- Nothing without the user's approval, on a card that shows every field it sends.
- Only the user's own words: `userWords` must appear word for word in one of their messages.
- No data: a `fragment` is config only, and the kit refuses one with inline rows or artifacts.
- At most one a turn. The app's server checks each request again, and caps each user's count.

## What a Link Can Do

A link opens a blueprint by its id, and sets state:

- It sets only presets, and variables that a link may set: a prompt, an action variable, or a
  widget's value. It never sets a `filter`, and never runs an action.
- Each value takes its type's text form, and must fit the type and the variable's options. A
  value that does not fit is dropped, and one notice names what was ignored.
- A link drops a value past 1,000 characters, a list past 100 items, and every value past
  8,000 characters of params.
- A link to a draft or an older publish opens the latest publish for a reader. A link to a
  blueprint of another type, or one the user may not read, opens nothing.
- Its values reach config only at bindable paths, and the dataset's server still checks every
  param.

## Common Pitfalls

### Trusting the browser for access

`BlueprintDocumentModel` refuses drafts to readers, and an app can narrow its catalog, but a user
controls their browser. Refuse on the server, in the repository and in each dataset's request.

### Passing text to Highcharts unescaped

A field label, a category value or a title can hold `<script>` or an image tag with an
`onerror`. Escape every string a chart widget hands to Highcharts, including formatter output.

### Allowing an origin by string prefix

`url.startsWith('https://a.com')` also allows `https://a.com.evil.com`. Pass URLs through
`urlAllowList`, which parses them, rather than checking them yourself.
