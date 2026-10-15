import type {ChatMessage} from './ChatMessage';
import type {ChatDataPart} from './ChatPart';

/**
 * The `dataType` of a fixed "not found" reply. A backend sends it, in place of an answer, when its
 * search matched nothing - as an `xh.chat.data` event with a {@link ChatNoAnswerData} value.
 *
 * The message view renders it from a fixed template that says nothing was found and lists the
 * documents searched, so that it never reads as a generated answer. Such a reply shows no sources
 * list and no Regenerate. An app's own `dataRenderers` entry for the type replaces the template.
 */
export const CHAT_NO_ANSWER_DATA_TYPE = 'xh.chat.noAnswer';

/** The `data` of a {@link CHAT_NO_ANSWER_DATA_TYPE} part. Every member is optional. */
export interface ChatNoAnswerData {
    /** The documents searched, by name, in the order to list them. */
    documents?: ChatNoAnswerDocument[];

    /**
     * How many documents were searched. Default the number of `documents`. Give it alone when the
     * backend reports a count but no names.
     */
    documentCount?: number;
}

/** A document a {@link ChatNoAnswerData} reply searched. */
export interface ChatNoAnswerDocument {
    /** The app's id for the document. */
    id?: string;

    /** Name to show. */
    name: string;
}

/** The fixed "not found" part of a reply, or null if the reply has none. */
export function getChatNoAnswerPart(message: ChatMessage): ChatDataPart {
    return (
        (message.parts.find(
            it => it.type === 'data' && it.dataType === CHAT_NO_ANSWER_DATA_TYPE
        ) as ChatDataPart) ?? null
    );
}
