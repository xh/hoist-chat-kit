# Step 14: Opening a Blueprint by URL

> **Approved as decision 150.** A link opens one blueprint, at one version, with presets and variable
> values. Items marked **John** need his decision before they are built.

## URL Shape

```
/blueprints/:id?version=3&preset=view:byStrategy&asOf=2026-11-20&fund=A&fund=B
```

- **The path holds the id, never the name.** Names change and need not be unique. The host owns
  the path, so `/blueprints` is Toolbox's choice, not the kit's.
- **Reserved query params:**
  - `version=N` opens publish N.
  - `draft` opens the draft.
  - With neither, the link opens the latest publish, which is what readers run.
  - `preset=group:item` is repeated once per group.
- **Every other param names a variable.** The validator refuses a variable named `id`,
  `version`, `draft` or `preset` (`variable.reservedName`). `id` is reserved because the router
  merges the path's `id` into the params. Params the kit does not know are left to the host.
- **Values in text form, by type:**

  | Type | Form | Notes |
  |---|---|---|
  | `string` | as is | |
  | `int`, `number` | decimal | Strict. `''` and `1e3` are refused. |
  | `bool` | `true` / `false` | |
  | `localDate` | `YYYY-MM-DD` | |
  | `period` | `3M`, `+5D` | Read by `parsePeriod`. |
  | `dateRange` | a preset token (`mtd`), or `from..to` | `from..to` becomes a custom selection. |
  | `T[]` | the param repeated | One value still reads as a list. |
  | `filter` | not settable by URL in v1 | Same as a filter with several writers today. |
  | app type matching a field type | that field type's form | |
  | app type matching no field type (portfolio) | not settable by URL, unless the type gives a codec | **John**, see D14-4 |

- **A link the kit builds ("Copy link")** holds:
  - the id;
  - `version` only when the open version is not the latest publish;
  - presets that differ from the group default;
  - URL-settable variables whose value differs from the default.

  Transient config changes, such as a resized column, stay out in v1.

**John - D14-1: the URL contract** above: the id in the path, the reserved names, unprefixed
variable names, and the value forms. The alternative is prefixed variables (`v.asOf=`). They never
collide with host params, but read worse. I recommend unprefixed, with the reserved-name check.

## Router Integration

router5 8, as Hoist configures it (`queryParamsMode: 'default'`):

- **Reading works.** A route matches with undeclared query params and puts them in
  `XH.routerState.params`, so the host's route needs to declare only `/:id`.
- **Building drops them.** `buildPath`/`buildUrl` keep only declared params in `default` mode, and
  so does `XH.navigate`, through the browser plugin. So:
  - The kit builds a link's query string itself, over `XH.router.buildUrl(route, {id})` for the
    path.
  - An in-app `XH.navigate` to a blueprint passes its variables in the route state. The address
    bar loses them, so a reload falls back to the defaults. v1 accepts this.
  - Keeping the address bar in step with live variable changes needs `queryParamsMode: 'loose'`.
    That changes `buildPath` for the whole app. Deferred (YAGNI).
- **`buildPath` throws for an unknown route.** The host passes its route name to the kit. The kit
  checks `XH.hasRoute(name)` once, and without the route it hides "Copy link" rather than throw.
- **The `navigate` action** (spec) already checks `XH.hasRoute`. `openBlueprint`, when built,
  takes the same params and goes through the same parser (below).

**John - D14-2:** v1 needs no change to hoist-react's router. If live address-bar sync is wanted
later, decide between a `RouterModel` option in hoist-react (a public API) and each app calling
`XH.router.setOption('queryParamsMode', 'loose')`.

## URL Values Are Untrusted

One pure function, `parseBlueprintLink(params, blueprint, registry)`, turns the route's params into
`{open, presets, values, problems}`. Nothing else reads URL params.

- **Who may be set.** Only variables that the spec lets a URL set: `setBy` `prompt`, a widget
  without `output`, or `action`. Output, resolver and constant variables are skipped, and so is a
  filter with several writers. Each skip adds a problem.
- **Lookups.** Variables and preset groups are found with `getOwn`, so `__proto__` and
  `constructor` name nothing. The param map is never spread into an object.
- **Parsing.** Strict per type, as in the table, then `checkVariableValue`: type, list items,
  `options.values` and date range presets. A value that fails is dropped, the variable keeps its
  default, and a problem names it. A link never fails as a whole.
- **Caps.** 1,000 characters per value, 100 items per list, 8,000 characters for the query.
  Anything past a cap is dropped with a problem.
- **Applying them.** After open and validation, before the first source load, so nothing loads
  twice:
  1. Presets, in order. An unknown group or item is a problem.
  2. Variables, through a non-user path of `setVariable`'s checks. A URL value is not a user
     action, and it is transient, never saved or personalized. Precedence:
     URL > personalization (when built) > default.
