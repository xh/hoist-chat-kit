# CHANGELOG Entry Format

Reference for writing and reviewing entries in the Hoist Chat Kit `CHANGELOG.md`. The kit follows
the hoist-react changelog conventions, so an entry here reads like one there.

## Entry Structure

Every major version entry uses this structure. Minor and patch releases use whichever sections
apply.

```markdown
## {VERSION} - {YYYY-MM-DD}

### 💥 Breaking Changes (upgrade difficulty: {RATING})

See [`docs/upgrade-notes/v{N}-upgrade-notes.md`](docs/upgrade-notes/v{N}-upgrade-notes.md) for
detailed, step-by-step upgrade instructions with before/after code examples.

* {Required change 1}
* {Required change 2}
    * {Sub-detail if needed}
* ...

### 🎁 New Features

* {Feature description}

### 🐞 Bug Fixes

* {Fix description}

### ⚙️ Technical

* {Internal change description}

### ⚙️ Typescript API Adjustments

* {Type-level change description}

### 🤖 AI Docs + Tooling

* {AI docs/tooling change description}

### ✨ Styles

* {CSS/SCSS change description}

### 📚 Libraries

* {Library} `{old} → {new}`
```

The topmost heading on `develop` is always the next version with a `-SNAPSHOT` suffix, as in
`## 1.1.0-SNAPSHOT - unreleased`. New entries go under it. At release time, the heading becomes
the release version and date.

## Section Headers

Use these emoji-prefixed headers consistently:

| Section | Header | When to Include |
|---------|--------|-----------------|
| Breaking Changes | `### 💥 Breaking Changes` | Required app changes exist |
| New Features | `### 🎁 New Features` | New capabilities added |
| Bug Fixes | `### 🐞 Bug Fixes` | Bugs fixed |
| Technical | `### ⚙️ Technical` | Internal changes worth noting |
| TS API Adjustments | `### ⚙️ Typescript API Adjustments` | Type-level changes (signatures, generics, exports) |
| AI Docs + Tooling | `### 🤖 AI Docs + Tooling` | Doc registry, MCP instructions, agent-facing docs |
| Styles | `### ✨ Styles` | CSS/SCSS changes, new variables, class renames |
| Libraries | `### 📚 Libraries` | Major dependency version bumps |

**Note:** TS API Adjustments and Technical share the ⚙️ emoji but are distinct sections. TS API
Adjustments covers type signature changes that can affect app compilation but not runtime behavior.
Technical covers internal implementation changes worth noting.

## Voice and Tense

- **Past tense, action-driven** for descriptions: "Enhanced", "Fixed", "Added", "Improved",
  "Removed", "Refactored"
- **Imperative** for developer instructions: "Update", "Adjust", "Remove", "Migrate"
- Avoid starting bullets with "New" (prefer "Added"), "Support for" (prefer "Added support for"),
  or present tense verbs like "Fix", "Allow", "Enable"
- Every bullet needs an explicit grammatical subject. No "Provides support for ..." or "Misc.
  improvements to ...". Open with a past-tense verb when reporting an action on the codebase, or
  with the symbol itself (`ChatModel.stop()` now ...) when a living API changed behavior.

### Examples

Good:
```markdown
* Enhanced `ChatModel` persistence to restore drafts per thread.
* Added support for `pause_turn` responses in `AnthropicCodec`.
* Fixed regression with `ChatThreadsModel.rename()` on a thread with a running turn.
```

Bad:
```markdown
* New support for drafts per thread               (use "Added", not "New support for")
* Fix to regression in ChatThreadsModel.rename     (use "Fixed regression", not "Fix to")
* Allow improved editing of past messages          (use "Enhanced" or "Added", not "Allow")
```

## Breaking Changes Section

**Every major version with breaking changes MUST include all of the following.** Do not skip or
reorder these requirements:

1. **Difficulty rating in the header** - append `(upgrade difficulty: {RATING})` to the section
   header. See Difficulty Ratings below for the rating scale.
2. **Upgrade notes link as a standalone sentence** - immediately after the header, before any
   bullets, include a sentence linking to the upgrade notes file. This is **not** a bullet point.
   It is a standalone paragraph. Use this exact format:
   ```markdown
   See [`docs/upgrade-notes/v{N}-upgrade-notes.md`](docs/upgrade-notes/v{N}-upgrade-notes.md) for
   detailed, step-by-step upgrade instructions with before/after code examples.
   ```
3. **List** every required app-level change as a separate bullet
4. **Be specific** - name exact classes, methods, and config keys
5. **Link** to relevant upgrade guides, such as a hoist-react upgrade note, when applicable

