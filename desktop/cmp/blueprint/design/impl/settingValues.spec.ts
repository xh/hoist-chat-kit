import {LocalDate} from '@xh/hoist/utils/datetime';
import {describe, expect, it} from 'vitest';
import {type EditorNode, toEditorSpec} from '../../../../../blueprint';
import {fromFieldValue, toFieldValue} from './settingValues';

const node = (schema: object): EditorNode =>
    toEditorSpec({type: 'object', properties: {it: schema}})[0];

/**
 * A setting's value as the blueprint holds it, and as its input shows it: unset shows the default,
 * a value equal to its default goes unset, and an emptied input unsets the setting.
 */
describe('settingValues', () => {
    it('shows an unset text or number as empty, and unsets an emptied one', () => {
        const text = node({type: 'string'});
        expect(toFieldValue(text, undefined)).toBeNull();
        expect(toFieldValue(text, 'P&L')).toBe('P&L');
        expect(fromFieldValue(text, '')).toBeUndefined();
        expect(fromFieldValue(text, null)).toBeUndefined();
        expect(fromFieldValue(node({type: 'number'}), 0)).toBe(0);
    });

    it('shows an unset boolean at its default, and unsets one set to its default', () => {
        const stripe = node({type: 'boolean', default: true});
        expect(toFieldValue(stripe, undefined)).toBe(true);
        expect(fromFieldValue(stripe, true)).toBeUndefined();
        expect(fromFieldValue(stripe, false)).toBe(false);
        expect(toFieldValue(node({type: 'boolean'}), undefined)).toBe(false);
    });

    it('shows a short choice at its default, and unsets one set to its default or none', () => {
        const align = node({type: 'string', enum: ['left', 'right'], default: 'left'});
        expect(toFieldValue(align, undefined)).toBe('left');
        expect(fromFieldValue(align, 'left')).toBeUndefined();
        expect(fromFieldValue(align, 'right')).toBe('right');
        expect(fromFieldValue(node({type: 'string', enum: ['a', 'b']}), null)).toBeUndefined();
    });

    it('shows a choice with an off state as off while unset, and true as its first option', () => {
        const place = node({enum: [false, 'top', 'bottom'], default: false});
        expect(toFieldValue(place, undefined)).toBe(false);
        expect(toFieldValue(node({enum: [true, false, 'top', 'bottom']}), true)).toBe(false);
        expect(fromFieldValue(place, false)).toBeUndefined();
        expect(fromFieldValue(place, 'top')).toBe('top');
    });

    it('holds a date as a LocalDate, and commits it as its ISO string', () => {
        const date = node({type: 'string', format: 'date'});
        expect(toFieldValue(date, '2026-11-24')).toEqual(LocalDate.get('2026-11-24'));
        expect(fromFieldValue(date, LocalDate.get('2026-11-24'))).toBe('2026-11-24');
        expect(fromFieldValue(date, null)).toBeUndefined();
    });

    it('shows an unset list as empty, and unsets an emptied optional one', () => {
        const tags = node({type: 'array', items: {type: 'string'}});
        expect(toFieldValue(tags, undefined)).toEqual([]);
        expect(fromFieldValue(tags, [])).toBeUndefined();
        expect(fromFieldValue(tags, ['a'])).toEqual(['a']);
    });

    it('passes a variable binding through as it is', () => {
        const stripe = node({type: 'boolean', default: true}),
            bound = {$var: 'striped'};
        expect(toFieldValue(stripe, bound)).toBe(bound);
        expect(fromFieldValue(stripe, bound)).toBe(bound);
    });
});
