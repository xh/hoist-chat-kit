import {render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiProgressSpec, type ChatUiProgressSpecProps} from './ChatUiProgress';
import {chatUiStackSpec} from './ChatUiStack';

/**
 * The progress spec shows model-written values as Hoist ProgressBars. Apps rely on a bar per
 * complete value, on a figure in the format the model chose, and on a bar for any number the
 * model sends.
 */
describe('chatUiProgressSpec', () => {
    beforeAll(() => initTestAppAsync());

    const renderProgress = (props: ChatUiProgressSpecProps, isPartial = false) =>
            render(
                chatUiProgressSpec().render(props, {
                    isPartial
                } as ChatUiRenderContext) as ReactElement
            ),
        figures = (container: HTMLElement) =>
            [...container.querySelectorAll('.xh-progress-bar__value-label')].map(
                it => it.textContent
            ),
        widths = (container: HTMLElement) =>
            [...container.querySelectorAll<HTMLElement>('.xh-progress-bar__fill')].map(
                it => it.style.width
            );

    it('renders a Hoist ProgressBar per value, named by its label', () => {
        const {container} = renderProgress({
            bars: [
                {label: 'Storage', value: 72},
                {label: 'Seats', value: 3, max: 12, intent: 'danger', target: 9}
            ]
        });
        const seats = screen.getByRole('progressbar', {name: 'Seats'});

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
        const {container} = renderProgress({
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

    it('shows one share for percent, when the model writes a raw value and its maximum', () => {
        // From a live model run: percent with a raw value and max, which read as two huge percents.
        const {container} = renderProgress({
            bars: [{label: 'Used', value: 1971747900, max: 7915888800, format: 'percent'}]
        });

        expect(figures(container)).toEqual(['24.9%']);
        expect(parseFloat(widths(container)[0])).toBeCloseTo(24.9, 1);
    });

    it('draws a bar for a value outside its range, and for a maximum that is not above zero', () => {
        const {container} = renderProgress({
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

    it('leaves out a bar with no number, which Hoist would draw as work of unknown length', () => {
        const {container} = renderProgress({
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
        const {container, unmount} = renderProgress(
            {bars: [{label: 'Storage', value: 72}, {label: 'Bud'} as any]},
            true
        );
        expect(container.querySelectorAll('.xh-progress-bar')).toHaveLength(1);
        unmount();

        expect(
            renderProgress({bars: [{label: 'Storage', value: 7}]}, true).container.firstChild
        ).toBeNull();
    });

    it('renders the label as text, not as markup', () => {
        const {container} = renderProgress({bars: [{label: '<img src=x> **Storage**', value: 5}]});

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.xh-progress-bar__label').textContent).toBe(
            '<img src=x> **Storage**'
        );
    });

    it('shows only inside a document, bounds its list, and reads as its labels when copied', () => {
        const spec = chatUiProgressSpec({maxItems: 2}),
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), spec],
                modes: ['tools', 'document']
            }),
            bar = {label: 'A', value: 1};

        expect(spec.standalone).toBe(false);
        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
        expect(catalog.validate('progress', spec.example)).toEqual([]);
        expect(catalog.validate('progress', {bars: [bar, bar, bar]})).not.toEqual([]);
        expect(catalog.validate('progress', {bars: [{label: 'A'}]})).not.toEqual([]);
        expect(spec.result({bars: [bar, {label: 'B', value: 2}]})).toBe('A, B');
    });
});