Each bullet should be concise (1-2 lines). The upgrade notes file handles expanded detail with
before/after code examples.

### Grouping by Topic (large releases only)

When a major version carries an unusually large set of breaking changes - roughly eight or more
bullets, spanning several unrelated areas - group them under `####` topic sub-headers instead of
presenting one flat list. This is a special case for big releases. Ordinary versions keep the flat
list.

- Add a short lead-in paragraph after the `### 💥` header (following the upgrade notes link) telling
  readers that the changes are grouped and which groups affect every app.
- Name groups for the area an app developer would search for: `ChatModel`, `Transports and
  Codecs`, `Generative UI`, `Threads`, `Desktop Components`.
- Order groups by how broadly they apply - kit-wide changes first, then package-specific ones.
- Keep the difficulty rating on the `###` header, summarizing the release as a whole. Do not rate
  individual groups.
- Group only Breaking Changes. Other sections (New Features, Bug Fixes) stay flat, since readers scan
  them rather than work through them.

### Deprecations and Removals

Keep them together so a reader can see every scheduled removal in one place:

- **Removals of previously deprecated APIs** go in a `Scheduled Removals` sub-list under Breaking
  Changes, one sub-bullet per removal, naming the version that deprecated it and the replacement.
- **New deprecations** that keep the API working go under Technical, and say what replaces the
  deprecated API. Put one under Breaking Changes only when it accompanies the change that replaces
  it and apps must act now.

### Difficulty Ratings

When upgrade notes exist for a major version, include a difficulty rating:

```markdown
### 💥 Breaking Changes (upgrade difficulty: 🎉 TRIVIAL)
### 💥 Breaking Changes (upgrade difficulty: 🟢 LOW - {brief description})
### 💥 Breaking Changes (upgrade difficulty: 🟠 MEDIUM - {brief description})
### 💥 Breaking Changes (upgrade difficulty: 🔴 HIGH - {brief description})
```

## Requiring a New Hoist Minimum

A `Requires @xh/hoist X or later` line in an entry is not self-enforcing. When the kit needs a
newer Hoist release:

- Raise the `@xh/hoist` range in `peerDependencies` in `package.json`.
- Update the version in the README's Installation section.
- State the new minimum in the changelog entry, as a standalone line under the version heading.

Set the floor only to what the kit genuinely cannot run without. That is normally the release the
kit's tests run against.

## Libraries Section

List major dependency version changes with backtick-wrapped versions:

```markdown
### 📚 Libraries

* @ag-ui/client `1.0 → 1.1`
* rxjs `7.8 → 8.0`
```

Use abbreviated versions where the minor or patch is not significant (e.g. `1.1` not `1.1.2`).

## General Guidelines

- **Positive tone**: Favor words like "Enhanced", "Improved", "Streamlined" where accurate.
  Concisely note *why* a change is an improvement when not obvious from context (e.g.
  "Improved stop handling - closes the connection so the server stops generating").
  Accuracy always takes precedence - bug fixes should be reported clearly as such.
- **Conciseness**: This is a changelog, not a guide. One bullet = one change, 1-3 lines max.
  Upgrade notes provide granular detail when needed. Keep changelog entries brief and scannable.
- **Specificity**: Name classes, methods, and config keys in backticks.
- **Completeness**: Changes that modify behavior, APIs, or configuration in ways developers need
  to know about should be accounted for. Trivial changes (formatting, internal refactors with no
  behavioral impact, tooling updates) do not need to be included.
- **No duplication**: Do not repeat the same change across sections. Pick the most relevant section.
- **Issue/PR links**: Do not add GitHub issue or PR links (e.g. `[#1234]`) to entries by default.
  Include one only when explicitly requested, or when it points to extensive context that
  does not fit the changelog's scope. Issue/PR references normally belong in the commit message and
  PR description, not the changelog.
- **Relevance test**: Include a fact only if a developer or agent upgrading an app needs it to adopt
  the release well. Exact counts, timings, token figures, and enumerations of CSS variables or
  similar fine-grained additions fail that test. Acknowledge such additions in general terms.
- **Library names**: In prose, name third-party libraries by their product name (AG-UI, RxJS,
  Highcharts). Package names and import paths keep their own spelling inside code spans.
- **Punctuation**: End each bullet with a period. Plain ASCII punctuation only. Use " - " for an
  in-sentence break, never an em dash.
- **Line wrapping**: Hard-wrap list item text at 100 characters. Use two-space indentation for
  continuation lines. This keeps the raw Markdown readable in editors and diffs.
