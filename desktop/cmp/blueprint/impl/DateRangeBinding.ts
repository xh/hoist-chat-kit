import {
    DEFAULT_DATE_RANGE_PRESETS,
    type DateRangeAnchorDay,
    type DateRangePreset,
    DateRangePickerModel,
    dateRangePresets,
    type DateRangeSelection
} from '@xh/hoist/cmp/daterange';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {HoistBase, managed} from '@xh/hoist/core';
import {isEqual, isString, uniq} from 'lodash';
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
        /** The date its ranges run to, as `YYYY-MM-DD`. Default today. */
        getAsOf?: () => string;
    }) {
        super();
        const {registry, getValue, setValue, getAsOf = () => null} = opts,
            value = getValue() as DateRangeSelection | string;
        this.pickerModel = new DateRangePickerModel({
            presets: presetsOf(registry, opts.presets, value),
            initialValue: value ?? null,
            anchorDay: anchorOf(getAsOf()),
            commitOnChange: true
        });
        this.addReaction(
            {
                track: getAsOf,
                run: asOf => this.pickerModel.setAnchorDay(anchorOf(asOf))
            },
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

// The presets named, else Hoist's usual set and the app's, with the value's preset in any case.
function presetsOf(
    registry: BlueprintRegistry,
    tokens: string[],
    value: DateRangeSelection | string
): DateRangePreset[] {
    const appTokens = Object.keys(registry.dateRangePresets).filter(it => !dateRangePresets[it]),
        offered = tokens?.length ? tokens : [...DEFAULT_DATE_RANGE_PRESETS, ...appTokens],
        current = isString(value) ? value : value?.kind === 'preset' ? value.token : null;
    return uniq([...offered, ...(current ? [current] : [])])
        .map(it => registry.dateRangePresets[it])
        .filter(Boolean);
}

function anchorOf(asOf: string): DateRangeAnchorDay {
    return asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? LocalDate.get(asOf) : 'localDay';
}
