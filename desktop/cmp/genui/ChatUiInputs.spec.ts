import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {HoistBase, hoistCmp, type HoistProps, type PlainObject, uses} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactNode} from 'react';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel} from '../../../core';
import {
    ChatUiCatalog,
    type ChatUiDocument,
    type ChatUiDocumentContext,
    type ChatUiElement,
    type ChatUiState,
    type ChatUiStateAction
} from '../../../genui';
import {openUiLangFormat, toOpenUiLibrary} from '../../../genui/openui';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {chatMessageList} from '../chat/ChatMessageList';
import {chatUiInputSpecs} from './ChatUiInput';
import {chatUiStackSpec} from './ChatUiStack';
import {chatUiTextSpec} from './ChatUiText';

/**
 * The built-in form components put Hoist's inputs, `FormField` and `Button` to work in generative
 * UI. Apps rely on each input to hold a state prop that a document can bind, to run the model's
 * rules as Hoist validation, and on a form's button to check the fields and send their values
 * exactly as its tooltip shows them.
 */
describe('built-in form components', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver or element scrolling.
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        Element.prototype.scrollTo ??= () => {};
        Element.prototype.scrollIntoView ??= () => {};
    });

    describe('specs', () => {
        it('show only inside a nested answer, with no tool of their own', () => {
            const catalog = createCatalog();

            expect(catalog.tools.map(it => it.name)).toEqual([]);
            expect(chatUiInputSpecs().map(it => it.name)).toEqual([
                'form',
                'button',
                'textInput',
                'textArea',
                'numberInput',
                'select',
                'dateInput',
                'checkbox',
                'switch',
                'segmentedControl',
                'radioGroup',
                'slider'
            ]);
        });

        it('take a $variable as the last argument of each input, in an OpenUI library', () => {
            const {components} = toOpenUiLibrary(createCatalog(), {root: 'stack', bindings: true}),
                signature = (name: string) => components[name].signature;

            expect(signature('TextInput')).toBe(
                'TextInput(name: string, label?: string, placeholder?: string, ' +
                    'rules?: {required?: boolean; email?: boolean; minLength?: number; ' +
                    'maxLength?: number}, value?: $binding<string>)'
            );
            expect(signature('Select')).toMatch(
                /^Select\(name: string, options: .*, value\?: \$binding<string \| number \| \(string \| number\)\[\]>\)$/
            );
            expect(signature('Checkbox')).toBe(
                'Checkbox(name: string, label?: string, value?: $binding<boolean>)'
            );
            expect(signature('DateInput')).toMatch(/value\?: \$binding<string>\)$/);
            expect(signature('RadioGroup')).toBe(
                'RadioGroup(name: string, options: (string | number | ' +
                    '{value: string | number; label?: string})[], label?: string, ' +
                    'rules?: {required?: boolean}, value?: $binding<string | number>)'
            );
            expect(signature('Slider')).toBe(
                'Slider(name: string, min: number, max: number, label?: string, step?: number, ' +
                    'format?: "number" | "percent" | "currency" | "none", range?: boolean, ' +
                    'value?: $binding<number | number[]>)'
            );
            expect(signature('Button')).toBe(
                'Button(label: string, action?: @ToAssistant | @Set | @Reset, ' +
                    'intent?: "primary" | "success" | "warning" | "danger")'
            );
        });

        it('give each example props that pass the schema', () => {
            const catalog = createCatalog();

            chatUiInputSpecs().forEach(({name, example}) =>
                expect(catalog.validate(name, example), name).toEqual([])
            );
        });
    });

    describe('inputs', () => {
        it('writes committed text to the state, and shows a value the state sets', () => {
            const {values, container} = renderBound({
                top: {component: 'textInput', props: {name: 'email', label: 'Email'}}
            });
            const input = container.querySelector<HTMLInputElement>('.xh-text-input input');
            expect(screen.getByText('Email')).toBeTruthy();

            typeInto(input, 'ann@example.com');
            expect(values.get('top')).toBe('ann@example.com');

            act(() => values.set('top', 'bob@example.com'));
            expect(input.value).toBe('bob@example.com');
        });

        it('keeps the value of an input with no binding, for a form to send', async () => {
            const chatModel = createChatModel(),
                {container} = renderDocument(
                    {
                        root: 'form',
                        elements: {
                            form: {component: 'form', props: {}, children: ['name', 'go']},
                            name: {component: 'textInput', props: {name: 'name', value: 'Ann'}},
                            go: {component: 'button', props: {label: 'Submit'}}
                        }
                    },
                    chatModel
                );

            typeInto(container.querySelector('.xh-text-input input'), 'Bob');
            await clickAsync(screen.getByRole('button', {name: 'Submit'}));

            expect(chatModel.messages[0].metadata.context).toEqual({name: 'Bob'});
        });

        it('stops typed text at the most a message carries, or at a shorter maxLength rule', () => {
            const {container} = renderBound({
                top: {component: 'stack', props: {}, children: ['name', 'code', 'note']},
                name: {component: 'textInput', props: {name: 'name'}},
                code: {component: 'textInput', props: {name: 'code', rules: {maxLength: 8}}},
                note: {component: 'textArea', props: {name: 'note', rules: {maxLength: 40}}}
            });
            const [name, code] =
                container.querySelectorAll<HTMLInputElement>('.xh-text-input input');

            expect(name.maxLength).toBe(100);
            expect(code.maxLength).toBe(8);
            expect(container.querySelector('textarea').maxLength).toBe(40);
        });

        it('holds a number, a boolean and a date as plain JSON values', () => {
            const {values, container} = renderBound({
                top: {component: 'stack', props: {}, children: ['qty', 'ok', 'live', 'start']},
                qty: {component: 'numberInput', props: {name: 'qty'}},
                ok: {component: 'checkbox', props: {name: 'ok', label: 'OK'}},
                live: {component: 'switch', props: {name: 'live', label: 'Live'}},
                start: {component: 'dateInput', props: {name: 'start'}}
            });

            typeInto(container.querySelector('.xh-number-input input'), '1,250');
            fireEvent.click(container.querySelector('.xh-check-box input'));
            fireEvent.click(container.querySelector('.xh-switch-input input'));
            typeInto(container.querySelector('.xh-date-input input'), '2026-05-06');

            expect(values.get('qty')).toBe(1250);
            expect(values.get('ok')).toBe(true);
            expect(values.get('live')).toBe(true);
            expect(values.get('start')).toBe('2026-05-06');

            fireEvent.click(container.querySelector('.xh-check-box input'));
            expect(values.get('ok')).toBe(false);
        });

        it('shows only values of the right type, whatever the state holds', () => {
            const {container} = renderBound(
                {
                    top: {component: 'stack', props: {}, children: ['qty', 'ok', 'start', 'name']},
                    qty: {component: 'numberInput', props: {name: 'qty'}},
                    ok: {component: 'checkbox', props: {name: 'ok', label: 'OK'}},
                    start: {component: 'dateInput', props: {name: 'start'}},
                    name: {component: 'textInput', props: {name: 'name'}}
                },
                {qty: 'many', ok: 'yes', start: '2026-13-45', name: 12}
            );
            const value = (selector: string) =>
                container.querySelector<HTMLInputElement>(selector).value;

            expect(value('.xh-number-input input')).toBe('');
            expect(container.querySelector<HTMLInputElement>('.xh-check-box input').checked).toBe(
                false
            );
            expect(value('.xh-date-input input')).toBe('');
            expect(value('.xh-text-input:not(.xh-date-input) input')).toBe('12');
        });

        it('selects one choice, or a list of them with multi', () => {
            const options = ['emea', {value: 'apac', label: 'APAC'}, {value: 'amer'}],
                {values, container} = renderBound(
                    {
                        top: {component: 'stack', props: {}, children: ['one', 'many']},
                        one: {component: 'select', props: {name: 'one', options}},
                        many: {component: 'select', props: {name: 'many', options, multi: true}}
                    },
                    {one: 'emea'}
                );
            const [one, many] = container.querySelectorAll<HTMLElement>('.xh-select');
            expect(one.textContent).toContain('emea');

            choose(one, 'APAC');
            expect(values.get('one')).toBe('apac');

            choose(many, 'emea');
            choose(many, 'amer');
            expect(values.get('many')).toEqual(['emea', 'amer']);
        });

        it('picks a segment of a segmented control', () => {
            const {values} = renderBound(
                {
                    top: {
                        component: 'segmentedControl',
                        props: {
                            name: 'period',
                            label: 'Period',
                            options: [{value: 'day', label: 'Day'}, 'week']
                        }
                    }
                },
                {top: 'day'}
            );
            expect(screen.getByRole('radio', {name: 'Day'}).getAttribute('aria-checked')).toBe(
                'true'
            );
            // Options that do not fit on one row wrap, so a narrow chat cuts none off.
            expect(document.querySelector('.xh-segmented-control--wrap')).toBeTruthy();

            fireEvent.click(screen.getByRole('radio', {name: 'week'}));
            expect(values.get('top')).toBe('week');
        });

        it('picks a choice of a radio group, and keeps the type of its value', () => {
            const {values} = renderBound(
                {
                    top: {
                        component: 'radioGroup',
                        props: {
                            name: 'term',
                            label: 'Term',
                            // A second choice with the text of an earlier one is left out.
                            options: [{value: 1, label: 'One year'}, 3, 'none', '1']
                        }
                    }
                },
                {top: 1}
            );
            const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', {name});
            expect(screen.getAllByRole('radio')).toHaveLength(3);
            expect(radio('One year').checked).toBe(true);

            fireEvent.click(radio('3'));
            expect(values.get('top')).toBe(3);
            expect(radio('3').checked).toBe(true);

            fireEvent.click(radio('none'));
            expect(values.get('top')).toBe('none');

            // A value that is not a choice selects none, and stays in the state.
            act(() => values.set('top', 'other'));
            expect(screen.getAllByRole<HTMLInputElement>('radio').some(it => it.checked)).toBe(
                false
            );
        });

        it('moves a slider by its step, and shows a value the state sets', async () => {
            const {values} = renderBound(
                {
                    top: {
                        component: 'slider',
                        props: {name: 'share', label: 'Share', min: 0, max: 1, step: 0.1}
                    }
                },
                {top: 0.2}
            );
            const handle = screen.getByRole('slider');
            expect(screen.getByText('Share')).toBeTruthy();
            expect(handle.getAttribute('aria-valuenow')).toBe('0.2');

            // The slider writes a step without the noise of float sums.
            fireEvent.keyDown(handle, {key: 'ArrowRight'});
            await waitFor(() => expect(values.get('top')).toBe(0.3));

            act(() => values.set('top', 0.9));
            expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('0.9');
        });

        it('names each handle of a slider, by the label of its field or the name of the field', () => {
            renderBound({
                top: {component: 'stack', props: {}, children: ['risk', 'level', 'band']},
                risk: {component: 'slider', props: {name: 'risk', label: 'Risk', min: 0, max: 9}},
                level: {component: 'slider', props: {name: 'level', min: 0, max: 9}},
                band: {
                    component: 'slider',
                    props: {name: 'band', label: 'Price band', min: 0, max: 9, range: true}
                }
            });

            expect(screen.getByRole('slider', {name: 'Risk'})).toBeTruthy();
            expect(screen.getByRole('slider', {name: 'level'})).toBeTruthy();
            expect(screen.getByRole('slider', {name: 'Price band, low'})).toBeTruthy();
            expect(screen.getByRole('slider', {name: 'Price band, high'})).toBeTruthy();
        });

        it('shows the values of a slider in its format', () => {
            const {container} = renderBound(
                {
                    top: {
                        component: 'slider',
                        props: {name: 'share', min: 0, max: 1, step: 0.05, format: 'percent'}
                    }
                },
                {top: 0.25}
            );
            const labels = [...container.querySelectorAll('.bp6-slider-label')].map(
                it => it.textContent
            );

            expect(labels).toEqual(['0%', '100%', '25%']);
        });

        it.each([
            ['a value above the range', {min: 0, max: 10}, 50, 0, 10, 10],
            ['a value below the range', {min: 5, max: 10}, -3, 5, 10, 5],
            ['a value that is not a number', {min: 2, max: 10}, 'high', 2, 10, 2],
            ['no value', {min: 2, max: 10}, undefined, 2, 10, 2],
            ['a range written backwards', {min: 10, max: 0}, 4, 0, 10, 4],
            ['a range of no width', {min: 3, max: 3}, 3, 3, 4, 3],
            ['a step of zero', {min: 0, max: 10, step: 0}, 4, 0, 10, 4]
        ])('draws a slider for %s', (_, props, value, min, max, shown) => {
            renderBound(
                {top: {component: 'slider', props: {name: 'level', ...props}}},
                {
                    top: value
                }
            );
            const handle = screen.getByRole('slider');

            expect(handle.getAttribute('aria-valuemin')).toBe(`${min}`);
            expect(handle.getAttribute('aria-valuemax')).toBe(`${max}`);
            expect(handle.getAttribute('aria-valuenow')).toBe(`${shown}`);
        });

        it('draws a slider from its least value while the greatest still streams', () => {
            const catalog = createCatalog(),
                view = (props: PlainObject, isPartial: boolean) =>
                    chatHost({
                        model: null,
                        item: catalog.renderDocument(
                            {root: 'top', elements: {top: {component: 'slider', props}}},
                            context(null, isPartial)
                        ) as ReactNode
                    }),
                {rerender} = render(view({name: 'level', min: 20}, true)),
                range = () => {
                    const handle = screen.getByRole('slider');
                    return ['min', 'max', 'now'].map(it => handle.getAttribute(`aria-value${it}`));
                };
            expect(range()).toEqual(['20', '120', '20']);

            rerender(view({name: 'level', min: 20, max: 40, value: 30}, false));
            expect(range()).toEqual(['20', '40', '30']);
        });

        describe('a default that streams in before the props that check it', () => {
            // Renders one element of a component, from props that may still stream.
            const streamed = (component: string) => {
                const catalog = createCatalog();
                return (props: PlainObject, isPartial: boolean) =>
                    chatHost({
                        model: null,
                        item: catalog.renderDocument(
                            {root: 'top', elements: {top: {component, props}}},
                            context(null, isPartial)
                        ) as ReactNode
                    });
            };

            it('selects the default of a radio group once its choice arrives', () => {
                const view = streamed('radioGroup'),
                    props = {name: 'plan', options: ['basic', 'pro'], value: 'pro'},
                    {rerender} = render(view(props, true)),
                    checked = () =>
                        screen
                            .getAllByRole<HTMLInputElement>('radio')
                            .filter(it => it.checked)
                            .map(it => it.value);
                // The last choice may be cut short, so it is left out while the props stream.
                expect(checked()).toEqual([]);

                rerender(view(props, false));
                expect(checked()).toEqual(['pro']);
            });

            it('shows the default of a slider once its range takes it in', () => {
                const view = streamed('slider'),
                    {rerender} = render(view({name: 'level', min: 0, value: 150}, true)),
                    now = () => screen.getByRole('slider').getAttribute('aria-valuenow');
                expect(now()).toBe('100');

                rerender(view({name: 'level', min: 0, value: 150, max: 200}, false));
                expect(now()).toBe('150');
            });

            it('keeps the value the user set as the rest of the props stream', () => {
                const view = streamed('slider'),
                    {rerender} = render(view({name: 'level', min: 0, value: 50}, true)),
                    now = () => screen.getByRole('slider').getAttribute('aria-valuenow');
                fireEvent.keyDown(screen.getByRole('slider'), {key: 'ArrowRight'});
                expect(now()).toBe('51');

                rerender(view({name: 'level', min: 0, value: 50, max: 200}, false));
                expect(now()).toBe('51');
            });
        });

        // Blueprint's slider counts the decimal places of its step, and writes a label per label
        // step. Outside the scale the spec bounds, either loop runs for seconds or for ever.
        it.each([
            ['a step far below the range', {min: 0, max: 10, step: 1e-310}, 0, 10],
            ['a range far below any step', {min: 0, max: 1e-306}, 0, 1],
            ['a range of a ten-billionth', {min: 5, max: 5.0000000001}, 5, 6],
            ['a range of 1e-11', {min: 0, max: 1e-11}, 0, 1],
            ['the least number above zero', {min: 0, max: 5e-324}, 0, 1],
            [
                'a range narrow beside its numbers',
                {min: 1e12 - 1, max: 1e12},
                1e12 - 1,
                1e12 - 1 + 1e6
            ]
        ])(
            'draws a slider of a bounded scale for %s',
            (_, props, min, max) => {
                const {container} = renderBound({
                        top: {component: 'slider', props: {name: 'level', ...props}}
                    }),
                    handle = screen.getByRole('slider');

                expect(handle.getAttribute('aria-valuemin')).toBe(`${min}`);
                expect(Number(handle.getAttribute('aria-valuemax'))).toBeCloseTo(max, 5);
                expect(
                    container.querySelectorAll('.bp6-slider-axis .bp6-slider-label')
                ).toHaveLength(2);
            },
            2000
        );

        it('moves a slider whose range was too narrow to draw', {timeout: 2000}, async () => {
            const {values} = renderBound({
                top: {component: 'slider', props: {name: 'level', min: 0, max: 1e-9}}
            });

            fireEvent.keyDown(screen.getByRole('slider'), {key: 'ArrowRight'});
            await waitFor(() => expect(values.get('top')).toBeGreaterThan(0));
        });

        it(
            'refuses a range beyond a trillion, and holds at most 100,000 steps',
            {timeout: 2000},
            async () => {
                const catalog = createCatalog(),
                    {values} = renderBound({
                        top: {
                            component: 'slider',
                            props: {name: 'level', min: 0, max: 1e9, step: 1}
                        }
                    });

                expect(
                    catalog.validate('slider', {name: 'level', min: 1e20, max: 1e20})
                ).not.toEqual([]);
                expect(catalog.validate('slider', {name: 'level', min: -1e12, max: 1e12})).toEqual(
                    []
                );

                fireEvent.keyDown(screen.getByRole('slider'), {key: 'ArrowRight'});
                await waitFor(() => expect(values.get('top')).toBe(10000));
            }
        );

        it('draws one label at each end of a slider, however wide its range', () => {
            const {container} = renderBound(
                {top: {component: 'slider', props: {name: 'amount', min: 0, max: 1000000}}},
                {top: 250000}
            );

            expect(container.querySelectorAll('.bp6-slider-axis .bp6-slider-label')).toHaveLength(
                2
            );
        });

        it('holds a low and a high value in a slider with range', async () => {
            const {values} = renderBound(
                {
                    top: {
                        component: 'slider',
                        props: {name: 'price', min: 0, max: 100, step: 5, range: true}
                    }
                },
                // The state gives the pair out of order, and one end outside the range.
                {top: [400, 20]}
            );
            const now = () =>
                screen.getAllByRole('slider').map(it => it.getAttribute('aria-valuenow'));
            expect(now()).toEqual(['20', '100']);

            fireEvent.keyDown(screen.getAllByRole('slider')[0], {key: 'ArrowRight'});
            await waitFor(() => expect(values.get('top')).toEqual([25, 100]));

            // With no pair in the state, the handles sit at the ends.
            act(() => values.set('top', 7));
            expect(now()).toEqual(['0', '100']);
        });

        describe('a slider that the user moves in a run of steps', () => {
            const renderLevel = () => {
                const bound = renderBound(
                        {top: {component: 'slider', props: {name: 'level', min: 0, max: 100}}},
                        {top: 10}
                    ),
                    writes = vi.spyOn(bound.values, 'set');
                return {...bound, writes};
            };

            it('moves the handle at once, and writes the state once', async () => {
                const {values, writes} = renderLevel(),
                    handle = screen.getByRole('slider');
                for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, {key: 'ArrowRight'});
                expect(handle.getAttribute('aria-valuenow')).toBe('30');
                expect(writes).not.toHaveBeenCalled();

                await waitFor(() => expect(values.get('top')).toBe(30));
                expect(writes).toHaveBeenCalledTimes(1);
            });

            it('writes a pending value when it unmounts, and nothing after', async () => {
                const {values, writes, unmount} = renderLevel();
                fireEvent.keyDown(screen.getByRole('slider'), {key: 'ArrowRight'});
                unmount();
                expect(values.get('top')).toBe(11);

                await new Promise(resolve => setTimeout(resolve, 400));
                expect(writes).toHaveBeenCalledTimes(1);
            });

            it('keeps a pending value when its label changes', async () => {
                const catalog = createCatalog(),
                    view = (props: PlainObject) =>
                        chatHost({
                            model: null,
                            item: catalog.renderDocument(
                                {root: 'top', elements: {top: {component: 'slider', props}}},
                                context(null)
                            ) as ReactNode
                        }),
                    props = {name: 'level', min: 0, max: 100, value: 10},
                    {rerender} = render(view(props)),
                    now = () => screen.getByRole('slider').getAttribute('aria-valuenow');
                fireEvent.keyDown(screen.getByRole('slider'), {key: 'ArrowRight'});

                rerender(view({...props, label: 'Level'}));
                expect(now()).toBe('11');
                await new Promise(resolve => setTimeout(resolve, 400));
                expect(now()).toBe('11');
            });
        });

        it('keeps what the user entered when the label and the rules of its input change', async () => {
            const catalog = createCatalog(),
                view = (props: PlainObject) =>
                    chatHost({
                        model: null,
                        item: catalog.renderDocument(
                            {root: 'top', elements: {top: {component: 'textInput', props}}},
                            context(null)
                        ) as ReactNode
                    }),
                {rerender, container} = render(view({name: 'name', label: 'Name'})),
                input = () => container.querySelector<HTMLInputElement>('.xh-text-input input');
            typeInto(input(), 'Ann');

            // Hoist fixes the rules of a field when it creates it, so the input gets a new one.
            rerender(view({name: 'name', label: 'Full name', rules: {required: true}}));
            expect(screen.getByText('Full name')).toBeTruthy();
            expect(input().value).toBe('Ann');

            // The new field runs the new rule, and still holds what the user types.
            typeInto(input(), '');
            await waitFor(() => expect(container.textContent).toContain('Full name is required.'));
            typeInto(input(), 'Bob');
            expect(input().value).toBe('Bob');
            await waitFor(() => expect(container.textContent).not.toContain('is required'));
        });

        it('leaves out the last choice while the props stream, as it may be cut short', () => {
            const element: ChatUiElement = {
                    component: 'segmentedControl',
                    props: {name: 'period', options: ['day', 'week', 'mon']}
                },
                catalog = createCatalog(),
                view = (isPartial: boolean) =>
                    fragment(
                        catalog.renderDocument(
                            {root: 'top', elements: {top: element}},
                            context(null, isPartial)
                        )
                    ),
                {rerender} = render(view(true));
            expect(screen.getAllByRole('radio').map(it => it.textContent)).toEqual(['day', 'week']);

            rerender(view(false));
            expect(screen.getAllByRole('radio')).toHaveLength(3);
        });
    });

    describe('form', () => {
        const formDoc = (button: PlainObject = {label: 'Submit', intent: 'primary'}) => ({
            root: 'form',
            elements: {
                form: {
                    component: 'form',
                    props: {title: 'Contact'},
                    children: ['email', 'qty', 'region', 'go']
                },
                email: {
                    component: 'textInput',
                    props: {name: 'email', label: 'Email', rules: {required: true, email: true}}
                },
                qty: {
                    component: 'numberInput',
                    props: {name: 'qty', label: 'Quantity', rules: {min: 1, max: 10}, value: 2}
                },
                region: {
                    component: 'select',
                    props: {name: 'region', options: ['emea', 'apac'], multi: true}
                },
                go: {component: 'button', props: button}
            }
        });

        it('checks every field on a click, and sends nothing while one is not valid', async () => {
            const chatModel = createChatModel(),
                {container} = renderDocument(formDoc(), chatModel);

            typeInto(container.querySelector('.xh-number-input input'), '50');
            await clickAsync(screen.getByRole('button', {name: 'Submit'}));

            expect(chatModel.messages).toHaveLength(0);
            expect(container.textContent).toContain('Email is required.');
            expect(container.textContent).toContain('Quantity must be less than or equal to 10.');
            // The Hoist field set takes the color of the worst problem.
            expect(container.querySelector('.xh-chat-ui-form').className).toContain(
                'xh-card--intent-danger'
            );
        });

        it('runs the email rule on what the user typed', async () => {
            const chatModel = createChatModel(),
                {container} = renderDocument(formDoc(), chatModel);

            typeInto(container.querySelector('.xh-text-input input'), 'not an address');
            await clickAsync(screen.getByRole('button', {name: 'Submit'}));

            expect(chatModel.messages).toHaveLength(0);
            expect(container.textContent).toContain(
                'Email is not a properly formatted email address.'
            );
        });

        it("sends the value of each field in the message's context, beside the action's own", async () => {
            const chatModel = createChatModel(),
                {container} = renderDocument(
                    formDoc({
                        label: 'Submit',
                        action: {type: 'send', text: 'Place the order.', context: {source: 'chat'}}
                    }),
                    chatModel
                );

            typeInto(container.querySelector('.xh-text-input input'), 'ann@example.com');
            choose(container.querySelector('.xh-select'), 'emea');
            choose(container.querySelector('.xh-select'), 'apac');
            await clickAsync(screen.getByRole('button', {name: 'Submit'}));
            expect(chatModel.messages[0]).toMatchObject({
                role: 'user',
                text: 'Place the order.',
                metadata: {
                    context: {
                        email: 'ann@example.com',
                        qty: 2,
                        // A list goes as its JSON, which a model reads back as a list.
                        region: '["emea","apac"]',
                        source: 'chat'
                    }
                }
            });
        });

        it('sends what a slider and a radio group show, with a range as the JSON of a list', async () => {
            const chatModel = createChatModel();
            renderDocument(
                {
                    root: 'form',
                    elements: {
                        form: {
                            component: 'form',
                            props: {},
                            children: ['level', 'price', 'plan', 'go']
                        },
                        // No value: the slider shows its least value, and sends it.
                        level: {component: 'slider', props: {name: 'level', min: 1, max: 5}},
                        price: {
                            component: 'slider',
                            props: {name: 'price', min: 0, max: 100, range: true, value: [20, 80]}
                        },
                        plan: {
                            component: 'radioGroup',
                            props: {name: 'plan', options: ['basic', 'pro'], value: 'basic'}
                        },
                        go: {component: 'button', props: {label: 'Submit'}}
                    }
                },
                chatModel
            );

            fireEvent.click(screen.getByRole('radio', {name: 'pro'}));
            await clickAsync(screen.getByRole('button', {name: 'Submit'}));

            expect(chatModel.messages[0].metadata.context).toEqual({
                level: 1,
                price: '[20,80]',
                plan: 'pro'
            });
        });

        it('sends the value a slider shows before its write to the state', async () => {
            const chatModel = createChatModel();
            renderDocument(
                {
                    root: 'form',
                    elements: {
                        form: {component: 'form', props: {}, children: ['level', 'go']},
                        level: {component: 'slider', props: {name: 'level', min: 1, max: 5}},
                        go: {component: 'button', props: {label: 'Submit'}}
                    }
                },
                chatModel
            );

            fireEvent.keyDown(screen.getByRole('slider'), {key: 'ArrowRight'});
            await clickAsync(screen.getByRole('button', {name: 'Submit'}));

            expect(chatModel.messages[0].metadata.context).toEqual({level: 2});
        });

        it('sends its label when the button has no action', async () => {
            const chatModel = createChatModel();
            renderDocument(
                {root: 'go', elements: {go: {component: 'button', props: {label: 'Show more'}}}},
                chatModel
            );

            await clickAsync(screen.getByRole('button', {name: 'Show more'}));
            expect(chatModel.messages[0]).toMatchObject({role: 'user', text: 'Show more'});
            expect(chatModel.messages[0].metadata.context).toBeUndefined();
        });

        it('disables a button whose action a format refused, and does not send its label', async () => {
            const chatModel = createChatModel(),
                action: ChatUiStateAction = {
                    type: 'state',
                    id: 'go',
                    summary: '',
                    disabledReason: 'This action is not valid, so it cannot run.'
                };
            renderDocument(
                {root: 'go', elements: {go: {component: 'button', props: {label: 'Pay', action}}}},
                chatModel
            );
            const button = screen.getByRole<HTMLButtonElement>('button', {name: 'Pay'});
            expect(button.disabled).toBe(true);
            expect(button.title).toBe('This action is not valid, so it cannot run.');

            await clickAsync(button);
            expect(chatModel.messages).toHaveLength(0);
        });

        it('says why an action of an OpenUI program cannot run, in place of sending the label', async () => {
            const chatModel = createOpenUiChat(
                    'root = Stack([go])\n' +
                        'saved = Mutation("save_region", {region: "x"})\n' +
                        'go = Button("Save", @Run(saved))'
                ),
                {container} = render(chatMessageList({model: chatModel}));
            await act(async () => {
                await chatModel.sendAsync('Save it.');
            });
            const button = screen.getByRole<HTMLButtonElement>('button', {name: 'Save'});
            expect(button.disabled).toBe(true);
            expect(button.title).toBe('This action would change data, which a program cannot do.');

            await clickAsync(button);
            expect(chatModel.messages).toHaveLength(2);
            expect(container.textContent).not.toContain('could not be displayed');
        });

        it('cannot send more values than a message holds, and says why', () => {
            const names = [...Array(9).keys()].map(it => `f${it}`),
                chatModel = createChatModel();
            renderDocument(
                {
                    root: 'form',
                    elements: {
                        form: {component: 'form', props: {}, children: [...names, 'go']},
                        ...Object.fromEntries(
                            names.map(name => [
                                name,
                                {component: 'textInput', props: {name, value: 'x'}}
                            ])
                        ),
                        go: {component: 'button', props: {label: 'Submit'}}
                    }
                },
                chatModel
            );

            expect(screen.getByRole<HTMLButtonElement>('button', {name: 'Submit'}).disabled).toBe(
                true
            );
        });

        it('hides a button that sends where there is no chat to send to', () => {
            renderDocument(formDoc(), null);
            expect(screen.queryByRole('button', {name: 'Submit'})).toBeNull();
        });

        it('checks the fields before a state action runs', async () => {
            const stateAction: ChatUiStateAction = {type: 'state', id: 'go', summary: 'Saves'},
                {state, container} = renderBound(
                    formDoc({label: 'Save', action: stateAction}).elements
                );

            await clickAsync(screen.getByRole('button', {name: 'Save'}));
            expect(state.runActionAsync).not.toHaveBeenCalled();

            typeInto(container.querySelector('.xh-text-input input'), 'ann@example.com');
            await clickAsync(screen.getByRole('button', {name: 'Save'}));
            expect(state.runActionAsync).toHaveBeenCalledWith(stateAction, expect.anything());
        });
    });

    // jsdom has no layout, so these check only what the stylesheets select on.
    describe('layout', () => {
        const stateAction: ChatUiStateAction = {type: 'state', id: 'go', summary: 'Goes'},
            period: ChatUiElement = {
                component: 'segmentedControl',
                props: {name: 'period', options: ['day', 'week']}
            },
            go: ChatUiElement = {component: 'button', props: {label: 'Go', action: stateAction}},
            childrenOf = (el: Element, selector: string) =>
                [...el.children].filter(it => it.matches(selector));

        it('renders a field and a button as direct children of a row stack', () => {
            const {container} = renderBound({
                    top: {
                        component: 'stack',
                        props: {direction: 'row'},
                        children: ['period', 'go']
                    },
                    period,
                    go
                }),
                row = container.querySelector('.xh-chat-ui-stack.xh-hbox');

            // A segmented control keeps the width of its options, by the class Hoist gives its field.
            expect(
                childrenOf(row, '.xh-chat-ui-field.xh-form-field--segmented-control')
            ).toHaveLength(1);
            expect(childrenOf(row, 'button.xh-chat-ui-button')).toHaveLength(1);
        });

        it('renders a field and a button as direct children of the content of a form', () => {
            const {container} = renderBound({
                    top: {component: 'form', props: {}, children: ['period', 'go']},
                    period,
                    go
                }),
                content = container.querySelector('.xh-chat-ui-form .xh-card__content');

            expect(childrenOf(content, '.xh-chat-ui-field')).toHaveLength(1);
            expect(childrenOf(content, 'button.xh-chat-ui-button')).toHaveLength(1);
        });
    });

    describe('in an OpenUI Lang program', () => {
        const PROGRAM =
            'root = Stack([region, note, form])\n' +
            '$region = "emea"\n' +
            'region = Select("region", [{value: "emea", label: "EMEA"}, {value: "apac", label: "APAC"}], "Region", null, null, null, $region)\n' +
            'note = Text("Showing " + ($region == "apac" ? "Asia Pacific" : "Europe"))\n' +
            'form = Form([name, submit], "Details")\n' +
            'name = TextInput("name", "Name", null, {required: true}, $name)\n' +
            'submit = Button("Submit", @ToAssistant("Use these details", {name: $name, region: $region}), "primary")';

        it('re-renders an expression on a $variable when the select bound to it changes', async () => {
            const chatModel = createOpenUiChat(PROGRAM),
                {container} = render(chatMessageList({model: chatModel}));

            // The program streams in as the reply text, a few characters at a time.
            await act(async () => {
                await chatModel.sendAsync('Show the details form.');
            });
            expect(container.textContent).toContain('Showing Europe');

            choose(container.querySelector('.xh-select'), 'APAC');
            expect(container.textContent).toContain('Showing Asia Pacific');
            expect(container.textContent).not.toContain('Showing Europe');
        });

        it('writes once through a binding whose expression changes what the user typed', async () => {
            const chatModel = createOpenUiChat(
                    'root = Stack([name, note])\n' +
                        '$a = "x"\n' +
                        'name = TextInput("name", "Name", null, null, $a = "x" + $value)\n' +
                        'note = Text("Value " + $a)'
                ),
                {container} = render(chatMessageList({model: chatModel}));
            await act(async () => {
                await chatModel.sendAsync('Show the field.');
            });
            const input = container.querySelector<HTMLInputElement>('.xh-text-input input');
            expect(input.value).toBe('x');

            typeInto(input, 'b');
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
            });
            // The state takes the expression of what was typed, once, and the field shows it.
            expect(container.textContent).toContain('Value xb');
            expect(input.value).toBe('xb');
        });

        it('submits a form with the current values of its $variables', async () => {
            const chatModel = createOpenUiChat(PROGRAM),
                {container} = render(chatMessageList({model: chatModel}));
            await act(async () => {
                await chatModel.sendAsync('Show the details form.');
            });

            await clickAsync(screen.getByRole('button', {name: 'Submit'}));
            expect(container.textContent).toContain('Name is required.');
            expect(chatModel.messages).toHaveLength(2);

            typeInto(container.querySelector('.xh-text-input input'), 'Ann');
            choose(container.querySelector('.xh-select'), 'APAC');
            await clickAsync(screen.getByRole('button', {name: 'Submit'}));

            await waitFor(() => expect(chatModel.messages.length).toBeGreaterThan(2));
            expect(chatModel.messages[2]).toMatchObject({
                role: 'user',
                text: 'Use these details',
                metadata: {context: {name: 'Ann', region: 'apac'}}
            });
        });
    });
});

