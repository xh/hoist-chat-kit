# Interrupts

The spec for item 4 of `planning/AG-UI.md`. A server agent asks the user a question, or asks to
run a tool, and the kit answers in the next run. It builds on D84 to D87. Anselm reviews it before
any code. Anselm's answers to its open questions are folded in.

## What AG-UI 1.0 requires

Interrupts are standard AG-UI 1.0 only (D86). The rules the kit must follow, from the spec's
`interrupt-resume`, `run-input` and `tool-calls` pages at `89cedd3`:

- A run that needs the user ends with `RUN_FINISHED` and `outcome: {type: 'interrupt', interrupts}`.
  Each interrupt has an `id`, a `reason`, and may have a `message`, a `toolCallId`, a
  `responseSchema`, an `expiresAt`, a `subagentRunId` and `metadata`.
- The next run on the thread carries a `resume` list. It "MUST cover every interrupt of the run
  being continued: each one answered, or explicitly abandoned". Omission is not abandonment, and
  a client "MUST reject a resuming input that leaves an interrupt uncovered".
- An entry is `{interruptId, status, payload?, metadata?}`. `resolved` with a `payload` answers.
  `cancelled` abandons, with no payload. A denial is an answer, so it goes as `resolved`.
- An expired interrupt can only be `cancelled`.
- The resumed run keeps the thread, the history and the state, with a new `runId`.
- `reason` is an open string. A client must not fail on one it does not know.
- `responseSchema` is a JSON Schema, carried opaquely, with no draft named.

The kit uses the client's helpers. `getRunOutcome()` reads the outcome, and
`isInterruptExpired()` judges expiry. `buildResumeArray()` builds the list, and throws if an
interrupt has no entry.

## Model

**The open set.** `ChatModel` holds the thread's open interrupts, as the official client's
`pendingInterrupts` does. A `RUN_FINISHED` with an interrupt outcome replaces the set. Any other
`RUN_FINISHED` clears it. A `RUN_ERROR` leaves it alone. Each interrupt in the set is a
`ChatInterrupt`: the AG-UI `Interrupt` plus the kit's `response`, null until the user acts or the
kit declines it. The set is keyed to the run that raised it, as ids are unique only within a run.

**Recording on the reply.** The reducer reads the outcome with `getRunOutcome()`, and copies the
interrupts onto the reply as `metadata.interrupts`, for display and storage. A reply that holds
only interrupts does not fail as `empty-response`. The reply takes the existing `paused` status,
and its finish reason stays `other`. A `RUN_ERROR` after the interrupt outcome fails the reply as
usual. The reply then shows no answer panels, and the set goes out declined on the next request.

**Loading.** `loadMessages()` restores the set from the last reply when it is `paused` with
`metadata.interrupts`. A thread store in server mode must report open interrupts that way in its
history. A set that was declined but not yet delivered when the user retried or regenerated lives
only in memory, and a reload loses it. The server then re-raises the interrupts on the next run,
which the spec allows.

**Server calls.** On an interrupted run, a call with no result that names no kit tool is the
server's. The kit marks it `providerExecuted` and `awaitsResume`, so `runToolCallsAsync` never
runs or fails it. Settling never writes a
result to such a call. Stop, a new message and `restoreMessages()` leave it as it is, and its
interrupt's response shows what happened. The encoder keeps it in its assistant message's
`toolCalls`, with no tool message, until the server sends a result. An adapter that merges by id,
such as LangGraph's, would otherwise drop the call.

**Pausing.** After a step, the kit runs any client calls first. The turn pauses while a client
call waits or the set has an interrupt with no response. `isAwaitingUser`, `waitingToolCalls` and
the thread layer's awaiting threads count open interrupts. The composer's status region then shows
"Waiting for your answer above.", as for client approvals. A new getter, `openInterrupts`, lists
the set's interrupts with no response. A new callback, `onTurnPause`, fires when a turn pauses, so
a store can save the paused reply. `onTurnComplete` never fires for a pause.

**Answering.** Two new `ChatModel` methods:

```ts
answerInterrupt(interruptId: string, payload?: unknown): void
declineInterrupt(interruptId: string): void
```

Each records the response on the set and on the reply, and either can be called again to change
it. Neither is blocked by `sendBlocker`, as D35 exempts every answer. A third method sends them:

