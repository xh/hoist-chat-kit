import {hbox, label, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {buttonGroupInput, segmentedControl, select, switchInput} from '@xh/hoist/desktop/cmp/input';
import type {ReactNode} from 'react';
import {BlueprintWidgetModel, type PresetSelectorWidgetConfig} from '../../../blueprint';

/**
 * The `presetSelector` widget: a preset group's presets, as a segmented control, buttons, a select
 * or a toggle. It shows the group's active preset and switches it. In design mode, the preset it
 * switches to is the one edits write into.
 */
export class PresetSelectorWidgetModel extends BlueprintWidgetModel<PresetSelectorWidgetConfig> {
    get group(): string {
        return this.resolvedConfig.group;
    }

    /** Each preset of the group, in order, with its label. */
    get items(): {value: string; label: string}[] {
        const items = this.blueprintModel.blueprint?.presets?.[this.group]?.items ?? {};
        return Object.entries(items).map(([value, it]) => ({value, label: it.label ?? value}));
    }

    get active(): string {
        return this.blueprintModel.getActivePreset(this.group);
    }

    choose(item: string) {
        if (item && item !== this.active) this.blueprintModel.setPreset(this.group, item);
    }
}

export const [PresetSelectorWidget, presetSelectorWidget] = hoistCmp.withFactory({
    displayName: 'PresetSelectorWidget',
    className: 'xh-blueprint-preset-selector',
    model: uses(PresetSelectorWidgetModel),
    render({model, className}) {
        const {label: text, display = 'segmented'} = model.resolvedConfig;
        return hbox({
            className,
            alignItems: 'center',
            children: [text ? label(text) : null, control(model, display)]
        });
    }
});

function control(model: PresetSelectorWidgetModel, display: string): ReactNode {
    const {items, active} = model,
        choose = (it: string) => model.choose(it);
    switch (display) {
        case 'select':
            return select({
                options: items,
                value: active,
                onChange: choose,
                enableFilter: false,
                width: 160
            });
        case 'buttonGroup':
            return buttonGroupInput({
                value: active,
                onChange: choose,
                children: items.map(it => button({key: it.value, text: it.label, value: it.value}))
            });
        case 'toggle': {
            const [off, on] = items;
            return hbox({
                alignItems: 'center',
                children: [
                    span(off?.label),
                    switchInput({
                        value: active === on?.value,
                        onChange: (v: boolean) => choose(v ? on?.value : off?.value)
                    }),
                    span(on?.label)
                ]
            });
        }
        default:
            return segmentedControl({value: active, options: items, onChange: choose, fill: false});
    }
}