//------------------
// Helpers
//------------------
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

// State for a document: the value of each input, by element id.
class Values extends HoistBase implements ChatUiState {
    private readonly map = observable.map<string, unknown>({}, {deep: false});

    runActionAsync = vi.fn(async () => null);

    get(id: string): unknown {
        return this.map.get(id);
    }

    @action
    set(id: string, value: unknown) {
        this.map.set(id, value);
    }
}

// Components render within a chat, whose model gives them the model context Hoist needs.
const chatHost = hoistCmp.factory<HoistProps<ChatModel>>({
    displayName: 'ChatHost',
    model: uses(ChatModel, {optional: true}),
    render: ({children}) => fragment({items: children})
});

function createCatalog(): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [chatUiStackSpec(), chatUiTextSpec(), ...chatUiInputSpecs()],
        modes: ['document']
    });
}

function renderDocument(doc: PlainObject, chatModel: ChatModel) {
    return render(
        chatHost({
            model: chatModel,
            item: createCatalog().renderDocument(
                doc as ChatUiDocument,
                context(chatModel)
            ) as ReactNode
        })
    );
}

// Renders a document whose inputs each bind their `value` to a state, by element id.
function renderBound(elements: Record<string, ChatUiElement>, initial: PlainObject = {}) {
    const values = new Values(),
        state = values;
    Object.entries(initial).forEach(([id, value]) => values.set(id, value));

    const doc: ChatUiDocument = {
        root: Object.keys(elements)[0],
        elements: {},
        state: {
            create: () => values,
            resolve: () => ({
                root: Object.keys(elements)[0],
                elements: Object.fromEntries(
                    Object.entries(elements).map(([id, element]) => {
                        const isInput = Object.hasOwn(element.props, 'name');
                        return [
                            id,
                            {
                                ...element,
                                props: isInput
                                    ? {...element.props, value: values.get(id)}
                                    : element.props,
                                ...(isInput
                                    ? {bindings: {value: {set: v => values.set(id, v)}}}
                                    : {})
                            } as ChatUiElement
                        ];
                    })
                )
            })
        }
    };
    return {values, state, ...renderDocument(doc, null)};
}