```ts
submitInterruptsAsync(): Promise<void>
```

It runs once every interrupt has a response and no client call waits. It sends a `continue` step
with the client calls' results and the full resume list. A resume never answers some interrupts
and not others. With one question, picking a choice button answers and submits in one click.
With several, the panel ends in a review step with Submit, as Claude Code's does.

**The request.** `ChatModel` builds the list with `buildResumeArray()`, so the coverage check runs
for every transport. `ChatRunRequest` gains `resume`, the AG-UI `ResumeEntry` list, or null.
`AgUiCodec` sends it as `RunAgentInput.resume`, and `ScriptedChatTransport` passes it to
`respond`. The field takes AG-UI's name. The reserved `ChatTransport` method that reattaches to a
running run, once `resume`, is now `reconnect`, after AG-UI's `connect`. A new `supportsInterrupts` flag says whether a transport can carry `resume`. It is
true for `ScriptedChatTransport`, and for an HTTP transport whose codec sets it, as `AgUiCodec`
does. When a run ends with interrupts the transport cannot answer, the reply fails with code
`unsupported-interrupt`, so no answer is silently dropped.

**History on the resumed run.** The whole history goes, per D85. With `newMessagesOnly`, a resume
leaves out the server's calls, so a resume with no client results sends an empty `messages` list,
which AG-UI allows.

**Delivery.** A response is delivered once a run that carried it finishes. Until then, every
request on the thread, whatever its trigger, carries the whole set:

- **A new message, retry, regenerate or edit** while interrupts are open declines them all, in the
  first request of the new turn. The kit captures the set before the new turn replaces the history.
- **Stop, clear and loading another thread** decline the open interrupts locally. Their `cancelled`
  entries go with the next request on that thread. A cleared chat has none, as the thread is gone.
- **A resumed run that fails** leaves the responses undelivered. Try Again sends them again.
- **A resumed run the user stops** ends with no `RUN_FINISHED`. Its responses go out again as
  `cancelled`, so an approval the user stopped never goes out twice.

**Expiry.** An interrupt past its `expiresAt` disables its controls and shows "Expired", on the
chat's clock. It counts as having a `cancelled` response. Expiry never sends a run by itself. If
every interrupt has expired, the next message declines them. The kit checks expiry again when it
builds the request, so an answer to an interrupt that expired meanwhile goes as `cancelled`.

**Sub-agents.** An interrupt with a `subagentRunId` names the sub-agent in its panel. A
`SUBAGENT_FINISHED` with a `suspended` outcome sets the sub-agent's part to a new `waiting`
status, which settling leaves alone. A later `SUBAGENT_STARTED` with the same id sets it running.

## Approvals

An interrupt with a `toolCallId` that names a server call in the reply asks to run that tool. The
kit marks the call `approval-requested`, and the existing Allow and Deny panel renders on it, with
the interrupt's `message` as its prompt. `approveToolCallAsync()` and `denyToolCallAsync()` work
on it. Each answers the interrupt and sets the call's state, and neither runs anything locally.
A `toolCallId` that names no such call, a client tool's call, or a call with a result, renders
as a question.

AG-UI does not say how to express approve and deny. Adapters disagree:

| Adapter | Approve | Deny |
|---|---|---|
| Strands, Mastra, Antigravity, most others | `{approved: true}` | `{approved: false}` |
| ADK | `true` or `{confirmed: true}` | `false` or `{confirmed: false}` |
| Claude Managed Agents | `"allow"` | `"deny"` |
| Claude Agent SDK | `{behavior: 'allow'}` | `{behavior: 'deny'}` |

The kit follows the `responseSchema` when it has one:

- A boolean property named `approved` or `confirmed` sends `{approved}` or `{confirmed}`.
- A string enum property that holds `allow` and `deny` sends `{behavior: 'allow'}`, under that
  property's name.
- A top-level string enum that holds `allow` and `deny` sends the bare string.
- A string `reason` or `message` property takes the user's optional reason.
- Any other schema renders as a question on the call, with no Allow and Deny.

With no schema, the kit sends `{approved}`, with `reason` when the user gave one. Deny goes as
`resolved`, as the spec intends. Approve with edited arguments, `editedArgs`, waits for an adapter
that reads it. None does today.

The timeline shows a panel for each waiting approval, not only the first.

