import {describe, expect, it} from 'vitest';
import {joinNamed, joinSteps, splitNamed, stepsOf} from './configValues';

/**
 * A format or renderer is a name, options, or a name with options. An action prop is one step or
 * a list of them. An editor splits each into its parts and writes back the simplest form.
 */
describe('config values', () => {
    it('splits a name, options, or a name with options', () => {
        expect(splitNamed('pnl')).toEqual({name: 'pnl', options: {}});
        expect(splitNamed({precision: 1})).toEqual({name: null, options: {precision: 1}});
        expect(splitNamed({name: 'pnl', precision: 2})).toEqual({
            name: 'pnl',
            options: {precision: 2}
        });
        expect(splitNamed(undefined)).toEqual({name: null, options: {}});
    });

    it('joins them back in the simplest form, or to nothing', () => {
        expect(joinNamed('pnl', {})).toBe('pnl');
        expect(joinNamed('pnl', {precision: 2})).toEqual({name: 'pnl', precision: 2});
        expect(joinNamed(null, {precision: 1})).toEqual({precision: 1});
        expect(joinNamed(null, {})).toBeUndefined();
    });

    it('reads an action prop as steps, and writes one step as itself', () => {
        const refresh = {type: 'refresh'},
            reset = {type: 'resetVariable', variable: 'x'};
        expect(stepsOf(refresh)).toEqual([refresh]);
        expect(stepsOf([refresh, reset])).toEqual([refresh, reset]);
        expect(stepsOf(undefined)).toEqual([]);
        expect(joinSteps([refresh])).toEqual(refresh);
        expect(joinSteps([refresh, reset])).toEqual([refresh, reset]);
        expect(joinSteps([])).toBeUndefined();
    });
});
