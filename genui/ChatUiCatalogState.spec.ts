import {act, fireEvent, render, screen} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import {HoistBase, type PlainObject} from '@xh/hoist/core';
import {bindable} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatUiActionSchema, type ChatUiStateAction, describeChatUiAction} from './ChatUiAction';
import {ChatUiCatalog} from './ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from './ChatUiComponentSpec';
import type {ChatUiDocument} from './ChatUiDocument';
import type {ChatUiState, ChatUiStateSpec} from './ChatUiState';
import {validateSchema} from '../impl/SchemaUtils';

/**
 * A document can have state: values that the user changes, and props that follow them. Formats
 * and adapters for protocols with a data model rely on the catalog to create the state once per
 * rendered document, to keep it while a reply streams, to render again when it changes, to let a
 * component write a bound prop, and to check and render each resolved document as any other.
 */
describe('ChatUiCatalog state', () => {
    beforeAll(() => initTestAppAsync());

    describe('a document with state', () => {
        it('renders what the state resolves, and again when the state changes', () => {
            const counter = new Counter();
            render(fragment(createCatalog().renderDocument(counterDoc(counter), context())));
            expect(screen.getByTestId('note').textContent).toBe('Count: 0');

            act(() => (counter.count = 3));
            expect(screen.getByTestId('note').textContent).toBe('Count: 3');
        });

        it('creates the state once, keeps it across new specs, and destroys it on unmount', () => {
            const counter = new Counter(),
                create = vi.fn(() => counter),
                catalog = createCatalog(),
                view = (label: string) =>
                    fragment(
                        catalog.renderDocument(
                            {
                                root: null,
                                elements: {},
                                state: {
                                    create,
                                    resolve: (state: Counter) => noteDoc(`${label}: ${state.count}`)
                                }
                            },
                            context()
                        )
                    );

            const {rerender, unmount} = render(view('First'));
            act(() => (counter.count = 2));
            // A reply that streams parses again, and gives a new spec for the same document.
            rerender(view('Second'));

            expect(screen.getByTestId('note').textContent).toBe('Second: 2');
            expect(create).toHaveBeenCalledOnce();
            expect(counter.isDestroyed).toBe(false);

            unmount();
            expect(counter.isDestroyed).toBe(true);
        });

        it('checks each resolved document, and renders a broken element as a fallback', () => {
            silenceWarnings();
            const counter = new Counter(),
                spec: ChatUiStateSpec<Counter> = {
                    create: () => counter,
                    resolve: state => ({
                        root: 'top',
                        elements: {
                            top: {component: 'stack', props: {}, children: ['ok', 'broken']},
                            ok: {component: 'note', props: {text: 'Fine'}},
                            broken: {component: 'note', props: {text: state.count as any}}
                        }
                    })
                };
            const {container} = render(
                fragment(
                    createCatalog().renderDocument(
                        {root: null, elements: {}, state: spec},
                        context()
                    )
                )
            );

            expect(screen.getByTestId('note').textContent).toBe('Fine');
            expect(container.textContent).toContain('This note could not be displayed.');
        });

        it('shows a placeholder while partial, and a fallback once complete, when the state fails', () => {
            silenceWarnings();
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            onTestFinished(() => error.mockRestore());
            const failing: ChatUiDocument = {
                root: null,
                elements: {},
                state: {
                    create: () => ({}),
                    resolve: () => {
                        throw new Error('No program yet');
                    }
                }
            };
            const catalog = createCatalog({placeholder: () => 'Building…'}),
                {container, rerender} = render(
                    fragment(catalog.renderDocument(failing, context({isPartial: true})))
                );
            expect(container.textContent).toBe('Building…');

            rerender(fragment(catalog.renderDocument(failing, context())));
            expect(container.textContent).toContain('This content could not be displayed.');
        });

        it('ignores state and bindings read from JSON', () => {
            silenceWarnings();
            const fromJson = JSON.parse(
                JSON.stringify({
                    root: 'top',
                    state: {create: 'x', resolve: 'y'},
                    elements: {
                        top: {component: 'field', props: {value: 7}, bindings: {value: {set: 1}}}
                    }
                })
            );
            const {container} = render(
                fragment(createCatalog().renderDocument(fromJson, context()))
            );

            // With no real binding, the value is checked against the schema as any other prop.
            expect(container.textContent).toContain('This field could not be displayed.');
        });
    });

    describe('state props', () => {
        it('writes a bound prop through its binding, and shows the value the state then holds', () => {
            const counter = new Counter();
            render(fragment(createCatalog().renderDocument(fieldDoc(counter), context())));
            expect(screen.getByTestId('field').textContent).toBe('value=0');

            fireEvent.click(screen.getByTestId('field'));
            expect(counter.count).toBe(1);
            expect(screen.getByTestId('field').textContent).toBe('value=1');
        });

        it('keeps the value of a prop with no binding for as long as the component shows', () => {
            const catalog = createCatalog(),
                plain: ChatUiDocument = {
                    root: 'top',
                    elements: {top: {component: 'field', props: {value: 'a'}}}
                },
                {rerender} = render(fragment(catalog.renderDocument(plain, context())));

            fireEvent.click(screen.getByTestId('field'));
            expect(screen.getByTestId('field').textContent).toBe('value=a1');

            rerender(fragment(catalog.renderDocument({...plain}, context())));
            expect(screen.getByTestId('field').textContent).toBe('value=a1');
        });

        it('does not check the value of a bound prop against the schema', () => {
            const counter = new Counter();
            // The schema takes a string of at most 3 characters. The user may hold any value.
            counter.count = 123456;
            render(fragment(createCatalog().renderDocument(fieldDoc(counter), context())));

            expect(screen.getByTestId('field').textContent).toBe('value=123456');
        });

        it('refuses a write to a prop that is not a state prop', () => {
            let setProp: (name: string, value: unknown) => void;
            const spy: ChatUiComponentSpec = {
                ...FIELD,
                render: (_, ctx) => {
                    setProp = ctx.setProp;
                    return null;
                }
            };
            render(
                fragment(
                    new ChatUiCatalog({components: [spy]}).renderDocument(
                        {root: 'top', elements: {top: {component: 'field', props: {}}}},
                        context()
                    )
                )
            );

            expect(() => setProp('label', 'x')).toThrow(
                "'label' is not a state prop of component 'field'."
            );
        });

        it('requires each state prop to be a prop of the schema', () => {
            expect(
                () => new ChatUiCatalog({components: [{...FIELD, stateProps: ['other']}]})
            ).toThrow("component 'field' must list its stateProps as names of props");
        });
    });

    describe('state actions', () => {
        const action: ChatUiStateAction = {type: 'state', id: 'top.action', summary: 'Adds one'};

        it('runs against the state of the document', async () => {
            const runActionAsync = vi.fn(async () => 'done'),
                state: ChatUiState = {runActionAsync},
                ctx = {chatModel: null, messageId: 'm1', state};

            await expect(createCatalog().runActionAsync(action, ctx)).resolves.toBe('done');
            expect(runActionAsync).toHaveBeenCalledWith(action, ctx);
        });

        it('is refused for a document with no state, such as one written as JSON', async () => {
            await expect(
                createCatalog().runActionAsync(action, {chatModel: null, messageId: 'm1'})
            ).rejects.toThrow('No state to act on');
        });

        it('reaches the state from a component of the document', async () => {
            const runActionAsync = vi.fn(async () => null),
                doc: ChatUiDocument = {
                    root: null,
                    elements: {},
                    state: {
                        create: () => ({runActionAsync}),
                        resolve: () => ({
                            root: 'top',
                            elements: {top: {component: 'trigger', props: {action}}}
                        })
                    }
                };
            render(fragment(createCatalog().renderDocument(doc, context())));

            fireEvent.click(screen.getByTestId('trigger'));
            await vi.waitFor(() =>
                expect(runActionAsync).toHaveBeenCalledWith(action, expect.anything())
            );
        });

        it('describes itself by its summary, and stays out of the default action schema', () => {
            expect(describeChatUiAction(action)).toBe('Adds one');
            expect(validateSchema(action, chatUiActionSchema())).not.toEqual([]);
            expect(validateSchema(action, chatUiActionSchema({types: ['send', 'state']}))).toEqual(
                []
            );
        });
    });
});

