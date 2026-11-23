import classNames from 'classnames';
import {hoistCmp, uses, XH} from '@xh/hoist/core';
import {panel, PanelModel} from '@xh/hoist/desktop/cmp/panel';
import {toolbar} from '@xh/hoist/desktop/cmp/toolbar';
import {Icon} from '@xh/hoist/icon';
import {observableRef} from '@xh/hoist/mobx';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type PanelWidgetConfig
} from '../../../blueprint';
import {emptyContent, layoutChildren} from './impl/layout';

/**
 * The `panel` widget: a Hoist `Panel` over its children in a column. Its `tbar` and `bbar` slots
 * fill the panel's toolbars, and `headerItems` its header. In a dashboard cell it draws no header or
 * border, as the cell is its frame and carries its title, icon and header items, and it never
 * collapses. Elsewhere its card style is a compact header in a bordered frame. Its collapsed state follows `collapsed` in its
 * config, and a user's collapse writes it back, so it stays transient in run mode.
 */
export class PanelWidgetModel extends BlueprintWidgetModel<PanelWidgetConfig> {
    @observableRef accessor panelModel: PanelModel = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction(
            {
                // A dashboard cell has no header to expand it from.
                track: () => !!this.resolvedConfig.collapsible && !this.inCanvasCell,
                run: collapsible => this.createModel(collapsible),
                fireImmediately: true
            },
            {
                track: () => !!this.resolvedConfig.collapsed,
                run: collapsed => {
                    if (this.panelModel.collapsible) this.panelModel.setCollapsed(collapsed);
                }
            },
            {
                track: () => this.panelModel.collapsed,
                run: collapsed => {
                    if (
                        this.panelModel.collapsible &&
                        collapsed !== !!this.resolvedConfig.collapsed
                    ) {
                        this.setConfig('/collapsed', collapsed);
                    }
                }
            }
        );
    }

    /** True in a dashboard cell, which frames the panel and carries its header. */
    get inCanvasCell(): boolean {
        return this.parentElement?.component === 'dashboard';
    }

    override destroy() {
        XH.safeDestroy(this.panelModel);
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private createModel(collapsible: boolean) {
        XH.safeDestroy(this.panelModel);
        this.panelModel = new PanelModel({
            collapsible,
            defaultCollapsed: collapsible && !!this.resolvedConfig.collapsed,
            resizable: false,
            showSplitter: false,
            // Hoist collapses a panel only with a side and a size, which fills its slot here.
            ...(collapsible ? {side: 'top', defaultSize: '100%'} : {})
        });
    }
}

export const [PanelWidget, panelWidget] = hoistCmp.withFactory({
    displayName: 'PanelWidget',
    className: 'xh-blueprint-panel',
    model: uses(PanelWidgetModel),
    render({model, className}) {
        const {title, icon, style, compactHeader, intent} = model.resolvedConfig,
            content = model.children,
            // A slot of one toolbar draws it. Of other items, Hoist draws a toolbar around them.
            slot = (name: string) => {
                const refs = model.slotRefs(name);
                if (!refs.length) return null;
                const items = refs.map(it => model.renderElement(it.id)),
                    [only] = refs;
                return refs.length === 1 && model.componentOf(only.id) === 'toolbar'
                    ? items[0]
                    : toolbar({children: items, enableOverflowMenu: refs.length > 1});
            },
            body = emptyContent(model, content) ?? layoutChildren(model, 'column', content),
            toolbars = {tbar: slot('tbar'), bbar: slot('bbar')};
        if (model.inCanvasCell) {
            return panel({className, model: model.panelModel, ...toolbars, children: body});
        }
        const isCard = style === 'card';
        return panel({
            className: classNames(
                className,
                isCard && 'xh-blueprint-panel--card',
                isCard && intent && intent !== 'none' && `xh-blueprint-panel--${intent}`
            ),
            model: model.panelModel,
            title: title || null,
            icon: icon ? Icon.icon({faName: icon as any}) : null,
            compactHeader: isCard || compactHeader,
            headerItems: model.slotRefs('headerItems').map(it => model.renderElement(it.id)),
            ...toolbars,
            children: body
        });
    }
});
