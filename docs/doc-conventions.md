# Documentation Conventions

How to write and maintain the documentation for Hoist Chat Kit.

Docs are part of the product. A component or feature is not done until its docs are written and
indexed. The docs ship in the npm package next to the source, as hoist-react's do.

This kit uses the same documentation structure as hoist-react: package READMEs, a `docs/README.md`
index, and a `docs/doc-registry.json` catalog. hoist-react's MCP server and Toolbox's doc viewer
both read that catalog format. Matching it keeps the option open for either tool to serve these
docs later, with no rewrite.

## What to Write

| Doc | Where | Covers |
|-----|-------|--------|
| Package README | `<package>/README.md`, one per source package | What the package does, its classes, and how to use them |
| Concept doc | `docs/<topic>.md` | A topic that spans packages, such as message streaming or theming |
| Documentation index | `docs/README.md` | Every doc, with a description and key topics, plus a "Quick Reference by Task" table |
| Doc registry | `docs/doc-registry.json` | The same catalog, in the JSON schema that hoist-react's tools read |
| Root README | `README.md` | What the kit is, how to install it in an app, and where the docs start |
| CHANGELOG | `CHANGELOG.md` | One entry per change that an app developer can see |

Doc comments in the code are the API reference. Write them on every exported class, interface,
config property, and public method. The READMEs explain how the parts fit together. They do not
restate every property.

## Package README Template

Each package README has these seven sections, in this order. Leave out a section only when it has
nothing to say.

1. **Overview** - what the package does and why it exists. List the key features.
2. **Architecture** - the key classes and how they relate. Use an ASCII tree for a class with
   important members:

    ```
    ChatModel
    ├── messages: ChatMessage[]     # Conversation, oldest first
    ├── isStreaming: boolean        # True while a response arrives
    └── Methods:
        ├── sendAsync()             # Send the draft and await the reply
        └── clear()                 # Remove all messages
    ```

3. **Configuration Pattern** - how to create and configure instances. Show constructor-based
   setup for complex models.
4. **Common Usage Patterns** - code for the typical use cases.
5. **Properties/API Reference** - tables of the key config options:

    ```markdown
    | Property | Type | Description |
    |----------|------|-------------|
    | `name` | `string` | What it does. Fold the default into the description. |
    ```

    Do not add a separate "Default" column.

6. **Extension Points** - how to customize or extend the behavior.
7. **Related Packages** - links to connected packages in this kit and in hoist-react, with
   relative paths inside this repo.

## Tone and Content

- Write for AI agents and human developers alike. Agents read these docs to write app code, so a
  missing pattern becomes a wrong guess.
- Explain why, not only what.
- Prefer patterns and relationships over an exhaustive list of APIs.
- Name the source file for the full API where it helps, for example "See `ChatModel.ts`".
- Follow the `xh:clear-writing` skill for all prose, and lint each doc with its script.

## Code Examples

- Use element factories, not JSX.
- Make each example runnable and close to real use. Show the Toolbox example when one exists.
- Use `config` for the arguments to a model or class constructor. Keep `props` for React
  component props.
- Assign `@bindable` properties directly (`model.draft = 'Hi'`). Call a `setFoo()` method only
  when the class defines one.

## Anti-Patterns

Document anti-patterns in two places:

1. **Inline warnings.** Put a short `**Avoid:**` note next to the content it applies to.
2. **Common Pitfalls.** End the README with a section for the significant ones.

Mark correct and incorrect code like this:

```typescript
// ✅ Do: Describe the correct approach
correctCode();

// ❌ Don't: Describe what is wrong and why
incorrectCode();
```

## Index and Registry

When you add or change a doc, update the index and the registry in the same change.

- **`docs/README.md`** - add a row to the right table. Paths are relative to `docs/`:

    ```markdown
    | [`/package/`](../package/README.md) | One-sentence description | Key, Topics, Here |
    ```

- **`docs/doc-registry.json`** - add an entry. The `id` is the doc's path from the repo root and
  must be unique:

    ```json
    {
      "id": "package/README.md",
      "title": "Package Title",
      "mcpCategory": "package",
      "viewerCategory": "components",
      "description": "One-sentence description, the same as in the index.",
      "keywords": ["ClassName", "concept", "related term"]
    }
    ```

    Put the class names and terms that a developer would search for in `keywords`. These drive
    search ranking.

Also add each new top-level source package to the `files` list in `package.json`, so it ships.
