import type {DateRangePickerModel} from '@xh/hoist/cmp/daterange';
import {FilterChooserModel} from '@xh/hoist/cmp/filter';
import {box, hbox, label} from '@xh/hoist/cmp/layout';
import {hoistCmp, managed, type PlainObject, uses, XH} from '@xh/hoist/core';
import {dateRangePicker} from '@xh/hoist/desktop/cmp/daterange';
import {filterChooser} from '@xh/hoist/desktop/cmp/filter';
import {
    dateInput,
    numberInput,
    select,
    slider,
    switchInput,
    textInput
} from '@xh/hoist/desktop/cmp/input';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {LocalDate} from '@xh/hoist/utils/datetime';
import classNames from 'classnames';
import {isEqual} from 'lodash';
import type {ReactNode} from 'react';
import {
    type BlueprintWidgetConfig,
    BlueprintWidgetModel,
    type DateInputWidgetConfig,
    type DateRangePickerWidgetConfig,
    type FilterChooserWidgetConfig,
    type NumberInputWidgetConfig,
    type SelectWidgetConfig,
    type SliderWidgetConfig,
    type SwitchInputWidgetConfig,
    type TextInputWidgetConfig
} from '../../../blueprint';
import {DateRangeBinding} from './impl/DateRangeBinding';

/**
 * A widget that shows and sets the variable whose `setBy` names its element, through a Hoist input.
 * It holds no value of its own.
 */
export abstract class InputWidgetModel<
    C extends PlainObject = PlainObject
> extends BlueprintWidgetModel<C> {
    /** The props of its Hoist input, with the value and the handler that sets the variable. */
    abstract get inputProps(): PlainObject;

    protected commit(value: unknown) {
        if (this.valueVariable) this.setValue(value);
    }
}

/** The `select` widget: one option of its variable's options list, or several for a list. */
export class SelectWidgetModel extends InputWidgetModel<SelectWidgetConfig> {
    get inputProps(): PlainObject {
        const decl = this.valueVariable?.decl,
            options = decl?.options && 'values' in decl.options ? decl.options.values : [],
            enableMulti = !!decl?.type?.endsWith('[]');
        return {
            options,
            enableMulti,
            value: enableMulti ? (this.value ?? []) : this.value,
            placeholder: this.resolvedConfig.placeholder,
            width: 160,
            onChange: (value: unknown) => this.commit(value)
        };
    }
}

/** The `dateInput` widget, for a `localDate` variable, which holds its ISO string. */
export class DateInputWidgetModel extends InputWidgetModel<DateInputWidgetConfig> {
    get inputProps(): PlainObject {
        const {value} = this;
        return {
            valueType: 'localDate',
            value: value ? LocalDate.get(value as string) : null,
            width: 130,
            onCommit: (date: LocalDate) => this.commit(date?.isoString ?? null)
        };
    }
}

/** The `dateRangePicker` widget, for a `dateRange` variable. Keeps no persisted state. */
export class DateRangePickerWidgetModel extends InputWidgetModel<DateRangePickerWidgetConfig> {
    @managed @observableRef accessor binding: DateRangeBinding = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction({
            track: () => this.resolvedConfig.presets,
            run: presets => {
                XH.safeDestroy(this.binding);
                this.binding = new DateRangeBinding({
                    registry: this.blueprintModel.registry,
                    presets,
                    getValue: () => this.value,
                    setValue: value => this.commit(value)
                });
            },
            equals: 'structural',
            fireImmediately: true
        });
    }

    get pickerModel(): DateRangePickerModel {
        return this.binding?.pickerModel;
    }

    get inputProps(): PlainObject {
        return {model: this.pickerModel};
    }
}

export class NumberInputWidgetModel extends InputWidgetModel<NumberInputWidgetConfig> {
    get inputProps(): PlainObject {
        const {min, max, precision} = this.resolvedConfig;
        return {
            value: this.value,
            min,
            max,
            precision: precision ?? (this.valueVariable?.decl.type === 'int' ? 0 : null),
            width: 100,
            onCommit: (value: number) => this.commit(value)
        };
    }
}

export class TextInputWidgetModel extends InputWidgetModel<TextInputWidgetConfig> {
    get inputProps(): PlainObject {
        return {
            value: this.value,
            placeholder: this.resolvedConfig.placeholder,
            width: 160,
            onCommit: (value: string) => this.commit(value)
        };
    }
}

export class SwitchInputWidgetModel extends InputWidgetModel<SwitchInputWidgetConfig> {
    get inputProps(): PlainObject {
        return {value: !!this.value, onChange: (value: boolean) => this.commit(value)};
    }
}

/** The `slider` widget. It sets its variable once the user lets go - see {@link release}. */
export class SliderWidgetModel extends InputWidgetModel<SliderWidgetConfig> {
    @observable private accessor draft: number = null;

    get inputProps(): PlainObject {
        const {min, max, step = 1} = this.resolvedConfig;
        return {
            min,
            max,
            stepSize: step,
            value: this.draft ?? (this.value as number) ?? min,
            onChange: action((value: number) => (this.draft = value))
        };
    }

