import {card} from '@xh/hoist/cmp/card';
import type {ChatUiComponentSpec} from '../../../genui';
import {chatUiSkeleton} from './ChatUiFrame';
import {CHAT_UI_INTENTS, toHoistIntent} from './impl/ChatUiIntents';
import {inColumn} from './impl/ChatUiStackDirection';
import type {ChatUiIntent, ChatUiSpecOptions} from './Types';
import '../../../styles/vars.scss';
import './ChatUiSection.scss';

/** Props of a section component, as written by the model. It shows as a Hoist `Card`. */
export interface ChatUiSectionSpecProps {
    /** Title of the section, shown in its header. A section with no title never collapses. */
    title?: string;

    /** Color of the border and the title - for example `warning`. Default `none`. */
    intent?: ChatUiIntent;

    /** True to let the user collapse the section, with a click on its title. Default false. */
    collapsible?: boolean;

    /** True to start the section collapsed, which also makes it collapsible. Default false. */
    collapsed?: boolean;
}

/**
 * A section container for a {@link ChatUiCatalog}: a bordered group of children under a title,
 * which the user can collapse. It renders Hoist's `Card`, with a `CardModel` that holds the
 * collapsed state. Several collapsible sections in a column read as an accordion.
 *
 * A section that starts collapsed renders its children on first expand, and keeps them after
 * that, so a chart inside is built once. While a format still writes the section's own props, it
 * shows its title over a placeholder, and mounts its children once they are complete. A section
 * that starts collapsed therefore never shows open first.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiSectionSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiSectionSpecProps> {
    const {name = 'section', description = DESCRIPTION} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120},
                intent: {
                    enum: CHAT_UI_INTENTS,
                    description: 'Color of the border and the title. Default "none".'
                },
                collapsible: {
                    type: 'boolean',
                    description: 'True to let the user collapse the section. Needs a title.'
                },
                collapsed: {
                    type: 'boolean',
                    description:
                        'True to start the section collapsed. The user expands it. Needs a title.'
                }
            }
        },
        slots: ['default'],
        standalone: false,
        render: ({title, intent, collapsible, collapsed}, {children, isPartial, element}) => {
            // An intent cut short as it streams is not yet one of Hoist's.
            const frame = {className: 'xh-chat-ui-section', title, intent: toHoistIntent(intent)};

            // A format that tracks each element, as OpenUI Lang does, says while this one is
            // still being written. It writes the children first and `collapsed` last, so content
            // mounted now would show open, then collapse. The frame waits with a placeholder.
            if (isPartial && element?.isPartial === true) {
                return card({key: 'writing', ...frame, children: chatUiSkeleton(SKELETON_HEIGHT)});
            }

            // The header is the only way to expand, so a section with no title never collapses.
            const canCollapse = (collapsible === true || collapsed === true) && !!title,
                startCollapsed = canCollapse && collapsed === true;
            return inColumn(
                card({
                    // A Card reads its model config once. In a document with no state per element,
                    // these props may still arrive after the title, so a change remounts the card
                    // with a new model. Such a document writes props before children.
                    key: `${canCollapse}|${startCollapsed}`,
                    ...frame,
                    modelConfig: {
                        collapsible: canCollapse,
                        defaultCollapsed: startCollapsed,
                        renderMode: 'lazy'
                    },
                    children
                })
            );
        },
        result: ({title}) => title ?? '',
        example: {title: 'By desk', collapsible: true}
    };
}

//------------------
// Implementation
//------------------
const SKELETON_HEIGHT = 48;

const DESCRIPTION =
    'A bordered group of components under a title, which the user can collapse. Use it to set ' +
    'apart one part of an answer, or several in a column for detail the reader opens on ' +
    'demand. Start a section collapsed when its content is secondary.';
