// The reasons shared by several gaps.
const STATE = 'The kit keeps no AG-UI state. Plan item 6.',
    METADATA = "The kit drops a message's or tool call's metadata. Plan item 5.",
    SUBAGENT_TEXT = 'The kit does not attribute text to its sub-agent. Plan item 5.',
    SNAPSHOT = 'The kit ignores MESSAGES_SNAPSHOT. Plan item 7.',
    ERA = 'An era shim for an older peer, which the spec permits but does not require.';

/**
 * Fixtures of the AG-UI 1.0 conformance corpus that the kit fails, by name, with the checks each
 * fails and why. `AgUiConformance.spec.ts` asserts this list exactly: a fixture that starts to
 * pass, or fails a different set of checks, fails the run until its entry changes.
 *
 * The check names are the corpus's `expect` keys, plus `messageIds` - the messages compared with
 * their ids. The plan items named are those of `planning/AG-UI.md`.
 */
export const KNOWN_GAPS: Record<string, {checks: string[]; reason: string}> = {
    // Shared state.
    'conformant-run-is-quiet': {checks: ['state'], reason: STATE},
    'open-object-patch-op-extras': {checks: ['state'], reason: STATE},
    'state-delta-applies': {checks: ['state'], reason: STATE},
    'state-delta-unappliable-warns-and-keeps': {checks: ['state'], reason: STATE},
    'state-delta-unknown-op-dropped': {checks: ['state'], reason: STATE},
    'state-falsy-snapshot-applies': {checks: ['state'], reason: STATE},
    'state-null-snapshot-applies': {checks: ['state'], reason: STATE},
    'state-snapshot-replaces': {checks: ['state'], reason: STATE},

    // Message assembly.
    'metadata-merges-last-write-wins': {checks: ['messages', 'messageIds'], reason: METADATA},
    'open-metadata-preserved': {checks: ['messages'], reason: METADATA},
    'tool-call-metadata-lands-on-the-call': {
        checks: ['messages', 'messageIds'],
        reason: METADATA
    },
    'subagent-unannounced-attribution-accepted': {checks: ['messages'], reason: SUBAGENT_TEXT},
    'subagent-terminal-closes-open-chunk-stream': {
        checks: ['messages', 'messageIds'],
        reason: SUBAGENT_TEXT
    },
    'encrypted-value-unknown-entity-tolerated': {
        checks: ['messageCount', 'messages', 'messageIds'],
        reason:
            'By design, the kit keeps an encrypted value with no message to land on as a ' +
            'reasoning part of its own, so that it goes back with the history.'
    },

    // Later work.
    'activity-snapshot-then-delta': {
        checks: ['messages', 'messageIds'],
        reason: 'The kit ignores ACTIVITY_DELTA. Plan item 7.'
    },
    'messages-snapshot-reconciles-by-id': {
        checks: ['messageCount', 'messages', 'messageIds'],
        reason: SNAPSHOT
    },
    'unknown-part-in-message-list': {checks: ['messageCount', 'messages'], reason: SNAPSHOT}
};

/** Fixtures that do not apply to a client other than the official ones, with why. */
export const NOT_APPLICABLE: Record<string, string> = {
    'era-0-0-39-flattens-content': ERA,
    'era-0-0-45-thinking-translated': ERA,
    'era-0-0-47-upgrades-binary-content': ERA,
    'era-0-0-57-subagent-dropped-with-warning': ERA,
    'era-current-peer-keeps-modern-content': ERA,
    'era-pinned-peer-omits-protocol-version': ERA,
    'unknown-enum-value-role-fatal':
        'An admitted gap in the official TypeScript client, which asserts the opposite of the ' +
        'spec.'
};
