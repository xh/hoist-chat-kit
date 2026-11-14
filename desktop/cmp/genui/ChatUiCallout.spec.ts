import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {fragment} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {ChatModel} from '../../../core';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {ScriptedChatTransport} from '../../../transport';
import {chatUiCalloutSpec, type ChatUiCalloutSpecProps} from './ChatUiCallout';

/**
 * The callout spec shows a model-written message as Hoist's Banner. Apps rely on the banner's
 * intent tint and icon, on text that renders as chat markdown and so loads no image, and on a
 * message that reads as words when copied.
 */
describe('chatUiCalloutSpec', () => {
    beforeAll(() => initTestAppAsync());

    const renderCallout = (props: Partial<ChatUiCalloutSpecProps>, isPartial = false) =>
        renderInChat(
            fragment({
                item: chatUiCalloutSpec().render(
                    props as ChatUiCalloutSpecProps,
                    {isPartial} as ChatUiRenderContext
                )
            })
        );

    it('renders a Hoist Banner with the tint and icon of its intent, a title and the text', () => {
        const {container} = renderCallout({
                text: 'VaR is **12% over** its limit.',
                intent: 'warning',
                title: 'Limit breach'
            }),
            banner = container.querySelector('.xh-banner.xh-chat-ui-callout');

        expect(banner.className).toContain('xh-banner--warning');
        expect(banner.querySelector('.xh-banner__content > .xh-icon')).toBeTruthy();
        expect(banner.querySelector('.xh-chat-ui-callout__title').textContent).toBe('Limit breach');
        expect(banner.querySelector('.xh-banner__message strong').textContent).toBe('12% over');
    });

    it('is a note by default, and neutral with no icon for the intent none', () => {
        const note = renderCallout({text: 'Prices are as of the close.'});
        expect(note.container.querySelector('.xh-banner').className).toContain(
            'xh-banner--primary'
        );
        note.unmount();

        const {container} = renderCallout({text: 'Prices are as of the close.', intent: 'none'});
        expect(container.querySelector('.xh-banner').className).toContain('xh-banner--none');
        expect(container.querySelector('.xh-banner__content > .xh-icon')).toBeNull();
    });

    it('renders the text as chat markdown, which loads no image', () => {
        const {container} = renderCallout({text: 'See ![chart](https://example.com/leak.png)'});

        expect(container.querySelector('.xh-chat-markdown')).toBeTruthy();
        expect(container.querySelector('img')).toBeNull();
    });

    it('shows a placeholder until its title or text begins, then its intent at once', () => {
        const waiting = renderCallout({intent: 'danger'}, true);
        expect(waiting.container.querySelector('.xh-chat-ui-skeleton')).toBeTruthy();
        expect(waiting.container.querySelector('.xh-banner')).toBeNull();
        waiting.unmount();

        // The intent and the title arrive before the text, so a warning shows as one at once.
        const early = renderCallout({intent: 'danger', title: 'Limit br'}, true);
        expect(early.container.querySelector('.xh-banner').className).toContain(
            'xh-banner--danger'
        );
        early.unmount();

        // An intent cut short as it streams falls back to a note.
        const {container} = renderCallout({text: 'Desk limit', intent: 'warn' as any}, true);
        expect(container.querySelector('.xh-banner').className).toContain('xh-banner--primary');
        expect(container.querySelector('.xh-chat-markdown--streaming')).toBeTruthy();
    });

    it('has a tool of its own, bounds its text, and reads as its title and text when copied', () => {
        const spec = chatUiCalloutSpec({maxLength: 20}),
            catalog = new ChatUiCatalog({components: [spec]});

        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_callout']);
        expect(catalog.validate('callout', {text: 'Short note.'})).toEqual([]);
        expect(catalog.validate('callout', {text: 'A note that runs well past it.'})).not.toEqual(
            []
        );
        expect(catalog.validate('callout', {text: 'Hi', intent: 'info'})).not.toEqual([]);
        expect(catalog.validate('callout', {title: 'No text'})).not.toEqual([]);
        expect(catalog.validate('callout', {text: ''})).not.toEqual([]);
        // A model writes props in schema order, and OpenUI Lang takes them by position.
        expect(Object.keys(spec.props.properties)).toEqual(['intent', 'title', 'text']);
        expect(spec.result({text: 'Over limit.', title: 'Breach'})).toBe('Breach: Over limit.');
        expect(spec.result({text: 'Over limit.'})).toBe('Over limit.');
    });
});

//------------------
// Helpers
//------------------
// The text's markdown looks up the models of the chat that shows it.
const chatHost = hoistCmp.factory<HoistProps<ChatModel>>({
    displayName: 'ChatHost',
    model: uses(ChatModel),
    render: ({children}) => fragment({items: children})
});

function renderInChat(content: ReactElement) {
    const model = new ChatModel({transport: new ScriptedChatTransport()});
    onTestFinished(() => model.destroy());
    return render(chatHost({model, item: content}));
}
