import {describe, expect, it, onTestFinished} from 'vitest';
import {layoutGesture} from './gesture';

/** A layout gesture never outlives the pointer that made it, so the designer cannot get stuck. */
describe('layoutGesture', () => {
    it.each([
        ['the pointer is released anywhere', () => new Event('pointerup')],
        ['a drag ends anywhere', () => new Event('dragend')],
        ['the window loses focus', () => new Event('blur')],
        ['Escape is pressed', () => new KeyboardEvent('keydown', {key: 'Escape'})]
    ])('ends when %s, though its own end never ran', (_, event) => {
        onTestFinished(() => layoutGesture.end());
        layoutGesture.start();
        expect(document.body.classList).toContain('xh-layout-gesture');
        window.dispatchEvent(event());
        expect(layoutGesture.active).toBe(false);
        expect(document.body.classList).not.toContain('xh-layout-gesture');
    });

    it('keeps going through other keys', () => {
        onTestFinished(() => layoutGesture.end());
        layoutGesture.start();
        window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Shift'}));
        expect(layoutGesture.active).toBe(true);
    });
});
