import {card, CardModel} from '@xh/hoist/cmp/card';
import {vframe} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses, XH} from '@xh/hoist/core';
import {panel, PanelModel} from '@xh/hoist/desktop/cmp/panel';
import {Icon} from '@xh/hoist/icon';
import {observableRef} from '@xh/hoist/mobx';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type PanelWidgetConfig
} from '../../../blueprint';
import {emptyContent, layoutChildren} from './impl/layout';

/**
 * The `panel` widget: a Hoist `Panel`, or a `Card` for its card style, over its children in a
 * column, with a toolbar child in its `tbar` or `bbar` slot. Its collapsed state follows `collapsed` in its config, and a user's collapse writes it
 * back, so it stays transient in run mode.
 */
export class PanelWidgetModel extends BlueprintWidgetModel<PanelWidgetConfig> {
    @observableRef accessor panelModel: PanelModel = null;
    @observableRef accessor cardModel: CardModel = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction(
            {
                track: () => !!this.resolvedConfig.collapsible,
                run: collapsible => this.createModels(collapsible),
                fireImmediately: true
            },
            {
                track: () => !!this.resolvedConfig.collapsed,
                run: collapsed => {
                    this.panelModel.setCollapsed(collapsed);
                    this.cardModel.setCollapsed(collapsed);
                }
            },
            {
                track: () => [this.panelModel.collapsed, this.cardModel.collapsed],
                run: ([fromPanel, fromCard]) => {
                    const collapsed = !!this.resolvedConfig.collapsed,
                        changed = [fromPanel, fromCard].find(it => it !== collapsed);
                    if (changed != null) this.setConfig('/collapsed', changed);
                }
            }
        );
    }

    override destroy() {
        XH.safeDestroy(this.panelModel, this.cardModel);
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private createModels(collapsible: boolean) {
        XH.safeDestroy(this.panelModel, this.cardModel);
        const defaultCollapsed = collapsible && !!this.resolvedConfig.collapsed;
        this.panelModel = new PanelModel({
            collapsible,
            defaultCollapsed,
            resizable: false,
            showSplitter: false,
            // Hoist collapses a panel only with a side and a size, which fills its slot here.
            ...(collapsible ? {side: 'top', defaultSize: '100%'} : {})
        });
        this.cardModel = new CardModel({collapsible, defaultCollapsed});
    }
}

export const [PanelWidget, panelWidget] = hoistCmp.withFactory({
    displayName: 'PanelWidget',
    className: 'xh-blueprint-panel',
    model: uses(PanelWidgetModel),
    render({model, className}) {
        const {title, icon, style, compactHeader, intent} = model.resolvedConfig,
            content = model.children.filter(it => !it.slot),
            slot = (name: string) => {
                const ref = model.children.find(it => it.slot === name);
                return ref ? model.renderElement(ref.id) : null;
            },
            props = {
                className,
                title: title || null,
                icon: icon ? Icon.icon({faName: icon as any}) : null
            },
            body = emptyContent(model, content) ?? layoutChildren(model, 'column', content);
        return style === 'card'
            ? card({
                  ...props,
                  model: model.cardModel,
                  intent: intent && intent !== 'none' ? intent : null,
                  flex: 'auto',
                  children: [
                      slot('tbar'),
                      vframe({className: 'xh-blueprint-panel__body', children: body}),
                      slot('bbar')
                  ]
              })
            : panel({
                  ...props,
                  model: model.panelModel,
                  compactHeader,
                  tbar: slot('tbar'),
                  bbar: slot('bbar'),
                  children: body
              });
    }
});
