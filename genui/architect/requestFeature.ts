import {div, pre, span} from '@xh/hoist/cmp/layout';
import {type PlainObject, XH} from '@xh/hoist/core';
import type {ChatModel, ChatToolSpec} from '../../core';
import {checkFeatureRequest, type FEATURE_REQUEST_CATEGORIES} from './featureRequestCheck';
import {REQUEST_FEATURE_SPEC} from './toolSpecs';

/** A request for a capability the registry lacks, as the Architect writes it and the user approves it. */
export interface FeatureRequest {
    /** What is missing, in one line. */
    summary: string;
    category: (typeof FEATURE_REQUEST_CATEGORIES)[number];
    /** The user's words that ask for it, copied exactly from one of their messages. */
    userWords: string;
    /** What the Architect built instead, or null. */
    workaround?: string;
    /** The element or config the capability would change. Never holds data. */
    fragment?: PlainObject;
    /** Set by the kit, never the model. */
    context: {app: string; appVersion: string; user: string; submitted: number};
}

/** What a sink returns for a request it took. */
export interface FeatureRequestReceipt {
    /** An id to show the user, such as a ticket number. */
    id?: string;
    /** A line for the user, such as where the request went. */
    message?: string;
}

/**
 * Where the Architect's feature requests go, as the app implements it: its own store, or a
 * tracker. The kit sends a request only after the user approves its whole payload. A request is
 * untrusted input: check it again on the server, and cap how many each user may send.
 */
export interface FeatureRequestSink {
    /** Store or forward a request. Throw to refuse it, with a message the model tells the user. */
    submitAsync(request: FeatureRequest): Promise<FeatureRequestReceipt>;
}

/**
 * The Architect's `request_feature` tool, which sends a request to the app's sink once the user
 * approves it on the chat's card. The card shows every field the request sends. The tool refuses
 * a quote that is not the user's own words, a fragment that holds data, and a second request in
 * one turn.
 */
export function requestFeatureTool(sink: FeatureRequestSink): ChatToolSpec {
    // The user message each chat's last request answered, so a turn sends at most one.
    const lastTurn = new WeakMap<ChatModel, string>();
    return {
        ...REQUEST_FEATURE_SPEC,
        displayName: 'Feature request',
        // A malformed request runs without a card, so the user is never asked about it.
        needsApproval: input => checkFeatureRequest(input) == null,
        allowActions: false,
        approvalPrompt: input => approvalPrompt(input),
        execute: async (input, ctx) => {
            const chatModel = ctx?.chatModel,
                userMessages = (chatModel?.messages ?? []).filter(it => it.role === 'user'),
                turn = userMessages.at(-1)?.id,
                problem = checkFeatureRequest(input, userMessages.map(textOf));
            if (problem) return refused(problem);
            if (chatModel && turn && lastTurn.get(chatModel) === turn) {
                return refused('Send at most one feature request a turn.');
            }
            try {
                const receipt = await sink.submitAsync({
                    ...(input as Omit<FeatureRequest, 'context'>),
                    context: {
                        app: XH.clientAppCode,
                        appVersion: XH.appVersion,
                        user: XH.getUsername(),
                        submitted: Date.now()
                    }
                });
                if (chatModel && turn) lastTurn.set(chatModel, turn);
                return {submitted: true, ...receipt};
            } catch (e) {
                return refused(e?.message ?? String(e));
            }
        }
    };
}

//------------------
// Implementation
//------------------
function refused(reason: string) {
    return {submitted: false, refused: reason};
}

function textOf(message: PlainObject): string {
    return (message.parts ?? [])
        .filter(it => it.type === 'text')
        .map(it => it.text)
        .join('\n');
}

function approvalPrompt(input: PlainObject) {
    const row = (label: string, value: string) =>
        div({children: [span({className: 'xh-text-color-muted', children: `${label}: `}), value]});
    return div({
        children: [
            div('Send this feature request to the app team?'),
            row('Summary', input.summary),
            row('Category', input.category),
            row('Your words', `"${input.userWords}"`),
            input.workaround ? row('Built instead', input.workaround) : null,
            input.fragment ? pre(JSON.stringify(input.fragment, null, 2)) : null
        ]
    });
}