## Questions

An interrupt with no `toolCallId` is a question. Its panel shows the `message` and an answer
control, chosen from the `responseSchema`:

| Schema | Control | Payload |
|---|---|---|
| None | A text box with Send. | The text, or no payload when empty. |
| An object whose only property is one choice of three options or fewer | One large button per option. A click answers. | `{field: option}` |
| A string `enum`, or a `oneOf` of `const` strings | One large button per option, or a list past three. | The bare string. |
| A `boolean` | Yes and No buttons. | `true` or `false`. |
| A flat object of simple fields | A Hoist form, with Send. | The object. |
| Anything else | The message, with "This question cannot be answered here." | None. Decline only. |

Every panel also offers Decline, which sends `cancelled`.

A **flat object of simple fields** is `type: 'object'` whose properties are each:

- text: `string`, as `textInput`. With `format: 'date'`, `dateInput`, sent as `YYYY-MM-DD`.
- a number: `number` or `integer`, as `numberInput`, with `minimum` and `maximum`.
- a switch: `boolean`, as `switchInput`.
- one choice: a string `enum`, or a `oneOf` of `{const, title?, description?}`.
- several choices: an `array` whose `items` is one choice.

`title` labels a field, `description` explains it, `default` fills it, and `required` marks it.
An optional field left empty is left out of the payload.
Before it classifies a schema, the kit reads the shapes Pydantic writes. It inlines a local
`$ref` into `#/$defs`, and reads `anyOf: [X, {type: 'null'}]` as an optional X. It does this only
where the result is one of the shapes above. The kit refuses a schema that still uses keywords it
cannot check, as the catalog does (D32), with `findSchemaProblems()`. It checks the answer with `validateSchema()` before it sends it. The form
runs on Hoist's `FormModel`, `formField` and the desktop inputs.

## Look and placement

The surface follows Claude Code's clarifying questions:

- A framed panel in the attention color, apart from the reply's text.
- A small header that names who asks: the sub-agent, or the assistant.
- The question in body text.
- Choices as large, full-width rows, each with its label and, from `oneOf`, a description. They
  form an ARIA radio group, or a group of checkboxes for several choices.
- Send and Decline at the foot. Decline is quiet, never the primary action.

Placement:

- A question shows at the foot of the reply, below its text, and in the timeline's `paused` state
  for agent replies.
- An approval shows on its call, as client approvals do now.
- Several questions share one panel, a step per question, in the order the run sent them, then a
  review step that lists the answers with Submit. The user can step back to change one.
- Once answered, a panel shrinks to one line: "You chose Weekly", "Declined" or "Expired". The
  line stays in the transcript.

Focus moves to the first control only on the rules the approval panel uses now. No keyboard
shortcut answers (D66). The status region announces the pause, as it does for approvals.

## Docs, demo and tests

- **Docs:** an "Answer an agent's questions" section in `core/README.md`. The interrupt fields in
  the transport README's event table, and the protocols support table. D88 for the choices here.
  A store that saves a reply on `onTurnComplete` misses a paused one, so the threads README says
  to save on pause too.
- **Toolbox:** a scripted demo, with a question, a form and a server approval, branching on
  `request.resume`. The LangGraph note says to set `emitInterruptOutcome: true`, per D86. A scripted helper, `interruptEvents()`, ends a run with the outcome.
- **Specs:** the reducer records the outcome. The set replaces, clears and survives `RUN_ERROR`.
  The turn pauses, resumes once every interrupt has a response, and sends a full `resume` list.
  Client calls and interrupts in one step. A new message, retry and regenerate decline. Stop
  declines on the next run. A stopped resume goes as `cancelled`. Expiry. Reload. A failed resume
  resends. Server calls never get a kit result. An unsupported transport fails the reply. The
  approval payload conventions. The schema classes. The panel's controls.

## Settled with Anselm

1. A top-level string enum or boolean renders as choice buttons or Yes and No, with the bare value.
2. The request field is `resume`, after AG-UI. `ChatTransport.resume()` is now `reconnect()`.
3. Several questions end in a review step with Submit, as Claude Code's do.
4. Pydantic's local `$ref`s and nullable `anyOf` are read where that stays simple. Anything that
   bends the design waits for a confirmed need.
5. `onTurnPause` is enough for saving a paused reply.