//------------------
// Helpers
//------------------
class Counter extends HoistBase implements ChatUiState {
    @bindable accessor count: number = 0;
}

const STACK: ChatUiComponentSpec = {
        name: 'stack',
        description: 'A vertical stack.',
        props: {type: 'object', additionalProperties: false, properties: {}},
        slots: ['default'],
        render: (_, {children}) => fragment({children})
    },
    NOTE: ChatUiComponentSpec<{text: string}> = {
        name: 'note',
        description: 'A short note.',
        props: {type: 'object', required: ['text'], properties: {text: {type: 'string'}}},
        render: ({text}) => div({'data-testid': 'note', item: text} as PlainObject)
    },
    // Shows its value, and adds a 1 to it on click.
    FIELD: ChatUiComponentSpec<{value?: unknown; label?: string}> = {
        name: 'field',
        description: 'An input.',
        props: {
            type: 'object',
            additionalProperties: false,
            properties: {label: {type: 'string'}, value: {type: 'string', maxLength: 3}}
        },
        stateProps: ['value'],
        render: ({value}, {setProp}) =>
            div({
                'data-testid': 'field',
                item: `value=${value}`,
                onClick: () => setProp('value', typeof value === 'number' ? value + 1 : `${value}1`)
            } as PlainObject)
    },
    TRIGGER: ChatUiComponentSpec<{action: ChatUiStateAction}> = {
        name: 'trigger',
        description: 'A button.',
        props: {
            type: 'object',
            properties: {action: chatUiActionSchema({types: ['state']})}
        },
        render: ({action}, {runActionAsync}) =>
            div({
                'data-testid': 'trigger',
                onClick: () => runActionAsync(action)
            } as PlainObject)
    };

function createCatalog(config: PlainObject = {}): ChatUiCatalog {
    return new ChatUiCatalog({components: [STACK, NOTE, FIELD, TRIGGER], ...config});
}

function noteDoc(text: string): ChatUiDocument {
    return {root: 'top', elements: {top: {component: 'note', props: {text}}}};
}

function counterDoc(counter: Counter): ChatUiDocument {
    return {
        root: null,
        elements: {},
        state: {
            create: () => counter,
            resolve: (state: Counter) => noteDoc(`Count: ${state.count}`)
        }
    };
}

function fieldDoc(counter: Counter): ChatUiDocument {
    return {
        root: null,
        elements: {},
        state: {
            create: () => counter,
            resolve: (state: Counter) => ({
                root: 'top',
                elements: {
                    top: {
                        component: 'field',
                        props: {value: state.count},
                        bindings: {value: {set: value => (state.count = value as number)}}
                    }
                }
            })
        }
    };
}

function context(opts: {isPartial?: boolean} = {}): ChatUiDocumentContext {
    return {
        chatModel: null,
        messageId: 'm1',
        part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
        isPartial: !!opts.isPartial
    };
}

function silenceWarnings() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    return warn;
}
