import {isFunction, isObject, isPlainObject} from 'lodash';
import type {ChatPartRenderContext} from '../core';
import type {ChatUiStateAction} from './ChatUiAction';
import type {ChatUiDocumentContext} from './ChatUiComponentSpec';
import type {ChatUiDocument} from './ChatUiDocument';

/**
 * Gives a document state: values that the user changes, and props that follow them. A format or
 * an adapter sets one as {@link ChatUiDocument.state}, in code, for a protocol with a data model -
 * such as the `$variables` of OpenUI Lang. A document that arrives as JSON cannot hold one.
 *
 * The catalog creates the state when the document first renders, and keeps it for as long as the
 * document shows - through each new parse of a reply that streams, and each render. It destroys
 * the state when the document goes away, with its message. On each render it asks `resolve()` for
 * the document as it stands, then repairs, checks and renders that as it does any other.
 *
 * ```ts
 * const state: ChatUiStateSpec<CounterState> = {
 *     create: () => new CounterState(),
 *     resolve: counter => ({
 *         root: 'root',
 *         elements: {
 *             root: {component: 'stack', props: {}, children: ['count', 'step']},
 *             count: {component: 'text', props: {text: `Count: ${counter.count}`}},
 *             step: {
 *                 component: 'numberInput',
 *                 props: {name: 'step', value: counter.step},
 *                 bindings: {value: {set: value => (counter.step = value as number)}}
 *             }
 *         }
 *     })
 * };
 * ```
 */
export interface ChatUiStateSpec<S extends ChatUiState = ChatUiState> {
    /**
     * Create the state. Called once, when the document first renders. A reply that streams gives
     * a new spec with each parse, and the catalog keeps the state the first one created.
     *
     * @param context - the chat, message and part that hold the document.
     */
    create(context: ChatUiDocumentContext): S;

    /**
     * The document for the current state: plain props, with a {@link ChatUiBinding} for each prop
     * that the user can change. Runs inside a MobX observer on each render, so the document
     * renders again when an observable it reads changes. Must not change observable state.
     *
     * @param state - the state that `create()` returned.
     * @param context - the chat, message and part that hold the document.
     */
    resolve(state: S, context: ChatUiDocumentContext): ChatUiDocument;
}

/** The state of one rendered document, created by {@link ChatUiStateSpec.create}. */
export interface ChatUiState {
    /**
     * Run a `state` action of the document, such as one that sets a value. The catalog calls it
     * from {@link ChatUiCatalog.runActionAsync}, once the action has passed its checks. A state
     * without it refuses every `state` action.
     */
    runActionAsync?(action: ChatUiStateAction, context: ChatPartRenderContext): Promise<unknown>;

    /** Release what the state holds. Called when the document goes away. */
    destroy?(): void;
}

/**
 * Ties a prop of an element to the state of its document, so that the component can write the
 * prop - see {@link ChatUiElement.bindings}. The element's `props` hold the current value.
 */
export interface ChatUiBinding {
    /** Write a new value to the state. The document then resolves again, with the value in place. */
    set(value: unknown): void;
}

/**
 * True for a value that can serve as {@link ChatUiDocument.state}. A value read from JSON never
 * can, as it holds no functions.
 */
export function isChatUiStateSpec(value: unknown): value is ChatUiStateSpec {
    const spec = value as ChatUiStateSpec;
    return isObject(value) && isFunction(spec.create) && isFunction(spec.resolve);
}

/**
 * True for a value that can serve as {@link ChatUiElement.bindings}: an object whose every value
 * has a `set` function.
 */
export function isChatUiBindings(value: unknown): value is Record<string, ChatUiBinding> {
    return isPlainObject(value) && Object.values(value).every(it => isFunction(it?.set));
}
