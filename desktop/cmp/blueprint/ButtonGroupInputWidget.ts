import {hoistCmp, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {buttonGroupInput} from '@xh/hoist/desktop/cmp/input';
import {castArray} from 'lodash';
import {BlueprintWidgetModel, type ButtonGroupInputWidgetConfig} from '../../../blueprint';

/**
 * The `buttonGroupInput` widget, labeled "Toggle": a segmented control of its options. It shows the
 * value of the variable its element sets as the pressed option, and sets it as the user picks one.
 */
export class ButtonGroupInputWidgetModel extends BlueprintWidgetModel<ButtonGroupInputWidgetConfig> {}

export const [ButtonGroupInputWidget, buttonGroupInputWidget] = hoistCmp.withFactory({
    displayName: 'ButtonGroupInputWidget',
    className: 'xh-blueprint-button-group-input',
    model: uses(ButtonGroupInputWidgetModel),
    render({model, className}) {
        return buttonGroupInput({
            className,
            value: model.value,
            onChange: value => model.setValue(value),
            children: castArray(model.resolvedConfig.options ?? []).map(it =>
                button({key: it.value, text: it.label, value: it.value})
            )
        });
    }
});
