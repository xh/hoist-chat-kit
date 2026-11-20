import {
    DEFAULT_DATE_RANGE_PRESETS,
    type DateRangePreset,
    DateRangePickerModel,
    dateRangePresets
} from '@xh/hoist/cmp/daterange';
import {HoistBase, managed} from '@xh/hoist/core';
import {isEqual} from 'lodash';
import type {BlueprintRegistry} from '../../../../blueprint';

/**
 * A Hoist `DateRangePickerModel` kept in step with a `dateRange` variable, in both directions. It
 * offers the presets named, or Hoist's usual set and every preset the app registers.
 */
export class DateRangeBinding extends HoistBase {
    @managed readonly pickerModel: DateRangePickerModel;

    constructor(opts: {
        registry: BlueprintRegistry;
        presets: string[];
        getValue: () => unknown;
        setValue: (value: unknown) => void;
    }) {
        super();
        const {registry, getValue, setValue} = opts;
        this.pickerModel = new DateRangePickerModel({
            presets: presetsOf(registry, opts.presets),
            initialValue: (getValue() as any) ?? null,
            commitOnChange: true
        });
        this.addReaction(
            {
                track: getValue,
                run: value => {
                    if (!isEqual(value ?? null, this.pickerModel.value)) {
                        this.pickerModel.setValue((value as any) ?? null);
                    }
                },
                equals: 'structural'
            },
            {
                track: () => this.pickerModel.value,
                run: value => {
                    if (!isEqual(value, getValue() ?? null)) setValue(value);
                },
                equals: 'structural'
            }
        );
    }
}

function presetsOf(registry: BlueprintRegistry, tokens: string[]): DateRangePreset[] {
    const appTokens = Object.keys(registry.dateRangePresets).filter(it => !dateRangePresets[it]);
    return (tokens?.length ? tokens : [...DEFAULT_DATE_RANGE_PRESETS, ...appTokens])
        .map(it => registry.dateRangePresets[it])
        .filter(Boolean);
}
