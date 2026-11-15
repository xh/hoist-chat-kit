import {render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiStackSpec} from './ChatUiStack';
import {chatUiStepsSpec, type ChatUiStepsSpecProps} from './ChatUiSteps';

/**
 * The steps spec shows a model-written sequence as Hoist Steps. Apps rely on a step per complete
 * title, on the status that the model set or that `current` gives, and on steps that take no
 * click.
 */
describe('chatUiStepsSpec', () => {
    beforeAll(() => initTestAppAsync());

    const renderSteps = (props: ChatUiStepsSpecProps, isPartial = false) =>
            render(
                chatUiStepsSpec().render(props, {isPartial} as ChatUiRenderContext) as ReactElement
            ),
        statuses = () =>
            screen
                .getAllByRole('listitem')
                .map(it => /xh-steps__step--(\w+)/.exec(it.className)?.[1]);

    it('renders a step per title, with the status that current gives it', () => {
        const {container} = renderSteps({
            steps: [
                {title: 'Ordered', detail: 'May 2'},
                {title: 'Shipped', description: 'Left the warehouse.'},
                {title: 'Delivered'}
            ],
            current: 1
        });
        const titles = [...container.querySelectorAll('.xh-steps__title')];

        expect(titles.map(it => it.textContent)).toEqual(['Ordered', 'Shipped', 'Delivered']);
        expect(statuses()).toEqual(['complete', 'current', 'pending']);
        expect(container.querySelector('.xh-steps__detail').textContent).toBe('May 2');
        expect(container.querySelector('.xh-steps__description').textContent).toBe(
            'Left the warehouse.'
        );
        expect(container.querySelector('.xh-chat-ui-steps').className).toContain(
            'xh-steps--horizontal'
        );
    });

    it("lets a step's own status win, and draws a vertical list", () => {
        const {container} = renderSteps({
            steps: [
                {title: 'Build', status: 'complete'},
                {title: 'Test', status: 'error'},
                {title: 'Deploy'}
            ],
            current: 2,
            orientation: 'vertical'
        });

        expect(statuses()).toEqual(['complete', 'error', 'current']);
        expect(container.querySelector('.xh-steps--vertical')).toBeTruthy();
    });

    it('falls back for a status, a current step or an orientation it does not know', () => {
        const {container} = renderSteps({
            steps: [{title: 'Build', status: 'done' as any}, {title: 'Test'}],
            current: -2,
            orientation: 'diagonal' as any
        });

        expect(statuses()).toEqual(['pending', 'pending']);
        expect(container.querySelector('.xh-steps--horizontal')).toBeTruthy();
    });

    it('leaves out a step with no title, and renders nothing with no step', () => {
        renderSteps({steps: [{title: 'Build'}, {title: ''}, null, 'Test' as any]});
        expect(screen.getAllByRole('listitem')).toHaveLength(1);

        expect(renderSteps({steps: [{title: ''}]}).container.firstChild).toBeNull();
        expect(renderSteps({steps: null}).container.firstChild).toBeNull();
    });

    it('shows only complete steps while the props stream', () => {
        renderSteps({steps: [{title: 'Build'}, {title: 'Te'}], current: 0}, true);

        expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });

    it('renders text as text, and gives a step no click', () => {
        const {container} = renderSteps({
            steps: [{title: '<b>Build</b>', description: '[link](http://example.com)'}]
        });

        expect(container.querySelector('b, a')).toBeNull();
        expect(container.querySelector('.xh-steps__title').textContent).toBe('<b>Build</b>');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows only inside a document, shows a count past its most items, and reads as its titles when copied', () => {
        const spec = chatUiStepsSpec({maxItems: 2}),
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), spec],
                modes: ['tools', 'document']
            }),
            step = {title: 'A'};

        expect(spec.standalone).toBe(false);
        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
        expect(catalog.validate('steps', {steps: [step, step], current: 1})).toEqual([]);
        // More than the most shows the first ones and a count, rather than fail.
        expect(catalog.validate('steps', {steps: [step, step, step]})).toEqual([]);
        const {container} = render(
            spec.render(
                {steps: [step, step, step]} as any,
                {isPartial: false} as ChatUiRenderContext
            ) as ReactElement
        );
        expect(container.querySelector('.xh-chat-ui-more__note').textContent).toBe(
            '1 more not shown'
        );
        expect(spec.props.properties.steps.description).toBe('At most 2.');
        expect(catalog.validate('steps', {steps: [{title: 'A', icon: 'check'}]})).not.toEqual([]);
        expect(catalog.validate('steps', {steps: [step], current: 0.5})).not.toEqual([]);
        expect(spec.result({steps: [step, {title: 'B'}]})).toBe('A, B');
    });
});
