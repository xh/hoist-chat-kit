import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {ChatUiComponentSpec} from '../../../genui';
import {chatMarkdown} from '../../../cmp/markdown';
import type {ChatUiSpecOptions} from './Types';

/** Props of a {@link ChatUiText}, as written by the model. */
export interface ChatUiTextSpecProps {
    /** The text, in markdown. */
    text: string;
}

/** Options for {@link chatUiTextSpec}. */
export interface ChatUiTextSpecOptions extends ChatUiSpecOptions {
    /** Most characters of text the model may send. Default 2000. */
    maxLength?: number;
}

/**
 * A text component for a {@link ChatUiCatalog}: markdown text, for the prose between the other
 * components of a nested answer. It has no frame, and no tool or tag of its own.
 */
export function chatUiTextSpec(
    opts: ChatUiTextSpecOptions = {}
): ChatUiComponentSpec<ChatUiTextSpecProps> {
    const {name = 'text', description = DESCRIPTION, maxLength = 2000} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['text'],
            additionalProperties: false,
            properties: {text: {type: 'string', maxLength}}
        },
        standalone: false,
        render: ({text}, {isPartial}) => chatUiText({text, isPartial}),
        result: ({text}) => text,
        example: {text: 'Revenue **grew** in every region.'}
    };
}

/** Props for {@link ChatUiText}. */
export interface ChatUiTextProps extends HoistProps, Partial<ChatUiTextSpecProps> {
    /** True while the props stream - the text renders as it arrives. */
    isPartial?: boolean;
}

/** Markdown text - the component that {@link chatUiTextSpec} renders. */
export const [ChatUiText, chatUiText] = hoistCmp.withFactory<ChatUiTextProps>({
    displayName: 'ChatUiText',
    model: false,
    className: 'xh-chat-ui-text',

    render({className, text, isPartial}) {
        return chatMarkdown({className, content: text ?? '', isStreaming: !!isPartial});
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'Markdown text, for the prose between the other components of an answer - a lead-in, a ' +
    'caveat or a summary. Keep it short.';
