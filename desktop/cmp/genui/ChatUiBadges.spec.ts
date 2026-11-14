import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiBadgesSpec, type ChatUiBadgesSpecProps} from './ChatUiBadges';
import {chatUiStackSpec} from './ChatUiStack';

/**
 * The badges spec shows short model-written labels as Hoist Badges. Apps rely on a badge per
 * complete label, in the color of its intent, and on badges that show only inside a document.
 */
describe('chatUiBadgesSpec', () => {
    beforeAll(() => initTestAppAsync());

    const renderBadges = (props: ChatUiBadgesSpecProps, isPartial = false) =>
        render(
            chatUiBadgesSpec().render(props, {isPartial} as ChatUiRenderContext) as ReactElement
        );

    it('renders a Hoist Badge per label, in the color of its intent', () => {
        const {container} = renderBadges({
                badges: [{label: 'Tier 1', intent: 'success'}, {label: 'USD'}]
            }),
            badges = container.querySelectorAll('.xh-chat-ui-badges > .xh-badge');

        expect([...badges].map(it => it.textContent)).toEqual(['Tier 1', 'USD']);
        expect(badges[0].className).toContain('xh-bg-intent-success');
        expect(badges[1].className).not.toContain('xh-bg-intent');
    });

    it('shows only complete badges while the props stream, and nothing before the first', () => {
        const {container, unmount} = renderBadges(
            {badges: [{label: 'Tier 1'}, {label: 'Watchl'}]},
            true
        );
        expect(container.querySelectorAll('.xh-badge')).toHaveLength(1);
        unmount();

        expect(renderBadges({badges: [{label: 'Ti'}]}, true).container.firstChild).toBeNull();
    });

    it('shows only inside a document, bounds its list, and reads as its labels when copied', () => {
        const spec = chatUiBadgesSpec({maxItems: 2}),
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), spec],
                modes: ['tools', 'document']
            });

        expect(spec.standalone).toBe(false);
        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
        expect(catalog.validate('badges', {badges: [{label: 'A'}, {label: 'B'}]})).toEqual([]);
        expect(
            catalog.validate('badges', {badges: [{label: 'A'}, {label: 'B'}, {label: 'C'}]})
        ).not.toEqual([]);
        expect(catalog.validate('badges', {badges: [{label: 'A', intent: 'info'}]})).not.toEqual(
            []
        );
        expect(spec.result({badges: [{label: 'Tier 1'}, {label: 'USD'}]})).toBe('Tier 1, USD');
    });
});
