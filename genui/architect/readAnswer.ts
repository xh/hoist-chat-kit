import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject, isString, mapValues, uniq} from 'lodash';
import {type ArchitectTarget, type Blueprint, hostSourceFor} from '../../blueprint';
import type {ChatMessage, ChatModel, ChatToolSpec} from '../../core';
import type {ChatUiCatalog} from '../ChatUiCatalog';

/** Most rows `read_answer` returns of each inline source. */
export const READ_ANSWER_MAX_ROWS = 20;

const LISTED_REPLIES = 5;

/**
 * The Architect's `read_answer` tool: an answer of this chat, by ID, to add to the host. It reads
 * only the replies of the chat it runs in. It gives an artifact's columns, size and request, never
 * its rows, and the rows of an inline source the model wrote, up to a cap.
 */
export function readAnswerTool(catalog: ChatUiCatalog, target: ArchitectTarget): ChatToolSpec {
    return {
        name: 'read_answer',
        description:
            "Read an answer of this chat, to add it to the blueprint. With no answer, lists the answers of recent replies. With one, returns its blueprint, and for each artifact it reads, the dataset source that gives the artifact's rows, the widget config its query set, and the blueprint's sources that already give the same rows. A program with state returns its text.",
        parameters: {
            type: 'object',
            properties: {
                answer: {type: 'string', description: 'An answer ID from the list, as messageId:n.'}
            }
        },
        execute: (input, ctx) => {
            const chatModel = ctx?.chatModel;
            if (!chatModel) throw new Error('read_answer runs only in a chat');
            const replies = chatModel.messages.filter(it => it.role === 'assistant');
            if (!input?.answer) return listAnswers(catalog, replies.slice(-LISTED_REPLIES));

            const [messageId, n] = String(input.answer).split(':'),
                message = replies.find(it => it.id === messageId),
                answer = message ? catalog.answersOf(message)[Number(n)] : null;
            if (!answer) throw new Error(`no answer '${input.answer}' in this chat`);
            if (answer.kind === 'program') {
                return {answer: input.answer, kind: answer.kind, source: answer.source};
            }
            return {
                answer: input.answer,
                kind: answer.kind,
                blueprint: withCappedRows(answer.blueprint),
                artifacts: artifactsOf(answer.blueprint, chatModel, target)
            };
        }
    };
}

//------------------
// Implementation
//------------------
function listAnswers(catalog: ChatUiCatalog, replies: ChatMessage[]): PlainObject[] {
    return replies.flatMap(message =>
        catalog.answersOf(message).map((it, n) => ({
            answer: `${message.id}:${n}`,
            kind: it.kind,
            widgets: it.blueprint
                ? uniq(Object.values(it.blueprint.elements ?? {}).map(el => el?.component))
                : []
        }))
    );
}

function withCappedRows(blueprint: Blueprint): Blueprint {
    if (!isPlainObject(blueprint?.sources)) return blueprint;
    return {
        ...blueprint,
        sources: mapValues(blueprint.sources, (s: PlainObject) => {
            const rows = s?.inline?.rows;
            if (!Array.isArray(rows) || rows.length <= READ_ANSWER_MAX_ROWS) return s;
            return {
                ...s,
                inline: {
                    ...s.inline,
                    rows: rows.slice(0, READ_ANSWER_MAX_ROWS),
                    rowCount: rows.length
                }
            };
        })
    } as Blueprint;
}

// An answer names an artifact in a source, or in a chat kit spec's data prop.
function artifactsOf(blueprint: Blueprint, chatModel: ChatModel, target: ArchitectTarget) {
    const {artifacts} = chatModel,
        ids = new Set<string>(),
        walk = (v: unknown) => {
            if (isString(v)) {
                if (artifacts.get(v)) ids.add(v);
            } else if (Array.isArray(v)) {
                v.forEach(walk);
            } else if (isPlainObject(v)) {
                Object.values(v).forEach(walk);
            }
        };
    walk(blueprint?.sources);
    walk(blueprint?.elements);
    return [...ids].map(id => {
        const {columns, totalRows, metadata} = artifacts.get(id),
            request = isPlainObject(metadata?.request) ? metadata.request : null;
        return {
            id,
            columns: columns.map(({name, label, type}) => ({name, label, type})),
            totalRows,
            request,
            host: request ? hostSourceFor(request, target) : null
        };
    });
}
