import {describe, expect, it} from 'vitest';
import {removalMessage} from './removalMessage';

/** What removing an element takes with it, in words that agree with how many it names. */
describe('removalMessage', () => {
    const removal = (over: object) => ({
        elements: ['posGrid'],
        removedVariables: [],
        unboundVariables: [],
        presetPaths: [],
        ...over
    });

    it('names one variable that loses a writer in the singular, and several in the plural', () => {
        expect(removalMessage('posGrid', removal({unboundVariables: ['grouping']}))).toBe(
            'Remove posGrid? grouping loses a writer, and keeps its other writers or its default.'
        );
        expect(removalMessage('posGrid', removal({unboundVariables: ['grouping', 'asOf']}))).toBe(
            'Remove posGrid? grouping and asOf lose a writer, and keep their other writers or their default.'
        );
    });

    it('names the variables that go with it, one or several', () => {
        expect(removalMessage('posGrid', removal({removedVariables: ['grouping']}))).toBe(
            'Remove posGrid? Variable grouping goes too.'
        );
        expect(
            removalMessage('posGrid', removal({removedVariables: ['grouping', 'asOf', 'book']}))
        ).toBe('Remove posGrid? Variables grouping, asOf and book go too.');
    });
});
