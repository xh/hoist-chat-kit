import {fragment, label} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {dateInput, numberInput, select, switchInput, textInput} from '@xh/hoist/desktop/cmp/input';
import {toolbar} from '@xh/hoist/desktop/cmp/toolbar';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {isEmpty} from 'lodash';
import type {ReactNode} from 'react';
import type {BlueprintModel, BlueprintVariable} from '../../../../blueprint';

interface BlueprintToolbarProps extends HoistProps {
    blueprintModel: BlueprintModel;
}

/** The blueprint's toolbar: an input for each prompted variable. Hidden when there are none. */
export const blueprintToolbar = hoistCmp.factory<BlueprintToolbarProps>({
    displayName: 'BlueprintToolbar',
    model: false,
    render({blueprintModel: model}) {
        const prompts = model.variables.filter(it => it.decl.setBy === 'prompt');
        if (isEmpty(prompts)) return null;
        return toolbar({
            className: 'xh-blueprint-view__toolbar',
            children: prompts.flatMap(it => [
                label(it.decl.label ?? it.name),
                promptInput(it, model, value => model.setVariable(it.name, value))
            ])
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
