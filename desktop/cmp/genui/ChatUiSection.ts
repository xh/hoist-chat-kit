import {card, CardModel} from '@xh/hoist/cmp/card';
import {creates, hoistCmp, HoistModel, type HoistProps, managed} from '@xh/hoist/core';
import {bindable} from '@xh/hoist/mobx';
import {isString} from 'lodash';
import type {ChatUiComponentSpec} from '../../../genui';
import {chatUiSkeleton} from './ChatUiFrame';
import {CHAT_UI_INTENTS, toHoistIntent} from './impl/ChatUiIntents';
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

    /** Secondary text beside the title, such as a count or a date. Default none. */
    subtitle?: string;
}

/**
 * A section container for a {@link ChatUiCatalog}: a bordered group of children under a title,
 * which the user can collapse. It renders Hoist's `Card`, with one `CardModel` for its life that
 * holds the collapsed state. Props that arrive later update that model, so a section that the
 * user collapsed stays collapsed. Several collapsible sections in a column read as an accordion.
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
                },
                subtitle: {
                    type: 'string',
                    maxLength: 160,
                    description: 'Secondary text beside the title.'
                }
            }
        },
        slots: ['default'],
        standalone: false,
        render: (props, {children, isPartial, element}) =>
            chatUiSection({
                ...props,
                // A format that tracks each element, as OpenUI Lang does, says while this one is
                // still being written.
                isWriting: isPartial && element?.isPartial === true,
                items: children
            }),
        result: ({title}) => title ?? '',
        example: {title: 'By desk', collapsible: true}
    };
}

//------------------
// Implementation
//------------------
const SKELETON_HEIGHT = 48;

interface ChatUiSectionProps extends HoistProps, ChatUiSectionSpecProps {
    /** True while a format still writes the props of the section. */
    isWriting?: boolean;
}

// Children under a title in a Hoist Card - the component that the section spec renders.
const chatUiSection = hoistCmp.factory<ChatUiSectionProps>({
    displayName: 'ChatUiSection',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatUiSectionLocalModel(), {publishMode: 'none'}),

    render({model, title, intent, subtitle, children}) {
        const impl = model as ChatUiSectionLocalModel,
            frame = {
                className: 'xh-chat-ui-section',
                title,
                subtitle: isString(subtitle) && subtitle.trim() ? subtitle : null,
                // An intent cut short as it streams is not yet one of Hoist's.
                intent: toHoistIntent(intent)
            };

        // A format writes the children first and `collapsed` last, so content mounted while the
        // props are written would show open, then collapse. The frame waits with a placeholder.
        // It is a card of its own, so the section's card mounts with its state set, and a
        // section that starts collapsed builds its children on first expand.
        return impl.isReady
            ? card({key: 'section', ...frame, model: impl.cardModel, items: children})
            : card({key: 'writing', ...frame, item: chatUiSkeleton(SKELETON_HEIGHT)});
    }
});

class ChatUiSectionLocalModel extends HoistModel {
    override xhImpl = true;

    @managed cardModel = new CardModel({renderMode: 'lazy'});

    /** True once the card's model holds the state of props that are complete. */
    @bindable accessor isReady: boolean = false;

    get props(): ChatUiSectionProps {
        return this.componentProps as ChatUiSectionProps;
    }

    override onLinked() {
        super.onLinked();
        this.addReaction({
            track: () => {
                const {title, collapsible, collapsed, isWriting} = this.props,
                    // The header is the only way to expand, so a section with no title never
                    // collapses.
                    canCollapse = (collapsible === true || collapsed === true) && !!title;
                return {canCollapse, startCollapsed: canCollapse && collapsed === true, isWriting};
            },
            run: ({canCollapse, startCollapsed, isWriting}, prev) => {
                const {cardModel} = this;
                cardModel.collapsible = canCollapse;
                // The prop sets the state when it changes. Until then, a click by the user holds.
                if (canCollapse && startCollapsed !== (prev?.startCollapsed ?? false)) {
                    cardModel.setCollapsed(startCollapsed);
                }
                this.isReady = !isWriting;
            },
            equals: 'structural',
            fireImmediately: true
        });
    }
}

const DESCRIPTION =
    'A bordered group of components under a title, which the user can collapse. Use it to set ' +
    'apart one part of an answer, or several in a column for detail the reader opens on ' +
    'demand. Start a section collapsed when its content is secondary.';
