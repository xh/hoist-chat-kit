import {fragment, hbox, label} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    useLocalModel,
    uses,
    XH
} from '@xh/hoist/core';
import {dateRangePicker} from '@xh/hoist/desktop/cmp/daterange';
import {dateInput, numberInput, select, switchInput, textInput} from '@xh/hoist/desktop/cmp/input';
import {LocalDate} from '@xh/hoist/utils/datetime';
import classNames from 'classnames';
import type {ReactNode} from 'react';
import {
    type BlueprintModel,
    type BlueprintVariable,
    BlueprintWidgetModel,
    type VariableInputWidgetConfig,
    variableLabel
} from '../../../blueprint';
import {DateRangeBinding} from './impl/DateRangeBinding';

/** The `variableInput` widget's model: the prompted variable its config names. */
export class VariableInputWidgetModel extends BlueprintWidgetModel<VariableInputWidgetConfig> {
    /** The variable it shows, or null if the blueprint has none of its name. */
    get variable(): BlueprintVariable {
        return this.blueprintModel.getVariable(this.resolvedConfig.variable as string) ?? null;
    }

    /** Set the variable to a value the user gave. */
    set(value: unknown) {
        const {variable} = this;
        if (variable) this.blueprintModel.setVariable(variable.name, value);
    }
}

/**
 * The `variableInput` widget: the input a prompted variable's type calls for, beside its label. It
 * shows nothing until its config names a variable the blueprint declares.
 */
export const [VariableInputWidget, variableInputWidget] = hoistCmp.withFactory({
    displayName: 'VariableInputWidget',
    className: 'xh-blueprint-variable-input',
    model: uses(VariableInputWidgetModel),
    render({model, className}) {
        const {variable, blueprintModel, resolvedConfig} = model;
        if (!variable) return null;
        const text = resolvedConfig.label || variableLabel(variable.name, variable.decl);
        return hbox({
            className: classNames('xh-blueprint-input', className),
            alignItems: 'center',
            children: [
                label(String(text)),
                promptInput(variable, blueprintModel, value => model.set(value))
            ]
        });
    }
});

//------------------
// Implementation
//------------------
function promptInput(
    v: BlueprintVariable,
    model: BlueprintModel,
    set: (value: unknown) => void
): ReactNode {
    const {type, options} = v.decl,
        common = {key: v.name, title: v.decl.description},
        appInput = model.registry.variableTypes[type]?.input;

    if (appInput)
        return fragment({
            key: v.name,
            children: appInput({variable: v, value: v.value, onCommit: set})
        });

    if (options) {
        return select({
            ...common,
            options: v.options as any[],
            value: v.value,
            onChange: set
        });
    }
    switch (type) {
        case 'dateRange':
            return dateRangePrompt({key: v.name, variable: v, blueprintModel: model});
        case 'period':
            return textInput({
                ...common,
                value: v.value as string,
                placeholder: '3M',
                onCommit: (value: string) => {
                    try {
                        set(value || null);
                    } catch (e) {
                        XH.dangerToast(
                            `${value} is not a period. Write a count and D, W, M, Q or Y, such as 3M.`
                        );
                    }
                },
                width: 70
            });
        case 'localDate':
            return dateInput({
                ...common,
                valueType: 'localDate',
                value: v.value ? LocalDate.get(v.value as string) : null,
                onCommit: (d: LocalDate) => set(d?.isoString ?? null),
                width: 130
            });
        case 'date':
            return dateInput({
                ...common,
                value: v.value != null ? new Date(v.value as number) : null,
                onCommit: (d: Date) => set(d?.getTime() ?? null),
                width: 130
            });
        case 'number':
        case 'int':
            return numberInput({
                ...common,
                value: v.value as number,
                precision: type === 'int' ? 0 : null,
                onCommit: set,
                width: 100
            });
        case 'bool':
            return switchInput({...common, value: !!v.value, onChange: set});
        default:
            return textInput({...common, value: v.value as string, onCommit: set, width: 160});
    }
}

interface DateRangePromptProps extends HoistProps {
    variable: BlueprintVariable;
    blueprintModel: BlueprintModel;
}

/** A picker for a prompted `dateRange` variable, which keeps no state of its own. */
const dateRangePrompt = hoistCmp.factory<DateRangePromptProps>({
    displayName: 'BlueprintDateRangePrompt',
    model: false,
    render({variable, blueprintModel}) {
        const impl = useLocalModel(() => new DateRangePromptModel(variable, blueprintModel));
        return dateRangePicker({model: impl.binding.pickerModel});
    }
});

class DateRangePromptModel extends HoistModel {
    @managed readonly binding: DateRangeBinding;

    // Read by name, as an edit of the declaration makes the variable anew.
    constructor({name}: BlueprintVariable, blueprintModel: BlueprintModel) {
        super();
        const variable = () => blueprintModel.getVariable(name);
        this.binding = new DateRangeBinding({
            registry: blueprintModel.registry,
            presets: null,
            getValue: () => variable()?.value,
            setValue: value => blueprintModel.setVariable(name, value),
            getAsOf: () => blueprintModel.resolve(variable()?.decl.asOf) as string
        });
    }
}
