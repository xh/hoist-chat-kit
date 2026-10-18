# AG-UI Conformance

The official AG-UI 1.0 consumer conformance corpus, run against the kit in every `pnpm test`.

## What is here

| File | What it is |
|------|------------|
| `ag-ui-1.0/` | The corpus, vendored unchanged from `spec/1.0/conformance/streams` in `ag-ui-protocol/ag-ui`, commit `89cedd3` (2026-10-16). MIT license. |
| `ag-ui-1.0/MANIFEST.txt` | The upstream listing of the fixtures. The runner checks the directory against it. |
| `AgUiConformance.spec.ts` | The runner. It holds the mapping from a kit reply to AG-UI messages. |
| `agUiKnownGaps.ts` | The fixtures the kit fails, with the checks each fails and why, and the fixtures that do not apply. |

## How it works

Each fixture is a stream of raw events and what a client must do with it. The runner decodes the
stream with `AgUiCodec`, as a transport does. It folds the events into a reply with
`ChatStreamReducer`, then checks the fixture's expectations against the events delivered and the
reply.

A fixture passes, or fails exactly the checks that its entry in `agUiKnownGaps.ts` names. A gap
that closes fails the run until you remove its entry. So the list always says where the kit
stands.

The corpus README asks a client other than the official ones to relax three groups, and to drop
the `expectOverrides.dotnet` blocks. The runner does this:

- It skips the SHOULD-level `warnings` and `noWarnings` checks.
- It lists the six `era-*` fixtures and `unknown-enum-value-role-fatal` as not applicable.
- It applies the `expectOverrides.typescript` blocks, because the kit runs the official
  TypeScript client's checks.

The runner also splits `messages` in two. `messages` compares the messages without their ids, and
`messageIds` compares them with their ids. Most gaps today are ids alone, so the split keeps the
other message checks visible.

## Update the corpus

1. Copy the new `streams` directory over `ag-ui-1.0/`, `MANIFEST.txt` included.
2. Change the commit and date in this README.
3. Run `pnpm test test/conformance`.
4. For each fixture that fails, fix the kit, or add a gap entry with its reason.
