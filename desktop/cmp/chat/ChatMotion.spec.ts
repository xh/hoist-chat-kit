import {act, render} from '@testing-library/react';
import {div, span} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatAnnouncer, type ChatComposerHost, ChatComposerModel, ChatModel} from '../../../core';
import {ScriptedChatTransport, textEvents} from '../../../transport';
import {isChatMotionReduced} from '../../impl/ChatMotion';
import {chatComposer} from './ChatComposer';
import {chatPanel} from './ChatPanel';

/**
 * The chat's motion. Users rely on it staying calm - one loop at most, only while a reply runs,
 * easing back to rest rather than snapping - and on it giving way to reduced motion, whether the
 * browser or the app asks. Nothing it does may wait on input.
 */
describe('Chat motion', () => {
    beforeAll(() => initTestAppAsync());

    let animations: Array<{keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: any}>;
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
        chatAnnouncer.clear();
        animations = [];
        const animate = vi.fn(function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
            const ret = {keyframes, options, cancel: vi.fn()};
            animations.push(ret);
            return ret as unknown as Animation;
        });
        Element.prototype.animate = animate;
        onTestFinished(() => {
            delete Element.prototype.animate;
        });
        stubReducedMotion(false);
    });

    describe('start items', () => {
        it('breathe while a reply runs, and ease back to rest from where they were', () => {
            const host = mutableHost(),
                model = composerModel(host),
                {rerender} = render(composer(model));
            expect(animations).toHaveLength(0);

            act(() => (host.isBusy = true));
            rerender(composer(model));
            expect(animations).toHaveLength(1);
            const [loop] = animations;
            expect(loop.options).toMatchObject({iterations: Infinity, delay: 150});

            act(() => (host.isBusy = false));
            rerender(composer(model));
            expect(loop.cancel).toHaveBeenCalledOnce();
            expect(animations).toHaveLength(2);
            expect(animations[1].options).toMatchObject({duration: 200});
            expect(animations[1].keyframes[1]).toEqual({opacity: '1', transform: 'none'});
        });

        it('breathe when they mount while a reply runs, and again after they unmount mid-reply', () => {
            const host = mutableHost({isBusy: true}),
                model = composerModel(host),
                bare = () => chatComposer({model}),
                {rerender} = render(bare());
            expect(animations).toHaveLength(0);

            rerender(composer(model));
            expect(animations).toHaveLength(1);
            const [first] = animations;

            // They go mid-reply: the loop stops, with nothing left to ease.
            rerender(bare());
            expect(first.cancel).toHaveBeenCalledOnce();
            expect(animations).toHaveLength(1);

            act(() => (host.isBusy = false));
            rerender(bare());
            act(() => (host.isBusy = true));
            rerender(composer(model));
            expect(animations).toHaveLength(2);
            expect(animations[1].options).toMatchObject({iterations: Infinity});
        });

        it('hold still under reduced motion, or with breatheStartItems false', () => {
            stubReducedMotion(true);
            const model = composerModel(mutableHost({isBusy: true}));
            render(composer(model));
            stubReducedMotion(false);
            render(composer(model, {breatheStartItems: false}));
            expect(animations).toHaveLength(0);
        });
    });

    describe('isChatMotionReduced', () => {
        it('follows the browser, unless the app says otherwise on an ancestor', () => {
            const {container} = render(
                div(
                    div({className: 'xh-chat--motion', item: span({className: 'full'})}),
                    div({className: 'xh-chat--reduced-motion', item: span({className: 'none'})}),
                    span({className: 'plain'})
                )
            );
            const el = (cls: string) => container.querySelector(`.${cls}`);

            stubReducedMotion(true);
            expect(isChatMotionReduced(el('plain'))).toBe(true);
            expect(isChatMotionReduced(el('full'))).toBe(false);

            stubReducedMotion(false);
            expect(isChatMotionReduced(el('plain'))).toBe(false);
            expect(isChatMotionReduced(el('none'))).toBe(true);
        });
    });

    describe('the input field', () => {
        it("follows the input's height, and eases only after its first measure", () => {
            const observers: Array<(entries: any[]) => void> = [];
            vi.stubGlobal(
                'ResizeObserver',
                class {
                    constructor(callback: (entries: any[]) => void) {
                        observers.push(callback);
                    }
                    observe() {}
                    unobserve() {}
                    disconnect() {}
                }
            );
            let height = 38;
            vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
                return this.tagName === 'TEXTAREA' ? height : 0;
            });
            const frames: FrameRequestCallback[] = [],
                raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
                    frames.push(cb);
                    return frames.length;
                });
            onTestFinished(() => raf.mockRestore());

            const {container} = render(composer(composerModel(mutableHost())));
            const field = container.querySelector<HTMLElement>('.xh-chat-composer__field');
            expect(field.style.height).toBe('38px');
            expect(field.classList).not.toContain('xh-chat-composer__field--animated');

            // The input's fitted height may land after the first measure. It never animates.
            height = 40;
            act(() => frames.forEach(it => it(0)));
            expect(field.style.height).toBe('40px');
            expect(field.classList).toContain('xh-chat-composer__field--animated');

            height = 78;
            const entry = {contentRect: {width: 400, height: 78}};
            act(() => observers.forEach(it => it([entry])));
            expect(field.style.height).toBe('78px');

            // Hidden, as in a hidden tab, the field drops its height rather than hold 0.
            height = 0;
            act(() => observers.forEach(it => it([entry])));
            expect(field.style.height).toBe('');
        });
    });

    describe('the empty layout', () => {
        it('settles its parts in sequence, and leaves the docked composer still', async () => {
            const model = new ChatModel({
                transport: new ScriptedChatTransport({responses: [textEvents('Hi.')], delayMs: 0})
            });
            onTestFinished(() => model.destroy());
            const {container} = render(
                chatPanel({
                    model,
                    emptyStateProps: {title: 'New chat', text: 'Ask anything.', footer: 'Note'},
                    suggestions: ['One']
                })
            );
            const indexOf = (selector: string) => {
                const el = container.querySelector(selector);
                if (!el.classList.contains('xh-chat-settle')) return null;
                const mod = Array.from(el.classList).find(it => /^xh-chat-settle--\d$/.test(it));
                return mod ? Number(mod.slice(-1)) : 0;
            };

            expect(indexOf('.xh-chat-empty-state__title')).toBe(0);
            expect(indexOf('.xh-chat-empty-state__text')).toBe(1);
            expect(indexOf('.xh-chat-panel__footer')).toBe(2);
            expect(indexOf('.xh-chat-panel__empty-tail')).toBe(3);
            // The suggestions come and go with the draft, so only the tail around them settles.
            expect(indexOf('.xh-chat-suggestions')).toBeNull();
            expect(indexOf('.xh-chat-panel__empty-tail .xh-chat-empty-state__footer')).toBeNull();

            await act(() => model.sendAsync('Hello'));
            expect(indexOf('.xh-chat-panel__footer')).toBeNull();
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

function stubReducedMotion(reduce: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener() {},
        removeEventListener() {}
    }));
}

// A host whose busy flag a test sets, as the chat sets its own. Tests re-render by hand.
function mutableHost(changes: {isBusy?: boolean} = {}) {
    return {isBusy: false, sendAsync: vi.fn(async () => {}), ...changes};
}

function composerModel(host: ChatComposerHost): ChatComposerModel {
    const ret = new ChatComposerModel({host});
    onTestFinished(() => ret.destroy());
    return ret;
}

function composer(model: ChatComposerModel, props = {}) {
    return chatComposer({model, startItems: span({className: 'app-mark'}), ...props});
}
