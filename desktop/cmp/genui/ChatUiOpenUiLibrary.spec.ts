import {render} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {ChatModel} from '../../../core';
import {ChatUiCatalog} from '../../../genui';
import {openUiLangFormat, toOpenUiLibrary} from '../../../genui/openui';
import {chatUiBadgesSpec} from './ChatUiBadges';
import {chatUiCalloutSpec} from './ChatUiCallout';
import {chatUiDividerSpec} from './ChatUiDivider';
import {chatUiSectionSpec} from './ChatUiSection';
import {chatUiStackSpec} from './ChatUiStack';
import {chatUiTabsSpec} from './ChatUiTabs';
import {chatUiTextSpec} from './ChatUiText';
import {chatUiTreeMapSpec} from './ChatUiTreeMap';

/**
 * Every built-in spec is also an OpenUI component. Apps that take OpenUI Lang rely on the
 * signature a model reads for each one - children first, then props in schema order - and on a
 * program that reaches the Hoist components behind them.
 */
describe('built-in specs as an OpenUI library', () => {
    beforeAll(() => initTestAppAsync());

    const INTENT = '"none" | "primary" | "success" | "warning" | "danger"',
        FORMAT = '"number" | "percent" | "currency" | "none"',
        CHILDREN = '(Stack | Text | Tabs | Section | Callout | Badges | Divider | Treemap)[]';

    it('writes a signature per component, with a container taking its children first', () => {
        const {components} = toOpenUiLibrary(createCatalog(), {root: 'stack'});

        expect(components.Tabs.signature).toBe(`Tabs(children?: ${CHILDREN}, titles: string[])`);
        expect(components.Section.signature).toBe(
            `Section(children?: ${CHILDREN}, title?: string, intent?: ${INTENT}, ` +
                'collapsible?: boolean, collapsed?: boolean)'
        );
        expect(components.Callout.signature).toBe(
            `Callout(text: string, intent?: ${INTENT}, title?: string)`
        );
        expect(components.Badges.signature).toBe(
            `Badges(badges: {label: string; intent?: ${INTENT}}[])`
        );
        expect(components.Divider.signature).toBe('Divider()');
        expect(components.Treemap.signature).toBe(
            `Treemap(title?: string, format?: ${FORMAT}, decimals?: number, ` +
                `heatLabel?: string, heatFormat?: ${FORMAT}, ` +
                'nodes: {label: string; value: number; heat?: number}[])'
        );
    });

    it('tells the model how to write each prop, in the description of its component', () => {
        const {components} = toOpenUiLibrary(createCatalog(), {root: 'stack'});

        expect(components.Tabs.description).toContain('titles: Title of each tab, in the order');
        expect(components.Callout.description).toContain('intent: "primary" for a note');
        expect(components.Treemap.description).toContain('nodes[].heat: Color of the box');
    });

    it('renders a program of them with the Hoist components behind each', () => {
        // The app installs Highcharts. With none, Hoist's TreeMap logs an error.
        const error = vi.spyOn(console, 'error').mockImplementation(() => null);
        onTestFinished(() => error.mockRestore());

        const catalog = createCatalog(),
            [segment] = catalog.parseText(PROGRAM, {messageId: 'm1', partId: 'p1'});
        expect(segment).toMatchObject({type: 'document', isPartial: false});
        if (segment.type !== 'document') return;

        expect(segment.document.elements).toMatchObject({
            root: {component: 'stack', children: ['note', 'tags', 'rule', 'views']},
            note: {
                component: 'callout',
                props: {text: 'VaR is over its limit.', intent: 'warning', title: 'Limit breach'}
            },
            tags: {component: 'badges', props: {badges: [{label: 'Rates', intent: 'danger'}]}},
            rule: {component: 'divider', props: {}},
            views: {
                component: 'tabs',
                props: {titles: ['Exposure', 'Detail']},
                children: ['map', 'detail']
            },
            map: {component: 'treemap', props: {nodes: [{label: 'Rates', value: 42}]}},
            detail: {
                component: 'section',
                props: {title: 'By desk', collapsible: true},
                children: ['body']
            },
            body: {component: 'text', props: {text: 'Rates leads.'}}
        });
        expect(catalog.validateDocument(segment.document)).toEqual([]);

        const {container} = render(
            fragment({
                item: catalog.renderDocument(segment.document, {
                    chatModel: null as ChatModel,
                    messageId: 'm1',
                    part: {type: 'text', id: 'p1', text: PROGRAM, state: 'done'},
                    isPartial: false
                })
            })
        );
        expect(container.querySelector('.xh-chat-ui-fallback')).toBeNull();
        expect(container.querySelector('.xh-banner.xh-banner--warning')).toBeTruthy();
        expect(container.querySelector('.xh-badge.xh-bg-intent-danger').textContent).toBe('Rates');
        expect(container.querySelector('hr')).toBeTruthy();
        expect(container.querySelectorAll('.xh-tab-container [role="tab"]')).toHaveLength(2);
        expect(container.querySelector('.xh-chat-ui-treemap')).toBeTruthy();
    });
});

//------------------
// Helpers
//------------------
const PROGRAM = [
    'root = Stack([note, tags, rule, views])',
    'note = Callout("VaR is over its limit.", "warning", "Limit breach")',
    'tags = Badges([{label: "Rates", intent: "danger"}])',
    'rule = Divider()',
    'views = Tabs([map, detail], ["Exposure", "Detail"])',
    'map = Treemap(null, null, null, null, null, [{label: "Rates", value: 42}])',
    'detail = Section([body], "By desk", null, true)',
    'body = Text("Rates leads.")'
].join('\n');

function createCatalog(): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [
            chatUiStackSpec(),
            chatUiTextSpec(),
            chatUiTabsSpec(),
            chatUiSectionSpec(),
            chatUiCalloutSpec(),
            chatUiBadgesSpec(),
            chatUiDividerSpec(),
            chatUiTreeMapSpec()
        ],
        textFormats: [openUiLangFormat({root: 'stack'})],
        modes: ['openui']
    });
}