    /** Set the variable to the value the user slid to. */
    @action
    release() {
        if (this.draft == null) return;
        this.commit(this.draft);
        this.draft = null;
    }
}

/**
 * The `filterChooser` widget: a Hoist `FilterChooser` over its source's dimensions, or the fields
 * its config lists, with values from the source's rows. Keeps no favorites or persisted state.
 */
export class FilterChooserWidgetModel extends InputWidgetModel<FilterChooserWidgetConfig> {
    @managed @observableRef accessor chooserModel: FilterChooserModel = null;

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction(
            {
                track: () => [this.source, this.resolvedConfig.fields],
                run: () => this.createChooser(),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => this.value,
                run: value => {
                    if (!isEqual(value ?? null, this.chooserValue)) {
                        this.chooserModel?.setValue(value as any);
                    }
                },
                equals: 'structural'
            },
            {
                track: () => this.chooserValue,
                run: value => {
                    if (!isEqual(value, this.value ?? null)) this.commit(value);
                },
                equals: 'structural'
            }
        );
    }

    get inputProps(): PlainObject {
        return {model: this.chooserModel, flex: 1};
    }

    //------------------
    // Implementation
    //------------------
    private get chooserValue(): PlainObject {
        return this.chooserModel?.value?.toJSON() ?? null;
    }

    private createChooser() {
        XH.safeDestroy(this.chooserModel);
        const {source} = this,
            only = this.resolvedConfig.fields;
        this.chooserModel = source
            ? new FilterChooserModel({
                  valueSource: source.cube.store,
                  fieldSpecs: Object.values(source.fields)
                      .filter(it => it.isDimension && (!only?.length || only.includes(it.name)))
                      .map(it => ({field: it.name, displayName: source.fieldLabel(it.name)})),
                  initialValue: (this.value as any) ?? null
              })
            : null;
    }
}

export const [SelectWidget, selectWidget] = hoistCmp.withFactory({
    displayName: 'SelectWidget',
    className: 'xh-blueprint-select',
    model: uses(SelectWidgetModel),
    render: ({model, className}) => labeled(model, className, select(model.inputProps))
});

export const [DateInputWidget, dateInputWidget] = hoistCmp.withFactory({
    displayName: 'DateInputWidget',
    className: 'xh-blueprint-date-input',
    model: uses(DateInputWidgetModel),
    render: ({model, className}) => labeled(model, className, dateInput(model.inputProps))
});

export const [DateRangePickerWidget, dateRangePickerWidget] = hoistCmp.withFactory({
    displayName: 'DateRangePickerWidget',
    className: 'xh-blueprint-date-range-picker',
    model: uses(DateRangePickerWidgetModel),
    render: ({model, className}) =>
        model.pickerModel ? labeled(model, className, dateRangePicker(model.inputProps)) : null
});

export const [NumberInputWidget, numberInputWidget] = hoistCmp.withFactory({
    displayName: 'NumberInputWidget',
    className: 'xh-blueprint-number-input',
    model: uses(NumberInputWidgetModel),
    render: ({model, className}) => labeled(model, className, numberInput(model.inputProps))
});

export const [TextInputWidget, textInputWidget] = hoistCmp.withFactory({
    displayName: 'TextInputWidget',
    className: 'xh-blueprint-text-input',
    model: uses(TextInputWidgetModel),
    render: ({model, className}) => labeled(model, className, textInput(model.inputProps))
});

export const [SwitchInputWidget, switchInputWidget] = hoistCmp.withFactory({
    displayName: 'SwitchInputWidget',
    className: 'xh-blueprint-switch-input',
    model: uses(SwitchInputWidgetModel),
    render: ({model, className}) => labeled(model, className, switchInput(model.inputProps))
});

export const [SliderWidget, sliderWidget] = hoistCmp.withFactory({
    displayName: 'SliderWidget',
    className: 'xh-blueprint-slider',
    model: uses(SliderWidgetModel),
    render: ({model, className}) =>
        labeled(
            model,
            className,
            box({
                onPointerUp: () => model.release(),
                onKeyUp: () => model.release(),
                children: slider(model.inputProps)
            })
        )
});

export const [FilterChooserWidget, filterChooserWidget] = hoistCmp.withFactory({
    displayName: 'FilterChooserWidget',
    className: 'xh-blueprint-filter-chooser',
    model: uses(FilterChooserWidgetModel),
    render: ({model, className}) =>
        model.chooserModel
            ? labeled(model, className, filterChooser(model.inputProps), {flex: 1})
            : null
});

//------------------
// Implementation
//------------------
function labeled(
    model: InputWidgetModel,
    className: string,
    input: ReactNode,
    layout: PlainObject = {}
): ReactNode {
    const text = model.resolvedConfig.label;
    return hbox({
        className: classNames('xh-blueprint-input', className),
        alignItems: 'center',
        ...layout,
        children: [text ? label(String(text)) : null, input]
    });
}
