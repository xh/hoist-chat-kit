import {afterEach, describe, expect, it} from 'vitest';
import {altHold} from './altHold';

/**
 * Alt held while designing: the next click reaches the widget, as in Interact. Only one click,
 * and only while Alt is down.
 */
describe('altHold', () => {
    let stop: () => void = null;
    afterEach(() => {
        stop?.();
        stop = null;
    });

    const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit = {}) =>
        window.dispatchEvent(new KeyboardEvent(type, {key: 'Alt', bubbles: true, ...init}));

    it('is active while Alt is down, and marks the page for the cursor', () => {
        stop = altHold.follow();
        key('keydown');
        expect(altHold.active).toBe(true);
        expect(document.body.classList).toContain('xh-blueprint-alt-hold');
        key('keyup');
        expect(altHold.active).toBe(false);
        expect(document.body.classList).not.toContain('xh-blueprint-alt-hold');
    });

    it('passes one click only: a held key repeating does not start it again', () => {
        stop = altHold.follow();
        key('keydown');
        altHold.consume();
        expect(altHold.active).toBe(false);
        key('keydown', {repeat: true});
        expect(altHold.active).toBe(false);
        key('keyup');
        key('keydown');
        expect(altHold.active).toBe(true);
    });

    it('lets go when the window loses focus, and stops following once nothing follows it', () => {
        stop = altHold.follow();
        key('keydown');
        window.dispatchEvent(new Event('blur'));
        expect(altHold.active).toBe(false);
        stop();
        stop = null;
        key('keydown');
        expect(altHold.active).toBe(false);
    });
});
