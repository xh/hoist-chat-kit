import {hoistCmp, type PlainObject, uses} from '@xh/hoist/core';
import {button, buttonGroup} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {popover} from '@xh/hoist/kit/blueprint';
import {castArray} from 'lodash';
import {BlueprintWidgetModel, type ButtonGroupWidgetConfig} from '../../../blueprint';
import {drillInPopoverContent} from './impl/DrillIn';

/**
 * The `buttonGroup` widget: a row of Hoist buttons, each running its action, or its list of
 * actions as steps. A button's tooltip describes what it will do, with the values it would run
 * with now.
 */
export class ButtonGroupWidgetModel extends BlueprintWidgetModel<ButtonGroupWidgetConfig> {
    /** The definition of each button, with its action as the element declares it. */
    get buttons() {
        return castArray(this.element?.config?.buttons ?? []);
    }

    /** What a button's action, or each of its steps, will do. */
    describe(action: unknown): string {
        return castArray(action)
            .map(it => this.blueprintModel.describeAction(it))
            .join(', then ');
    }

    /** Why a button's action cannot run now, such as a busy chat, or null if it can. */
    blockedReason(action: PlainObject | PlainObject[]): string {
        return this.blueprintModel.actionBlockedReason(action);
    }

    runAsync(action: PlainObject | PlainObject[], anchor?: string) {
        return this.blueprintModel.runActionsAsync(action, {anchor});
    }
}

export const [ButtonGroupWidget, buttonGroupWidget] = hoistCmp.withFactory({
    displayName: 'ButtonGroupWidget',
    className: 'xh-blueprint-button-group',
    model: uses(ButtonGroupWidgetModel),
    render({model, className}) {
        return buttonGroup({
            className,
            children: model.buttons.map((it, idx) => {
                const blocked = model.blockedReason(it.action),
                    anchor = `${model.id}/${idx}`,
                    {drillIn} = model.blueprintModel,
                    target = button({
                        key: idx,
                        text: it.label,
                        icon: it.icon ? Icon.icon({faName: it.icon}) : null,
                        title: blocked ?? model.describe(it.action),
                        disabled: !!blocked,
                        onClick: () => model.runAsync(it.action, anchor).catchDefault()
                    });
                return drillIn?.anchor === anchor
                    ? popover({
                          key: idx,
                          isOpen: true,
                          position: 'bottom',
                          onClose: () => model.blueprintModel.closeDrillIn(),
                          item: target,
                          content: drillInPopoverContent({
                              key: JSON.stringify(drillIn),
                              host: model.blueprintModel,
                              drillIn
                          })
                      })
                    : target;
            })
        });
    }
});
