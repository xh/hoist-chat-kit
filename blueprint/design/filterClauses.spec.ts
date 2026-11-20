import {describe, expect, it} from 'vitest';
import {joinClauses, splitClauses} from './filterClauses';

/**
 * A filter splits into the clauses ANDed at its top: those that name a variable, which a designer
 * keeps or removes whole, and literal ones, which a filter chooser edits.
 */
describe('filter clauses', () => {
    const lit = {field: 'region', op: '=', value: 'EMEA'},
        bound = {field: 'fund', op: '=', value: {$var: 'fund'}};

    it('splits an AND, or one clause, into bound and literal clauses', () => {
        expect(splitClauses({op: 'AND', filters: [lit, bound]})).toEqual({
            bound: [bound],
            literal: [lit]
        });
        expect(splitClauses(lit)).toEqual({bound: [], literal: [lit]});
        expect(splitClauses(null)).toEqual({bound: [], literal: []});
    });

    it('keeps an OR whole: literal if it names no variable, else bound', () => {
        const or = {op: 'OR', filters: [lit, {field: 'region', op: '=', value: 'APAC'}]};
        expect(splitClauses(or)).toEqual({bound: [], literal: [or]});
        const boundOr = {op: 'OR', filters: [lit, bound]};
        expect(splitClauses(boundOr)).toEqual({bound: [boundOr], literal: []});
    });

    it('joins clauses back: none, one, or an AND', () => {
        expect(joinClauses([], [])).toBeUndefined();
        expect(joinClauses([bound], [])).toEqual(bound);
        expect(joinClauses([bound], [lit])).toEqual({op: 'AND', filters: [bound, lit]});
    });
});
