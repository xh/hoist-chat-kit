import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished} from 'vitest';
import {ChatModel} from '../../core';
import {ScriptedChatTransport, textEvents} from '../../transport';
import {
    chatUiButtonSpec,
    chatUiGridSpec,
    chatUiStackSpec,
    chatUiStatCardsSpec,
    chatUiTextSpec
} from '../../desktop/cmp/genui';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiDocument} from '../ChatUiDocument';

/**
 * A document renders as an answer blueprint, element by element. While it streams, a component
 * fills in from partial props, as a chat kit component always has, and its actions wait until it
 * is complete. An element known complete falls back at once.
 */
describe('documents as answer blueprints', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    beforeEach(() => {
        const was = ChatUiCatalog.answerBlueprints;
        ChatUiCatalog.answerBlueprints = true;
        onTestFinished(() => {
            ChatUiCatalog.answerBlueprints = was;
        });
    });

    const catalog = new ChatUiCatalog({
            components: [chatUiStackSpec(), chatUiTextSpec(), chatUiButtonSpec()],
            modes: ['document']
        }),
        render = (doc: ChatUiDocument, isPartial: boolean): string =>
            markup(
                catalog.renderDocument(doc, {
                    chatModel: createChatModel(),
                    messageId: 'm1',
                    part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
                    isPartial
                })
            ),
        // A button whose action is still arriving: a send with no text yet.
        withButton = (isPartial?: boolean): ChatUiDocument => ({
            root: 'top',
            elements: {
                top: {component: 'stack', props: {}, children: ['t', 'b']},
                t: {component: 'text', props: {text: 'Ready'}},
                b: {
                    component: 'button',
                    props: {label: 'Go', action: {type: 'send'}},
                    ...(isPartial == null ? {} : {isPartial})
                }
            }
        });

    it('renders stat cards over a source as the spec draws them', () => {
        const cards = new ChatUiCatalog({components: [chatUiStatCardsSpec()]}),
            doc = {
                root: 'kpis',
                elements: {kpis: {component: 'statCards', props: chatUiStatCardsSpec().example}}
            },
            draw = (answerBlueprints: boolean) => {
                ChatUiCatalog.answerBlueprints = answerBlueprints;
                return renderToStaticMarkup(
                    fragment({
                        children: cards.renderDocument(doc, {
                            chatModel: createChatModel(),
                            messageId: 'm1',
                            part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
                            isPartial: false
                        })
                    })
                );
            },
            text = (html: string) => html.replace(/<[^>]+>/g, '');

        const asSpec = draw(false),
            asAnswer = draw(true);
        expect(asAnswer).toContain('xh-chat-ui-stat-cards');
        expect(text(asSpec)).toContain('Revenue');
        expect(text(asSpec)).toContain('Open issues');
        expect(text(asAnswer)).toBe(text(asSpec));
    });

    it('renders an inline grid over a source as the spec draws it, complete or streaming', () => {
        const grids = new ChatUiCatalog({components: [chatUiGridSpec()]}),
            doc = {
                root: 'g',
                elements: {g: {component: 'grid', props: chatUiGridSpec().example}}
            },
            draw = (answerBlueprints: boolean, isPartial: boolean) => {
                ChatUiCatalog.answerBlueprints = answerBlueprints;
                return renderToStaticMarkup(
                    fragment({
                        children: grids.renderDocument(doc, {
                            chatModel: createChatModel(),
                            messageId: 'm1',
                            part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
                            isPartial
                        })
                    })
                );
            },
            text = (html: string) => html.replace(/<[^>]+>/g, '');

        [false, true].forEach(isPartial => {
            const asSpec = draw(false, isPartial),
                asAnswer = draw(true, isPartial);
            expect(asSpec).toContain('xh-chat-ui-grid');
            expect(text(asSpec).length).toBeGreaterThan(20);
            expect(text(asAnswer)).toBe(text(asSpec));
        });
    });

    it('renders a component from its partial props while it streams, with its action disabled', () => {
        const html = render(withButton(), true);
        expect(html).toContain('Ready');
        expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Go/s);
        expect(html).not.toContain('could not be displayed');
    });

    it('falls back at once for an arriving element that more input cannot make valid', () => {
        const doc = withButton();
        doc.elements.b.props.action = {type: 'openUrl'};
        const html = render(doc, true);
        expect(html).toContain('Ready');
        expect(html).toContain('could not be displayed');
    });

    it('checks every element in full once the answer is complete', () => {
        const html = render(withButton(), false);
        expect(html).toContain('Ready');
        expect(html).toContain('could not be displayed');
    });

    it('falls back at once for an element its format marks complete, while the rest stream', () => {
        const html = render(withButton(false), true);
        expect(html).toContain('Ready');
        expect(html).toContain('could not be displayed');
    });
});

function createChatModel(): ChatModel {
    const ret = new ChatModel({
        transport: new ScriptedChatTransport({responses: [textEvents('OK.')], delayMs: 0})
    });
    onTestFinished(() => ret.destroy());
    return ret;
}

function markup(content: ReactNode): string {
    return renderToStaticMarkup(fragment({children: content}));
}
