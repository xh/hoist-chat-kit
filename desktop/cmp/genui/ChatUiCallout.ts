import {isEmpty} from 'lodash';
import {div} from '@xh/hoist/cmp/layout';
import {banner} from '@xh/hoist/desktop/cmp/banner';
import {chatMarkdown} from '../../../cmp/markdown';
import type {ChatUiComponentSpec} from '../../../genui';
import {chatUiSkeleton} from './ChatUiFrame';
import {CHAT_UI_INTENTS, toHoistIntent} from './impl/ChatUiIntents';
import type {ChatUiIntent, ChatUiSpecOptions} from './Types';
import '../../../styles/vars.scss';
import './ChatUiCallout.scss';

/** Props of a callout component, as written by the model. It shows as a Hoist `Banner`. */
export interface ChatUiCalloutSpecProps {
    /**
     * What kind of message it is: `primary` for a note, `success`, `warning` or `danger`. Sets the
     * color and the icon. Default `primary`. `none` is neutral, with no icon.
     */
    intent?: ChatUiIntent;

    /** A short heading above the message. */
    title?: string;

    /** The message, in markdown - for bold, italics and links. Keep it to a sentence or two. */
    text: string;
}

/** Options for {@link chatUiCalloutSpec}. */
export interface ChatUiCalloutSpecOptions extends ChatUiSpecOptions {
    /** Most characters of text the model may send. Default 500. */
    maxLength?: number;
}

/**
 * A callout component for a {@link ChatUiCatalog}: a message that stands out from the answer, as
 * a note, a success, a warning or an error. It renders Hoist's `Banner`, tinted and with the icon
 * of its intent, so that color is never the only signal.
 *
 * The spec passes the text to the banner as rendered chat markdown, never as a string. A string
 * goes through Hoist's own markdown, which loads images.
 *
 * The model writes the intent and the title before the text, so that a warning shows as one from
 * its first word.
 *
 * The model's tool is `show_callout`, unless renamed with `name`.
 */
export function chatUiCalloutSpec(
    opts: ChatUiCalloutSpecOptions = {}
): ChatUiComponentSpec<ChatUiCalloutSpecProps> {
    const {name = 'callout', description = DESCRIPTION, maxLength = 500} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['text'],
            additionalProperties: false,
            properties: {
                intent: {
                    enum: CHAT_UI_INTENTS,
                    description:
                        '"primary" for a note, "success", "warning" or "danger". Default ' +
                        '"primary". "none" is neutral, with no icon.'
                },
                title: {type: 'string', maxLength: 80, description: 'A short heading.'},
                text: {
                    type: 'string',
                    minLength: 1,
                    maxLength,
                    description: 'The message. Takes markdown bold, italics and links.'
                }
            }
        },
        render: ({intent, title, text}, {isPartial}) => {
            if (isEmpty(text) && isEmpty(title)) {
                return isPartial ? chatUiSkeleton(SKELETON_HEIGHT) : null;
            }
            return banner({
                className: 'xh-chat-ui-callout',
                // An intent cut short as it streams is not yet one of Hoist's.
                intent: toHoistIntent(intent, 'primary'),
                message: div({
                    items: [
                        title
                            ? div({
                                  key: 'title',
                                  className: 'xh-chat-ui-callout__title',
                                  item: title
                              })
                            : null,
                        chatMarkdown({key: 'text', content: text ?? '', isStreaming: !!isPartial})
                    ]
                })
            });
        },
        result: ({title, text}) => (title ? `${title}: ${text}` : text),
        example: {
            intent: 'warning',
            title: 'Limit breach',
            text: 'VaR is **12% over** its limit on the Rates desk.'
        }
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A message that stands out from the answer: a note, a success, a warning or an error. Use ' +
    'it for the one thing the reader must not miss, such as a caveat on the data or a breached ' +
    'limit. Keep it to a sentence or two.';

const SKELETON_HEIGHT = 34;
