import {describe, expect, it} from 'vitest';
import type {ChatSourcePart} from '../../../core';
import {findCitedSource, getCitationNumber} from '../../../impl/sources';
import {type MdastNode, remarkCitations} from './CitationMarkers';

/**
 * Citation markers such as `[1]` in model text become buttons for the sources they cite. Apps rely
 * on markers resolving by `marker` - or by position when no source has one - and on any bracketed
 * text that is not a citation staying exactly as the model wrote it.
 */
describe('remarkCitations', () => {
    const S1 = source('s1'),
        S2 = source('s2'),
        S3 = source('s3');

    it('turns a marker in text into a citation element', () => {
        expect(transform(paragraph(text('Rates rose [1].')), [S1, S2])).toEqual(
            paragraph(text('Rates '), run(text('rose '), citation('[1]', [1]), text('.')))
        );
    });

    it('keeps each marker on one line with the word before it and the punctuation after', () => {
        expect(transform(paragraph(text('The cap is 75%[1], or 70% [2]; see')), [S1, S2])).toEqual(
            paragraph(
                text('The cap is '),
                run(text('75%'), citation('[1]', [1]), text(',')),
                text(' or '),
                run(text('70% '), citation('[2]', [2]), text(';')),
                text(' see')
            )
        );
    });

    it('leaves a range as written, with either dash', () => {
        expect(transform(paragraph(text('All [1–3] and [1-2, 3].')), [S1, S2, S3])).toEqual(
            paragraph(text('All [1–3] and [1-2, 3].'))
        );
    });

    it('turns a list of numbers into one citation element for all of them', () => {
        expect(transform(paragraph(text('See [1, 2] and [2,3].')), [S1, S2, S3])).toEqual(
            paragraph(
                run(text('See '), citation('[1, 2]', [1, 2])),
                text(' '),
                run(text('and '), citation('[2,3]', [2, 3]), text('.'))
            )
        );
    });

    it('turns adjacent markers into adjacent citation elements', () => {
        expect(transform(paragraph(text('Both agree [1][2]')), [S1, S2])).toEqual(
            paragraph(
                text('Both '),
                run(text('agree '), citation('[1]', [1]), citation('[2]', [2]))
            )
        );
    });

    it('converts markers at the start and end of a text node, with no empty text around them', () => {
        expect(transform(paragraph(text('[1] leads, and so does [2]')), [S1, S2])).toEqual(
            paragraph(
                run(citation('[1]', [1])),
                text(' leads, and so '),
                run(text('does '), citation('[2]', [2]))
            )
        );
    });

    it('finds markers in text nested in emphasis, list items, headings and table cells', () => {
        const tree = root(
            paragraph(strong(text('Bold [1]'))),
            node('list', node('listItem', paragraph(text('Item [2]')))),
            node('heading', text('Heading [1]')),
            node('table', node('tableRow', node('tableCell', text('Cell [2]'))))
        );

        transform(tree, [S1, S2]);
        expect(citationsIn(tree)).toEqual([[1], [2], [1], [2]]);
    });

    it('leaves markers in inline code and code blocks as written', () => {
        const tree = root(
            paragraph(text('Use '), node('inlineCode', null, '[1]')),
            node('code', null, 'arr[1]')
        );
        const before = structuredClone(tree);

        expect(transform(tree, [S1])).toEqual(before);
    });

    it('leaves the text of links and link references as written', () => {
        const tree = paragraph(
            node('link', text('[1]')),
            text(' and '),
            node('linkReference', text('[2]'))
        );
        const before = structuredClone(tree);

        expect(transform(tree, [S1, S2])).toEqual(before);
    });

    it('never matches footnote syntax', () => {
        const tree = paragraph(text('A claim[^1] and [^2].'));
        expect(transform(tree, [S1, S2])).toEqual(paragraph(text('A claim[^1] and [^2].')));
    });

    it('leaves a marker as written if any of its numbers cites no source', () => {
        expect(transform(paragraph(text('See [3] and [1, 3].')), [S1, S2])).toEqual(
            paragraph(text('See [3] and [1, 3].'))
        );
    });

    it('converts each marker of an adjacent pair on its own', () => {
        expect(transform(paragraph(text('[1][3]')), [S1, S2])).toEqual(
            paragraph(run(citation('[1]', [1])), text('[3]'))
        );
    });

    it('leaves bracketed text that is not a list of numbers as written', () => {
        const value = 'Arrays [a], ranges [1-], decimals [1.5], empty [] and [ 1 ].';
        expect(transform(paragraph(text(value)), [S1, S2])).toEqual(paragraph(text(value)));
    });

    it('converts nothing when there are no sources', () => {
        expect(transform(paragraph(text('Rates rose [1].')), [])).toEqual(
            paragraph(text('Rates rose [1].'))
        );
    });

    it('resolves numbers by marker when any source has one', () => {
        const sources = [source('a', 7), source('b', 3)];
        expect(transform(paragraph(text('[3] then [7], not [1]')), sources)).toEqual(
            paragraph(
                run(citation('[3]', [3])),
                text(' '),
                run(text('then '), citation('[7]', [7]), text(',')),
                text(' not [1]')
            )
        );
    });

    describe('while text streams', () => {
        it('leaves a partial marker at the end as plain text', () => {
            ['Rates rose [', 'Rates rose [1', 'Rates rose [1,', 'Rates rose [1, 2'].forEach(
                value => {
                    expect(transform(paragraph(text(value)), [S1, S2])).toEqual(
                        paragraph(text(value))
                    );
                }
            );
        });

        it('converts the marker once its closing bracket arrives', () => {
            expect(transform(paragraph(text('Rates rose [1, 2]')), [S1, S2])).toEqual(
                paragraph(text('Rates '), run(text('rose '), citation('[1, 2]', [1, 2])))
            );
        });

        it('converts the finished markers before a partial one', () => {
            expect(transform(paragraph(text('Up [1] and down [2')), [S1, S2])).toEqual(
                paragraph(run(text('Up '), citation('[1]', [1])), text(' and down [2'))
            );
        });
    });
});

