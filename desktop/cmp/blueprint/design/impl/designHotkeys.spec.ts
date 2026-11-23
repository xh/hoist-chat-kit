import {describe, expect, it, vi} from 'vitest';
import type {BlueprintDesignModel} from '../../../../../blueprint';
import {designHotkeys, modeHotkeys} from './designHotkeys';

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

    it("binds P to the host's Preview toggle, while one is set, in run mode too", () => {
        const onPreview = vi.fn(),
            dm = {blueprintModel: {mode: 'design'}, onPreview: null} as any,
            p = () => designHotkeys(dm).find(it => it.combo === 'p');
        expect(p()).toBeUndefined();
        dm.onPreview = onPreview;
        expect(p()).toMatchObject({group: 'Design', label: "Preview: the reader's view"});
        p().onKeyDown({target: document.body, preventDefault: () => null} as any);
        dm.blueprintModel.mode = 'run';
        p().onKeyDown({target: document.body, preventDefault: () => null} as any);
        expect(onPreview).toHaveBeenCalledTimes(2);
        // The Inspector's keys take it too.
        expect(modeHotkeys(dm).map(it => it.combo)).toContain('p');
    });
});
