import {isArray, isEmpty, isString, times} from 'lodash';
import {Children, type ReactNode} from 'react';
import {div} from '@xh/hoist/cmp/layout';
import {tabContainer, TabContainerModel} from '@xh/hoist/cmp/tab';
import {creates, hoistCmp, HoistModel, type HoistProps, managed} from '@xh/hoist/core';
import type {ChatUiComponentSpec} from '../../../genui';
import {chatUiSkeleton} from './ChatUiFrame';
import {inColumn} from './impl/ChatUiStackDirection';
import type {ChatUiSpecOptions} from './Types';
import '../../../styles/vars.scss';
import './ChatUiTabs.scss';

/** Props of a {@link ChatUiTabs}, as written by the model. */
export interface ChatUiTabsSpecProps {
    /** Title of each tab, in the order of the children: the first title names the first child. */
    titles: string[];
}

/** Options for {@link chatUiTabsSpec}. */
export interface ChatUiTabsSpecOptions extends ChatUiSpecOptions {
    /** Most tabs the model may send. Default 6. */
    maxTabs?: number;
}

/**
 * A tabs container for a {@link ChatUiCatalog}: shows one child at a time, with a tab per child
 * to switch between them. It renders Hoist's `TabContainer`, over a `TabContainerModel` that it
 * creates once and updates as the children stream in.
 *
 * The model writes plain titles, matched to the children by position. A title with no child
 * shows no tab. A child with no title is named `Tab 2`, but only once the props are complete, so
 * that no default name shows while the titles are still to come. A tab renders its child when
 * first shown, and keeps it after that, so a chart in a later tab is built once. Tabs that do not
 * fit the width scroll, and show in a menu.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiTabsSpec(
    opts: ChatUiTabsSpecOptions = {}
): ChatUiComponentSpec<ChatUiTabsSpecProps> {
    const {name = 'tabs', description = DESCRIPTION, maxTabs = 6} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['titles'],
            additionalProperties: false,
            properties: {
                titles: {
                    type: 'array',
                    minItems: 1,
                    maxItems: maxTabs,
                    items: {type: 'string', minLength: 1, maxLength: 40},
                    description:
                        'Title of each tab, in the order of the children - one title per child.'
                }
            }
        },
        slots: ['default'],
        standalone: false,
        render: ({titles}, {children, isPartial}) =>
            inColumn(chatUiTabs({titles, isPartial, children})),
        result: ({titles}) => titles.join(' | '),
        example: {titles: ['Chart', 'Data']}
    };
}

/** Props for {@link ChatUiTabs}. */
export interface ChatUiTabsProps extends HoistProps, Partial<ChatUiTabsSpecProps> {
    /**
     * True while the props stream. A child shows its tab once its title arrives, and a placeholder
     * shows until the first one does.
     */
    isPartial?: boolean;
}

/**
 * Children shown one at a time under a row of tabs - the component that {@link chatUiTabsSpec}
 * renders. It owns one Hoist `TabContainerModel` for its life, and adds, renames and removes
 * tabs as its children and titles change.
 */
export const [ChatUiTabs, chatUiTabs] = hoistCmp.withFactory<ChatUiTabsProps>({
    displayName: 'ChatUiTabs',
    className: 'xh-chat-ui-tabs',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatUiTabsLocalModel(), {publishMode: 'none'}),

    render({model, className, isPartial}) {
        const impl = model as ChatUiTabsLocalModel;
        if (isEmpty(impl.tabContainerModel.tabs)) {
            return isPartial ? chatUiSkeleton(SKELETON_HEIGHT) : null;
        }
        return tabContainer({
            className,
            model: impl.tabContainerModel,
            // With no size of its own, a TabContainer sets an inline flex that keeps it from
            // sharing the width of a row. A width leaves its flex to the stylesheets.
            width: '100%',
            // Tabs that do not fit the chat scroll, and show in a menu.
            switcher: {enableOverflow: true}
        });
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A container that shows one child at a time, with a tab per child. Use it for alternative ' +
    'views of one answer, such as a chart and its data, or one tab per region. Give one title ' +
    'per child, in the same order. Use a stack where the reader should see everything at once.';

const SKELETON_HEIGHT = 120;

class ChatUiTabsLocalModel extends HoistModel {
    override xhImpl = true;

    @managed tabContainerModel = new TabContainerModel({tabs: [], xhImpl: true});

    get props(): ChatUiTabsProps {
        return this.componentProps as ChatUiTabsProps;
    }

    /** The child each tab shows, by position. */
    get items(): ReactNode[] {
        return Children.toArray(this.props.children);
    }

    override onLinked() {
        super.onLinked();
        this.addReaction({
            track: () => this.tabTitles,
            run: titles => this.syncTabs(titles),
            equals: 'structural',
            fireImmediately: true
        });
    }

    // A title per child. While the props stream, a child whose title has not arrived has no tab
    // yet, as OpenUI Lang writes the children before the titles. Once the props are complete, a
    // child with no title gets a default name.
    private get tabTitles(): string[] {
        const {titles, isPartial} = this.props,
            written = (isArray(titles) ? titles : []).filter(it => isString(it) && it),
            count = isPartial ? Math.min(this.items.length, written.length) : this.items.length;
        return times(count, idx => written[idx] ?? `Tab ${idx + 1}`);
    }

    // Tabs keep their ids by position, so a tab the user chose stays active as more arrive.
    private syncTabs(titles: string[]) {
        const {tabContainerModel} = this;
        tabContainerModel.tabs.slice(titles.length).forEach(it => tabContainerModel.removeTab(it));
        titles.forEach((title, idx) => {
            const id = `tab${idx}`;
            if (tabContainerModel.findTab(id)) {
                tabContainerModel.setTabTitle(id, title);
            } else {
                tabContainerModel.addTab({
                    id,
                    title,
                    content: () => tabContent({key: id, tabsModel: this, idx})
                });
            }
        });
    }
}

// Reads the child from the props of the tabs as it renders, so it follows a child that streams.
interface TabContentProps extends HoistProps {
    tabsModel: ChatUiTabsLocalModel;
    idx: number;
}

const tabContent = hoistCmp.factory<TabContentProps>({
    displayName: 'ChatUiTabContent',
    model: false,

    render({tabsModel, idx}) {
        return div({className: 'xh-chat-ui-tabs__content', children: tabsModel.items[idx]});
    }
});
