import {render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiProgressBarsSpec, type ChatUiProgressBarsSpecProps} from './ChatUiProgressBars';
import {chatUiStackSpec} from './ChatUiStack';

/**
 * The progress bars spec shows model-written values as Hoist ProgressBars. Apps rely on a bar per
 * complete value, on a figure in the format the model chose, and on a bar for any number the
 * model sends.
 */
describe('chatUiProgressBarsSpec', () => {
    beforeAll(() => initTestAppAsync());

    const renderProgressBars = (props: ChatUiProgressBarsSpecProps, isPartial = false) =>
            render(
                chatUiProgressBarsSpec().render(props, {
                    isPartial
                } as ChatUiRenderContext) as ReactElement
            ),
        figures = (container: HTMLElement) =>
            [...container.querySelectorAll('.xh-progress-bar__value')].map(it => it.textContent),
        widths = (container: HTMLElement) =>
            [...container.querySelectorAll<HTMLElement>('.xh-progress-bar__fill')].map(
                it => it.style.width
            );

    it('renders a Hoist ProgressBar per value, named by its label', () => {
        const {container} = renderProgressBars({
            bars: [
                {label: 'Storage', value: 72},
                {label: 'Seats', value: 3, max: 12, intent: 'danger', target: 9}
            ]
        });
        const seats = screen.getByRole('progressbar', {name: 'Seats'});

        expect(container.querySelector('.xh-chat-ui-progress-bars')).toBeTruthy();
        expect(screen.getByRole('progressbar', {name: 'Storage'})).toBeTruthy();
        expect(widths(container)).toEqual(['72%', '25%']);
        expect(seats.className).toContain('xh-progress-bar--intent-danger');
        expect(
            seats
                .querySelector<HTMLElement>('.xh-progress-bar__target')
                .style.getPropertyValue('--xh-progress-bar-target-fraction')
        ).toBe('0.75');
    });

    it('shows a whole percent of the maximum, or the value and the maximum in a format', () => {
        const {container} = renderProgressBars({
            bars: [
                {label: 'Storage', value: 72},
                {label: 'Budget', value: 7200, max: 10000, format: 'currency'},
                {label: 'Rows', value: 1500000, max: 4000000, format: 'number'},
                {label: 'Share', value: 0.425, format: 'percent'},
                {label: 'Goal', value: 0.2, max: 0.5, format: 'percent'}
            ]
        });

        expect(figures(container)).toEqual([
            '72%',
            '$7,200 of $10,000',
            '1.5M of 4M',
            '42.5%',
            '40%'
        ]);
        expect(widths(container)).toEqual(['72%', '72%', '37.5%', '42.5%', '40%']);
    });

    it('gives each bar its figure as its value text, for screen readers', () => {
        renderProgressBars({
            bars: [{label: 'Budget', value: 7200, max: 10000, format: 'currency'}]
        });

        expect(
            screen.getByRole('progressbar', {name: 'Budget'}).getAttribute('aria-valuetext')
        ).toBe('$7,200 of $10,000');
    });

    it('shows one share for percent, when the model writes a raw value and its maximum', () => {
        // From a live model run: percent with a raw value and max, which read as two huge percents.
        const {container} = renderProgressBars({
            bars: [{label: 'Used', value: 1971747900, max: 7915888800, format: 'percent'}]
        });

        expect(figures(container)).toEqual(['24.9%']);
        expect(parseFloat(widths(container)[0])).toBeCloseTo(24.9, 1);
    });

    it('draws a bar for a value outside its range, and for a maximum that is not above zero', () => {
        const {container} = renderProgressBars({
            bars: [
                {label: 'Over', value: 250},
                {label: 'Under', value: -5},
                {label: 'No maximum', value: 40, max: 0},
                {label: 'Odd format', value: 40, format: 'bytes' as any, intent: 'info' as any}
            ]
        });

        expect(widths(container)).toEqual(['100%', '0%', '40%', '40%']);
        expect(figures(container)).toEqual(['100%', '0%', '40%', '40%']);
        expect(container.querySelector('[class*="--intent-"]')).toBeNull();
    });

    it('leaves out a bar with no number, which Hoist would draw empty', () => {
        const {container} = renderProgressBars({
            bars: [
                {label: 'Storage', value: 72},
                {label: 'Pending', value: null},
                {label: 'Text', value: 'most' as any},
                {label: '', value: 5}
            ]
        });

        expect(container.querySelectorAll('.xh-progress-bar')).toHaveLength(1);
        expect(container.querySelector('.xh-progress-bar--indeterminate')).toBeNull();
    });

    it('shows only complete bars while the props stream, and nothing before the first', () => {
        const {container, unmount} = renderProgressBars(
            {bars: [{label: 'Storage', value: 72}, {label: 'Bud'} as any]},
            true
        );
        expect(container.querySelectorAll('.xh-progress-bar')).toHaveLength(1);
        unmount();

        expect(
            renderProgressBars({bars: [{label: 'Storage', value: 7}]}, true).container.firstChild
        ).toBeNull();
    });

    it('renders the label as text, not as markup', () => {
        const {container} = renderProgressBars({
            bars: [{label: '<img src=x> **Storage**', value: 5}]
        });

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.xh-progress-bar__label').textContent).toBe(
            '<img src=x> **Storage**'
        );
    });

    it('shows only inside a document, shows a count past its most items, and reads as its labels when copied', () => {
        const spec = chatUiProgressBarsSpec({maxItems: 2}),
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), spec],
                modes: ['tools', 'document']
            }),
            bar = {label: 'A', value: 1};

        expect(spec.standalone).toBe(false);
        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
        expect(catalog.validate('progressBars', spec.example)).toEqual([]);
        // More than the most shows the first ones and a count, rather than fail.
        expect(catalog.validate('progressBars', {bars: [bar, bar, bar]})).toEqual([]);
        const {container} = render(
            spec.render(
                {bars: [bar, bar, bar]} as any,
                {isPartial: false} as ChatUiRenderContext
            ) as ReactElement
        );
        expect(container.querySelector('.xh-chat-ui-more__note').textContent).toBe(
            '1 more not shown'
        );
        expect(spec.props.properties.bars.description).toBe('At most 2.');
        expect(catalog.validate('progressBars', {bars: [{label: 'A'}]})).not.toEqual([]);
        expect(spec.result({bars: [bar, {label: 'B', value: 2}]})).toBe('A, B');
    });
});
