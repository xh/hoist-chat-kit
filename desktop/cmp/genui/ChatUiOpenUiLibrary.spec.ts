import {render} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {ChatModel} from '../../../core';
import {ChatUiCatalog} from '../../../genui';
import {openUiLangFormat, toOpenUiLibrary} from '../../../genui/openui';
import {chatUiBadgesSpec} from './ChatUiBadges';
import {chatUiCalloutSpec} from './ChatUiCallout';
import {chatUiSeparatorSpec} from './ChatUiSeparator';
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
        CHILDREN = '(Stack | Text | Tabs | Section | Callout | Badges | Separator | Treemap)[]';

    it('writes a signature per component, with a container taking its children first', () => {
        const {components} = toOpenUiLibrary(createCatalog(), {root: 'stack'});

        expect(components.Tabs.signature).toBe(`Tabs(children?: ${CHILDREN}, titles: string[])`);
        expect(components.Section.signature).toBe(
            `Section(children?: ${CHILDREN}, title?: string, intent?: ${INTENT}, ` +
                'collapsible?: boolean, collapsed?: boolean)'
        );
        expect(components.Callout.signature).toBe(
            `Callout(intent?: ${INTENT}, title?: string, text: string)`
        );
        expect(components.Badges.signature).toBe(
            `Badges(badges: {label: string; intent?: ${INTENT}}[])`
        );
        expect(components.Separator.signature).toBe('Separator(label?: string)');
        expect(components.Treemap.signature).toBe(
            'Treemap(title?: string, nodes: {label: string; value: number; heat?: number}[], ' +
                `format?: ${FORMAT}, decimals?: number, heatLabel?: string, ` +
                `heatFormat?: ${FORMAT})`
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
            rule: {component: 'separator', props: {}},
            views: {
                component: 'tabs',
                props: {titles: ['Exposure', 'Detail']},
                children: ['map', 'detail']
            },
            map: {
                component: 'treemap',
                props: {title: 'Exposure', nodes: [{label: 'Rates', value: 42}]}
            },
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
                children: catalog.renderDocument(segment.document, {
                    chatModel: null as ChatModel,
                    messageId: 'm1',
                    part: {type: 'text', id: 'p1', text: PROGRAM, state: 'done'},
                    isPartial: false
                })
            })
        );
        expect(container.querySelector('.xh-chat-ui-fallback')).toBeNull();
        expect(container.querySelector('.xh-callout.xh-callout--intent-warning')).toBeTruthy();
        expect(container.querySelector('.xh-badge.xh-bg-intent-danger').textContent).toBe('Rates');
        expect(container.querySelector('.xh-separator.xh-chat-ui-separator')).toBeTruthy();
        expect(container.querySelectorAll('.xh-tab-container [role="tab"]')).toHaveLength(2);
        expect(container.querySelector('.xh-chat-ui-treemap')).toBeTruthy();
    });

    it('never shows a section open that the program then collapses', () => {
        const catalog = createCatalog(),
            head = [
                'root = Stack([sec])',
                'inner = Badges([{label: "Inside"}, {label: "More"}])',
                'sec = Section([inner], "Detail", "primary", true'
            ].join('\n'),
            renderProgram = (text: string, isStreaming: boolean) => {
                const [segment] = catalog.parseText(text, {
                    isStreaming,
                    messageId: 'm1',
                    partId: 'p1'
                });
                if (segment.type !== 'document') throw new Error(`Got a ${segment.type} segment`);
                return fragment({
                    children: catalog.renderDocument(segment.document, {
                        chatModel: null as ChatModel,
                        messageId: 'm1',
                        part: {type: 'text', id: 'p1', text, state: 'streaming'},
                        isPartial: segment.isPartial
                    })
                });
            },
            {container, rerender} = render(renderProgram(head, true));

        // The children are written, but `collapsed` is the last argument and still to come.
        expect(container.querySelector('legend').textContent).toBe('Detail');
        expect(container.querySelector('.xh-chat-ui-skeleton')).toBeTruthy();
        expect(container.querySelector('.xh-badge')).toBeNull();

        rerender(renderProgram(`${head}, true)`, false));
        expect(container.querySelector('.xh-card').className).toContain('xh-card--collapsed');
        expect(container.querySelector('.xh-badge')).toBeNull();
    });
});

//------------------
// Helpers
//------------------
const PROGRAM = [
    'root = Stack([note, tags, rule, views])',
    'note = Callout("warning", "Limit breach", "VaR is over its limit.")',
    'tags = Badges([{label: "Rates", intent: "danger"}])',
    'rule = Separator()',
    'views = Tabs([map, detail], ["Exposure", "Detail"])',
    'map = Treemap("Exposure", [{label: "Rates", value: 42}])',
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
            chatUiSeparatorSpec(),
            chatUiTreeMapSpec()
        ],
        textFormats: [openUiLangFormat({root: 'stack'})],
        modes: ['openui']
    });
}
