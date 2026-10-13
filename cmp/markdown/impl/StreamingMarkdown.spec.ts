import {describe, expect, it} from 'vitest';
import {closeMarkdownSyntax, splitMarkdownBlocks} from './StreamingMarkdown';

describe('splitMarkdownBlocks', () => {
    it('returns no blocks for empty text', () => {
        expect(splitMarkdownBlocks('')).toEqual([]);
        expect(splitMarkdownBlocks(null)).toEqual([]);
    });

    it('splits paragraphs and headings at blank lines', () => {
        expect(splitMarkdownBlocks('# Title\n\nFirst para\nstill first\n\n\nSecond')).toEqual([
            '# Title',
            'First para\nstill first',
            'Second'
        ]);
    });

    it('keeps blank lines inside a code fence in one block', () => {
        const fenced = '```js\nconst a = 1;\n\nconst b = 2;\n```';
        expect(splitMarkdownBlocks(`Intro\n\n${fenced}\n\nOutro`)).toEqual([
            'Intro',
            fenced,
            'Outro'
        ]);
    });

    it('keeps an unclosed code fence and everything after it in the last block', () => {
        expect(splitMarkdownBlocks('Intro\n\n~~~\ncode\n\nmore code')).toEqual([
            'Intro',
            '~~~\ncode\n\nmore code'
        ]);
    });

    it('does not close a backtick fence with a tilde fence or a shorter fence', () => {
        expect(splitMarkdownBlocks('````\n~~~\n```\n\nstill code\n````\n\nafter')).toEqual([
            '````\n~~~\n```\n\nstill code\n````',
            'after'
        ]);
    });

    it('merges indented continuations into the previous block', () => {
        expect(splitMarkdownBlocks('- item\n\n  more about item\n\nNext')).toEqual([
            '- item\n\n  more about item',
            'Next'
        ]);
    });

    it('merges the items of a loose list into one block', () => {
        expect(splitMarkdownBlocks('1. one\n\n2. two\n\n3. three\n\nAfter')).toEqual([
            '1. one\n\n2. two\n\n3. three',
            'After'
        ]);
    });
});

describe('closeMarkdownSyntax', () => {
    it('leaves complete text unchanged', () => {
        const text = 'Some **bold**, *italic*, `code` and [a link](https://xh.io).';
        expect(closeMarkdownSyntax(text)).toBe(text);
    });

    it('closes an open code fence with its own marker', () => {
        expect(closeMarkdownSyntax('```ts\nconst a = 1;')).toBe('```ts\nconst a = 1;\n```');
        expect(closeMarkdownSyntax('~~~~\ncode\n')).toBe('~~~~\ncode\n~~~~');
    });

    it('closes open emphasis, strikethrough and inline code', () => {
        expect(closeMarkdownSyntax('This is **bold')).toBe('This is **bold**');
        expect(closeMarkdownSyntax('This is *italic ')).toBe('This is *italic*');
        expect(closeMarkdownSyntax('This is ~~gone')).toBe('This is ~~gone~~');
        expect(closeMarkdownSyntax('Run `npm i')).toBe('Run `npm i`');
    });

    it('closes nested markers innermost first', () => {
        expect(closeMarkdownSyntax('**bold and *italic')).toBe('**bold and *italic***');
        expect(closeMarkdownSyntax('**bold `code')).toBe('**bold `code`**');
    });

    it('removes an opening marker with nothing after it', () => {
        expect(closeMarkdownSyntax('Next is **')).toBe('Next is ');
        expect(closeMarkdownSyntax('Run `')).toBe('Run ');
    });

    it('ignores markers inside inline code, escaped markers, and list bullets', () => {
        expect(closeMarkdownSyntax('Use `a * b` here')).toBe('Use `a * b` here');
        expect(closeMarkdownSyntax('Price \\*not italic')).toBe('Price \\*not italic');
        expect(closeMarkdownSyntax('* one\n* two')).toBe('* one\n* two');
        expect(closeMarkdownSyntax('2 * 3 = 6')).toBe('2 * 3 = 6');
    });

    it('closes a link whose URL is still streaming', () => {
        expect(closeMarkdownSyntax('See [the docs](https://xh.io/do')).toBe(
            'See [the docs](https://xh.io/do)'
        );
    });

    it('leaves partial link text as literal text', () => {
        expect(closeMarkdownSyntax('See [the do')).toBe('See [the do');
    });

    it('drops a partial image', () => {
        expect(closeMarkdownSyntax('Chart: ![sales](https://x')).toBe('Chart: ');
        expect(closeMarkdownSyntax('Chart: ![sal')).toBe('Chart: ');
    });

    it('closes only the prose after a completed code fence', () => {
        expect(closeMarkdownSyntax('```\na **b\n```\nThen **bold')).toBe(
            '```\na **b\n```\nThen **bold**'
        );
    });
});