describe('findCitedSource', () => {
    it('finds the nth source, counting from 1, when no source has a marker', () => {
        const sources = [source('a'), source('b')];
        expect(findCitedSource(sources, 1)).toBe(sources[0]);
        expect(findCitedSource(sources, 2)).toBe(sources[1]);
        expect(findCitedSource(sources, 0)).toBeNull();
        expect(findCitedSource(sources, 3)).toBeNull();
    });

    it('finds the source by marker when any source has one, never by position', () => {
        const sources = [source('a', 2), source('b')];
        expect(findCitedSource(sources, 2)).toBe(sources[0]);
        expect(findCitedSource(sources, 1)).toBeNull();
    });

    it('finds nothing among no sources', () => {
        expect(findCitedSource(null, 1)).toBeNull();
        expect(findCitedSource([], 1)).toBeNull();
    });
});

describe('getCitationNumber', () => {
    it('numbers a source by its marker, else by its position', () => {
        const plain = [source('a'), source('b')],
            marked = [source('a', 4), source('b')];

        expect(getCitationNumber(plain, plain[1])).toBe(2);
        expect(getCitationNumber(marked, marked[0])).toBe(4);
        expect(getCitationNumber(marked, marked[1])).toBeNull();
    });
});

//------------------
// Helpers
//------------------
function source(id: string, marker?: number): ChatSourcePart {
    return {type: 'source', id, title: `Source ${id}`, url: `https://${id}.example`, marker};
}

function transform<T extends MdastNode>(tree: T, sources: ChatSourcePart[]): T {
    remarkCitations({sources})(tree);
    return tree;
}

function node(type: string, child?: MdastNode, value?: string): MdastNode {
    return value != null ? {type, value} : {type, children: child ? [child] : []};
}

function root(...children: MdastNode[]): MdastNode {
    return {type: 'root', children};
}

function paragraph(...children: MdastNode[]): MdastNode {
    return {type: 'paragraph', children};
}

function strong(...children: MdastNode[]): MdastNode {
    return {type: 'strong', children};
}

function text(value: string): MdastNode {
    return {type: 'text', value};
}

function citation(value: string, numbers: number[]): MdastNode {
    return {
        type: 'xhChatCitation',
        numbers,
        data: {
            hName: 'xh-chat-citation',
            hProperties: {dataMarkers: numbers.join(' ')},
            hChildren: [{type: 'text', value}]
        }
    };
}

function run(...children: MdastNode[]): MdastNode {
    return {
        type: 'xhChatCitationRun',
        children,
        data: {hName: 'span', hProperties: {className: ['xh-chat-markdown__citation-run']}}
    };
}

function citationsIn(tree: MdastNode): number[][] {
    if (tree.type === 'xhChatCitation') return [tree.numbers as number[]];
    return (tree.children ?? []).flatMap(citationsIn);
}
