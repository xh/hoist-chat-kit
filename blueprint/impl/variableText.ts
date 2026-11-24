import {fmtDate, fmtNumber} from '@xh/hoist/format';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {describeValue} from '../builtInWidgets';

/** A variable's value as text in a template: a date or number formatted, null as empty. */
export function variableText(value: unknown, type: string): string {
    if (value == null) return '';
    if (type === 'localDate' && typeof value === 'string') {
        return fmtDate(LocalDate.get(value), {asHtml: true}) as string;
    }
    if (typeof value === 'number') return fmtNumber(value, {asHtml: true}) as string;
    return describeValue(value);
}
