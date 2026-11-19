import {describe, expect, it} from 'vitest';
import {DataCatalog, degradeAnswer} from '../../blueprint';
import {
    chatUiBadgesSpec,
    chatUiCalloutSpec,
    chatUiCardSpec,
    chatUiInputSpecs,
    chatUiSectionSpec,
    chatUiSeparatorSpec,
    chatUiStackSpec,
    chatUiTabsSpec,
    chatUiTextSpec,
    chatUiTreeMapSpec
} from '../../desktop/cmp/genui';
import {ChatUiCatalog} from '../ChatUiCatalog';
import {toAnswerBlueprint} from './answerBlueprint';

/**
 * A document becomes an answer blueprint over the catalog's registry, where each catalog
 * component is a widget, so every answer renders and checks as a blueprint.
 */
describe('toAnswerBlueprint', () => {
    const components = [
            chatUiBadgesSpec(),
            chatUiCalloutSpec(),
            chatUiCardSpec(),
            chatUiSectionSpec(),
            chatUiSeparatorSpec(),
            chatUiStackSpec(),
            chatUiTabsSpec(),
            chatUiTextSpec(),
            chatUiTreeMapSpec(),
            ...chatUiInputSpecs()
        ],
        catalog = new ChatUiCatalog({components, modes: ['tools', 'document']}),
        ctx = {
            catalog: new DataCatalog({datasets: {}}),
            registry: catalog.registry,
            isAnswer: true,
            isComplete: true
        };

    it('registers each component as a widget, with its schema, category and size', () => {
        const {widgets} = catalog.registry;
        expect(widgets.textInput).toMatchObject({
            category: 'input',
            value: {type: 'string'},
            config: chatUiInputSpecs().find(it => it.name === 'textInput').props
        });
        expect(widgets.stack).toMatchObject({category: 'container', children: {}});
        expect(widgets.text.size.default).toEqual({w: 12, h: 2});
        expect(widgets.chart.label).toBe('Chart');
        expect(widgets.chart.config).not.toBe(undefined);
    });

    it("registers chat kit's action types, in place of the built-ins of the same name", () => {
        const {actions} = catalog.registry;
        expect(actions.send.describe({text: 'Hi'})).toBe('Sends: "Hi"');
        expect(actions.openUrl.params.properties).toHaveProperty('label');
        expect(actions.setVariable).toBeTruthy();
    });

    it.each(components.filter(it => it.example).map(it => [it.name, it]))(
        "translates the example of '%s' into a valid answer",
        (name, spec) => {
            const bp = toAnswerBlueprint({
                root: 'root',
                elements: {root: {component: name as string, props: spec.example}}
            });
            expect(bp.elements.root).toEqual({component: name, config: spec.example});
            expect(degradeAnswer(bp, ctx)).toEqual(bp);
        }
    );

    it('turns children and named slots into child references', () => {
        const bp = toAnswerBlueprint({
            root: 'top',
            elements: {
                top: {component: 'stack', props: {}, children: ['a'], slots: {default: ['b']}},
                a: {component: 'text', props: {text: 'First'}},
                b: {component: 'text', props: {text: 'Second'}}
            }
        });
        expect(bp.elements.top.children).toEqual([{id: 'a'}, {id: 'b'}]);
        expect(degradeAnswer(bp, ctx)).toEqual(bp);
    });

    it('leaves an element with problems for degradeAnswer to replace', () => {
        const bp = toAnswerBlueprint({
            root: 'top',
            elements: {
                top: {component: 'stack', props: {}, children: ['a', 'b']},
                a: {component: 'text', props: {text: 5}},
                b: {component: 'nope', props: {}}
            }
        } as any);
        const ret = degradeAnswer(bp, ctx);
        expect(ret.elements.top).toEqual(bp.elements.top);
        expect(ret.elements.a.component).toBe('fallback');
        expect(ret.elements.b.component).toBe('fallback');
    });
});
