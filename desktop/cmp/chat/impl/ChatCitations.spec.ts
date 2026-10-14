import {describe, expect, it} from 'vitest';
import type {ChatCitation, ChatPart, ChatSourcePart} from '../../../../core';
import {collectReferences, numberCitations, toSourceList} from './ChatCitations';

/**
 * Citation chips carry numbers that match the source list below the reply. Apps rely on each
 * citation showing with a number that no other reference uses, and on numbers that hold steady
 * while the reply streams.
 */
describe('citation numbering', () => {
    const S1: ChatSourcePart = {type: 'source', id: 's1', url: 'https://a.example'},
        S2: ChatSourcePart = {type: 'source', id: 's2', url: 'https://b.example'};

    it('numbers references in order of first citation, then the sources never cited', () => {
        const refs = collectReferences([
            text('t1', [{id: 'c1', sourceId: 's2'}]),
            text('t2', [
                {id: 'c1', url: 'https://a.example'},
                {id: 'c2', sourceId: 's2'}
            ]),
            S1,
            S2,
            {type: 'source', id: 's3', url: 'https://c.example'}
        ]);

        expect(refs.map(it => [it.number, it.source?.id])).toEqual([
            [1, 's2'],
            [2, 's1'],
            [3, 's3']
        ]);
    });

    it('keeps each number once assigned, as text and sources stream in', () => {
        const citations: ChatCitation[] = [
                {id: 'c1', url: 'https://other.example', title: 'Other'},
                {id: 'c2', sourceId: 's1'}
            ],
            // The text and its citations arrive before the sources.
            early = collectReferences([text('t1', citations)]),
            late = collectReferences([text('t1', citations), text('t2', [{id: 'c3'}]), S1, S2]);

        expect(numberCitations(citations, early).map(it => it.number)).toEqual([1, 2]);
        expect(numberCitations(citations, late).map(it => it.number)).toEqual([1, 2]);
        expect(late.map(it => it.number)).toEqual([1, 2, 3, 4]);
    });

    it('never gives two references the same number', () => {
        const refs = collectReferences([
            text('t1', [{id: 'c1', url: 'https://other.example'}]),
            S1,
            S2
        ]);
        expect(refs.map(it => it.number)).toEqual([1, 2, 3]);
    });

    it('lists a cited source the message does not report, so every chip has an entry', () => {
        const refs = collectReferences([
                text('t1', [
                    {id: 'c1', url: 'https://other.example', title: 'Other', citedText: 'Quote'}
                ]),
                S1
            ]),
            list = toSourceList(refs);

        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({
            url: 'https://other.example',
            title: 'Other',
            snippet: 'Quote'
        });
        expect(list[1]).toBe(S1);
    });

    it('shows a source cited twice in one passage once', () => {
        const citations: ChatCitation[] = [
                {id: 'c1', sourceId: 's1'},
                {id: 'c2', sourceId: 's1'}
            ],
            refs = collectReferences([text('t1', citations), S1]);
        expect(numberCitations(citations, refs)).toHaveLength(1);
    });
});

function text(id: string, citations: ChatCitation[]): ChatPart {
    return {type: 'text', id, text: 'Some text.', state: 'done', citations};
}
