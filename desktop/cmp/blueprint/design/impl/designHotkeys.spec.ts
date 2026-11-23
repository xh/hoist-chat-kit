import {describe, expect, it} from 'vitest';
import type {BlueprintDesignModel} from '../../../../../blueprint';
import {designHotkeys} from './designHotkeys';

/** The design keys, which Blueprint's own "?" dialog lists under Design beside the app's. */
describe('designHotkeys', () => {
    it("leaves ? to Blueprint's dialog, and gives each key a label there, under Design", () => {
        const keys = designHotkeys({} as BlueprintDesignModel);
        expect(keys.map(it => it.combo)).not.toContain('shift+/');
        keys.forEach(it => {
            expect(it.group).toBe('Design');
            expect(it.label).toBeTruthy();
        });
    });
});
