import {describe, expect, it} from 'vitest';
import {styleToCss} from './gridStyles';

/** A style maps to CSS from a closed set alone, whatever reaches it past the validator. */
describe('styleToCss', () => {
    it('maps each key to its CSS', () => {
        expect(
            styleToCss({
                color: 'danger',
                background: '#aabbcc',
                fontWeight: 'bold',
                fontStyle: 'italic',
                textDecoration: 'line-through',
                align: 'center',
                border: 'warning'
            })
        ).toEqual({
            color: 'var(--xh-intent-danger-text-color)',
            backgroundColor: '#aabbcc',
            fontWeight: 'bold',
            fontStyle: 'italic',
            textDecoration: 'line-through',
            textAlign: 'center',
            justifyContent: 'center',
            boxShadow: 'inset 3px 0 0 var(--xh-intent-warning)'
        });
        expect(styleToCss({color: 'muted'})).toEqual({color: 'var(--xh-text-color-muted)'});
    });

    it('leaves out any value outside the set', () => {
        for (const color of ['url(x)', 'var(--x)', 'expression(1)', '#fff', 'red', ' danger']) {
            expect(styleToCss({color})).toEqual({});
        }
        expect(styleToCss({background: 'muted'})).toEqual({});
        expect(styleToCss({align: 'constructor', border: '__proto__'})).toEqual({});
        expect(styleToCss({fontWeight: 'bolder', cursor: 'pointer'})).toEqual({});
        expect(styleToCss(null)).toEqual({});
    });
});
