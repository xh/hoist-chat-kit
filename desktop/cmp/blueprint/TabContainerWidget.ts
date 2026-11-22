import {tabContainer, TabContainerModel, type TabConfig} from '@xh/hoist/cmp/tab';
import {hoistCmp, managed, uses} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type TabContainerWidgetConfig,
    type ChildRef
} from '../../../blueprint';
import {emptyContent} from './impl/layout';

/**
 * The `tabContainer` widget: a Hoist `TabContainer` with a tab per child, titled by its child
 * reference. The active tab is transient. A tab renders its child only once it is first shown.
 */
export class TabContainerWidgetModel extends BlueprintWidgetModel<TabContainerWidgetConfig> {
    // No text of Hoist's own while empty: run mode shows the widget's emptyText, design mode its
    // own empty state.
    @managed readonly tabContainerModel = new TabContainerModel({tabs: [], emptyText: null});

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction({
            track: () =>
                this.children.map(({id, title, icon}) => ({
                    id,
                    title: this.blueprintModel.resolveTitle(title),
                    icon
                })),
            run: children => this.loadTabs(children),
            equals: 'structural',
            fireImmediately: true
        });
    }

    //------------------
    // Implementation
    //------------------
    private loadTabs(children: ChildRef[]) {
        const {tabContainerModel} = this,
            activeTabId = tabContainerModel.activeTabId,
            tabs: TabConfig[] = children.map(({id, title, icon}) => ({
                id,
                title: (title as string) || id,
                icon: icon ? Icon.icon({faName: icon as any}) : null,
                content: () => this.renderElement(id)
            }));
        tabContainerModel.setTabs(tabs);
        if (children.some(it => it.id === activeTabId)) tabContainerModel.activateTab(activeTabId);
    }
}

export const [TabContainerWidget, tabContainerWidget] = hoistCmp.withFactory({
    displayName: 'TabContainerWidget',
    className: 'xh-blueprint-tab-container',
    model: uses(TabContainerWidgetModel),
    render({model, className}) {
        return (
            emptyContent(model) ??
            tabContainer({
                model: model.tabContainerModel,
                className,
                switcher: {
                    orientation: model.resolvedConfig.switcherPosition ?? 'top',
                    // Tabs that do not fit scroll, and show in a menu, as in a narrow chat.
                    enableOverflow: true
                }
            })
        );
    }
});
