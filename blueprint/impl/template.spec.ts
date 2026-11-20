import {describe, expect, it} from 'vitest';
import {markdownTemplate, parseTemplate, templateDemand, VALUE_TOKEN} from './template';

/**
 * A template is text with references in braces: `{name}` for a variable or a field of the default
 * source, and `{source.field}` for a field of any source. `{{` writes a literal brace.
 */
describe('templates', () => {
    it('splits text into literal parts and references', () => {
        expect(parseTemplate('P&L for {fund}: {positions.pnlDay}.')).toEqual({
            parts: [
                'P&L for ',
                {ref: 'fund', source: null, name: 'fund'},
                ': ',
                {ref: 'positions.pnlDay', source: 'positions', name: 'pnlDay'},
                '.'
            ],
            badRefs: []
        });
    });

    it('writes {{ as a literal brace, and leaves a lone closing brace as it is', () => {
        expect(parseTemplate('a {{b} c').parts).toEqual(['a {b} c']);
    });

    it('reports a reference it cannot read, and an unclosed brace', () => {
        expect(parseTemplate('{} {a b} {x.y.z} {ok} {open').badRefs).toEqual([
            '{}',
            '{a b}',
            '{x.y.z}',
            '{open'
        ]);
    });

    it('demands the root of each source it names, with an undotted name on the default source', () => {
        expect(templateDemand('{fund} {mktVal} {orders.qty} {orders.price}', 'positions')).toEqual({
            positions: {fields: ['fund', 'mktVal'], groupBy: []},
            orders: {fields: ['qty', 'price'], groupBy: []}
        });
        expect(templateDemand('{fund}', null)).toEqual({});
    });

    it('writes a token for each value of a markdown template, which markdown leaves as it is', () => {
        const {content, values} = markdownTemplate('**{a}** and {b.c}', ref => `<${ref.name}>`);
        expect(values).toEqual(['<a>', '<c>']);
        expect(content.replace(VALUE_TOKEN, (_, i) => values[i])).toBe('**<a>** and <c>');
        expect(content).not.toContain('<a>');
    });
});
