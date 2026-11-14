import {
    createStore,
    createStreamingParser,
    evaluateElementProps,
    isReactiveAssign,
    markReactive,
    resolveStateField,
    split,
    tokenize,
    type ElementNode,
    type EvaluationContext,
    type Library
} from '@openuidev/lang-core';
import {uniq} from 'lodash';
import {describe, expect, it} from 'vitest';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import {toOpenUiLibrary} from './OpenUiLibrary';

/**
 * The kit reads a few things from lang-core that its types do not promise: the token types of
 * its tokenizer, the offsets of a statement, the shape its evaluator reads to find a two-way
 * binding, and what it makes of an object cut short. The peer range holds lang-core to one minor
 * version. These specs fail when a new version changes one of them.
 */
describe('lang-core, as the kit relies on it', () => {
    it('gives the brackets, the colon and the question mark a token type each', () => {
        const types = tokenize('( ) [ ] { } : ?')
            .slice(0, 8)
            .map(it => it.t);

        expect(uniq(types)).toHaveLength(8);
    });

    it('gives a statement the tokens after its name, and the offset of the newline that closes it', () => {
        const text = 'a = Text("x")\nb = Te',
            [first, second] = split(tokenize(text));

        expect(first).toMatchObject({id: 'a', end: 13});
        expect(second).toMatchObject({id: 'b', end: text.length});
        // The last token of a call is its closing parenthesis.
        expect(first.tokens.at(-1).t).toBe(tokenize(')')[0].t);
    });

    it('marks a prop as a two-way binding by the shape of its library', () => {
        const marker = {};
        markReactive(marker);
        const store = createStore(),
            ctx: EvaluationContext = {getState: name => store.get(name), resolveRef: () => null},
            library = {
                components: {Field: {props: {shape: {value: marker}}}}
            } as unknown as Library,
            element: ElementNode = {
                type: 'element',
                typeName: 'Field',
                props: {label: {k: 'StateRef', n: '$name'}, value: {k: 'StateRef', n: '$name'}},
                partial: false,
                hasDynamicProps: true
            };
        store.set('$name', 'Ann');

        const {props} = evaluateElementProps(element, {ctx, library, store});
        expect(props.label).toBe('Ann');
        expect(isReactiveAssign(props.value)).toBe(true);
        expect(props.value).toMatchObject({target: '$name'});

        const field = resolveStateField(
            'value',
            props.value,
            store,
            ctx,
            () => null,
            () => null
        );
        expect(field.value).toBe('Ann');
        field.setValue('Bob');
        expect(store.get('$name')).toBe('Bob');
    });

    it('closes an object cut short with a ? key for the pair still to come', () => {
        const list: ChatUiComponentSpec = {
                name: 'list',
                description: 'A list.',
                props: {
                    type: 'object',
                    properties: {items: {type: 'array', items: {type: 'object'}}}
                },
                slots: ['default'],
                render: () => null
            },
            library = toOpenUiLibrary(new ChatUiCatalog({components: [list]}), {root: 'list'}),
            {root} = createStreamingParser(library.schema, library.root).set(
                'root = List([], [{label: "A", val',
                false
            );

        expect(Object.keys((root.props.items as object[])[0])).toContain('?');
    });
});
