import {filler, fragment, label} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, managed, useLocalModel, XH} from '@xh/hoist/core';
import {dateRangePicker} from '@xh/hoist/desktop/cmp/daterange';
import {dateInput, numberInput, select, switchInput, textInput} from '@xh/hoist/desktop/cmp/input';
import {toolbar} from '@xh/hoist/desktop/cmp/toolbar';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {isEmpty} from 'lodash';
import type {ReactNode} from 'react';
import type {BlueprintModel, BlueprintVariable} from '../../../../blueprint';
import {DateRangeBinding} from './DateRangeBinding';

interface BlueprintToolbarProps extends HoistProps {
    blueprintModel: BlueprintModel;
}

/**
 * The blueprint's toolbar: an input for each prompted variable, then a switch for each preset
 * group. Hidden when there are neither.
 */
export const blueprintToolbar = hoistCmp.factory<BlueprintToolbarProps>({
    displayName: 'BlueprintToolbar',
    model: false,
    render({blueprintModel: model}) {
        const prompts = model.variables.filter(it => it.decl.setBy === 'prompt'),
            presets = Object.entries(model.blueprint?.presets ?? {});
        if (isEmpty(prompts) && isEmpty(presets)) return null;
        return toolbar({
            className: 'xh-blueprint-view__toolbar',
            children: [
                ...prompts.flatMap(it => [
                    label(it.decl.label ?? it.name),
                    promptInput(it, model, value => model.setVariable(it.name, value))
                ]),
                filler(),
                ...presets.flatMap(([name, group]) => [
                    label(group.label ?? name),
                    select({
                        key: `preset-${name}`,
                        options: Object.entries(group.items ?? {}).map(([value, item]) => ({
                            value,
                            label: item.label ?? value
                        })),
                        value: model.getActivePreset(name),
                        onChange: item => model.setPreset(name, item),
                        enableFilter: false,
                        width: 160
                    })
                ])
            ]
        });
    }
});

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

    if (options && 'values' in options) {
        return select({
            ...common,
            options: options.values as any[],
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

    constructor(variable: BlueprintVariable, blueprintModel: BlueprintModel) {
        super();
        this.binding = new DateRangeBinding({
            registry: blueprintModel.registry,
            presets: null,
            getValue: () => variable.value,
            setValue: value => blueprintModel.setVariable(variable.name, value),
            getAsOf: () => blueprintModel.resolve(variable.decl.asOf) as string
        });
    }
}