- **Where a value can reach**, after step 11's fixes:
  - Config only at `x-binding` paths, with any other binding refused (`takes no binding`).
  - Enum and range props through `fitsProp`, both at validation and at run time.
  - Dash tab titles through `plainTitle`, and the hoist-react `Tab.setTitle` fix once merged.
  - Chart text escaped, and no binding inside `highchartsConfig`.
  - Markdown values tokenized after parsing (`markdownTemplate`).
  - `openUrl`'s allow list still applies to a URL a variable supplies.

  No new rule is needed. One spec opens a link that sets every bindable title, template and enum
  prop to hostile values, as a guard against regressions.
- **App code.** A widget, renderer, resolver or action handler from the app gets URL-derived
  values. Its docs must say to treat config and params as untrusted, as `openUrl` handlers already
  do.
- **Data access.** A URL value becomes a source param (`fund=OTHER`). The dataset server must
  check entitlement for every param. The client never decides what data a user may see. This
  goes in the Data Catalog guide as a rule for app servers.
- **No actions.** A link sets state only. It never runs an action, and opens no draft or version
  for a reader.

**John - D14-3:** problems show as one dismissible notice ("Some link values were ignored: ..."),
not as silent drops. I recommend the notice, as silent drops hide a broken link.

## Access and Sharing

- **Open.** `repository.openAsync(id, opts)` already returns null for both "missing" and "not
  yours", so a link reveals nothing about a blueprint the viewer cannot read.
- **Ids and types.** The id in a link is the blueprint's stable token, the same in every
  environment (decision 160). A repository holds one type and scopes every read to it, and
  `BlueprintDocumentModel` also refuses a record of another type, so a link to another app's
  blueprint shows the denied view (decision 159).
- **Denied.** One view: "This blueprint doesn't exist, or isn't shared with you." It offers
  nothing to retry.
- **A draft or old version a reader can't open.** The kit falls back to the latest publish when
  the reader may open it, and says so ("Showing the latest published version"). Only a server
  refusal counts: `BlueprintDocumentModel` already refuses, and the repository's server is the
  boundary.
- **Sharing stays as step 10 left it** (`updateAccessAsync`, the Toolbox `ShareButton`). "Copy
  link" sits beside Share. Copying never grants access: the viewer still needs read.
- **Request access is out of v1.** It needs a repository method and a notification path.

**John - D14-5:** confirm that request-access is deferred. Adding it later means an optional
`requestAccessAsync?(id)` on `BlueprintRepository`, which changes the contract apps implement.

## Who Builds What

**hoist-react: nothing in v1.** `XH.hasRoute`, `buildUrl` and `routerState` cover it. The
`Tab.setTitle` fix (`fix-dash-tab-title-text`) is independent, but it hardens the same path.

**Chat kit (new public API, John - D14-4):**

- `parseBlueprintLink(params, blueprint?, registry?): BlueprintLinkState`. Without a blueprint
  it reads only `id` and `open`. `blueprintLinkParams(documentModel)` and
  `blueprintLinkUrl(documentModel, route)` go the other way. These are pure apart from the
  router, they are unit-tested, and `openBlueprint` reuses them.
- `BlueprintModel.applyLinkState(state)`. It applies presets and variables before the first load,
  as above.
- An optional `VariableTypeSpec.urlCodec?: {parse(text): unknown; format(value): string}` for app
  types that match no field type. Without one, the type is not settable by URL.
- `BlueprintDocumentModel.openLinkAsync(params)`. It opens, falls back to the latest publish,
  applies the link in the same tick, and shows the one notice as a warning toast. A blueprint
  the user may not open returns `openAsync`'s refusal.
- `blueprintLinkButton({documentModel, route})`, which renders nothing without the route.

**Host app (Toolbox first):**

- A route with `/:id`, such as `blueprints.open`. Its name goes to the kit's config.
- On route change: `documentModel.openLinkAsync(XH.routerState.params)`, and show its refusal
  as the denied view. Opening from the list navigates to the route, so the list and links share
  one path.
- A dataset server that checks entitlement on every param (above).
- Optionally, a `urlCodec` for each app type to set by link, such as Toolbox's portfolio.

## Order

1. D14-1 to D14-5 from John.
2. Build `parseBlueprintLink` and `blueprintLinkParams` with their specs: hostile values, caps,
   `__proto__`, reserved names, every type form.
3. Build `applyLinkState` with the spec that nothing loads twice.
4. Toolbox: the route, opening from it, Copy link, and the denied and fallback views.
5. Headless browser check: the H2 throwaway server, a reader opening a writer's draft link, and
   a hostile title value.