function context(chatModel: ChatModel, isPartial: boolean = false): ChatUiDocumentContext {
    return {
        chatModel,
        messageId: 'm1',
        part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
        isPartial
    };
}

function createChatModel(): ChatModel {
    const chatModel = new ChatModel({
        transport: new ScriptedChatTransport({respond: () => textEvents('Done.'), delayMs: 0})
    });
    onTestFinished(() => chatModel.destroy());
    return chatModel;
}

// A chat whose first reply is an OpenUI Lang program, and whose later replies are text.
function createOpenUiChat(program: string): ChatModel {
    const catalog = new ChatUiCatalog({
            components: [chatUiStackSpec(), chatUiTextSpec(), ...chatUiInputSpecs()],
            textFormats: [openUiLangFormat({root: 'stack', bindings: true})],
            modes: ['openui']
        }),
        chatModel = new ChatModel({
            catalog,
            transport: new ScriptedChatTransport({
                respond: (_, {turnIndex}) => textEvents(turnIndex === 0 ? program : 'Done.'),
                delayMs: 0
            })
        });
    onTestFinished(() => chatModel.destroy());
    return chatModel;
}

// Type a value into a Hoist input, and commit it as leaving the input does.
function typeInto(input: Element, value: string) {
    fireEvent.focus(input);
    fireEvent.change(input, {target: {value}});
    fireEvent.blur(input);
}

// Open a Hoist select, and click the choice with the given label.
function choose(selectEl: Element, label: string) {
    fireEvent.keyDown(selectEl.querySelector('input'), {key: 'ArrowDown', keyCode: 40});
    const option = [...document.querySelectorAll('.xh-select__option')].find(
        it => it.textContent === label
    );
    fireEvent.click(option);
}

// Click, then let the action, which runs async, finish and render.
async function clickAsync(target: HTMLElement) {
    await act(async () => {
        fireEvent.click(target);
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}
