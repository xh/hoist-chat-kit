import type {WheelEvent} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import type {ChatModel} from '../../../../core';
import {ChatMessageListLocalModel} from './ChatMessageListLocalModel';

/**
 * The message list's stick-to-bottom rules. Apps rely on a streaming reply staying in view, on a
 * scroll up releasing the list so the user can read back, and on a return to the bottom sticking
 * it again.
 */
describe('ChatMessageListLocalModel', () => {
    beforeAll(() => initTestAppAsync());

    it('follows content that grows while a reply streams', () => {
        const {model, el} = createList({isBusy: true});
        el.grow(500);
        model.onContentResize();
        expect(el.distanceFromBottom).toBe(0);
    });

    it('does not follow content that grows when no reply streams', () => {
        const {model, el} = createList({isBusy: false});
        el.grow(500);
        model.onContentResize();
        expect(el.distanceFromBottom).toBe(500);
    });

    it('stops following once the user wheels up, and shows the scroll button', () => {
        const {model, el} = createList({isBusy: true});
        model.onWheel(wheelUp());
        el.scrollBy(-200);
        model.onScroll();
        el.grow(300);
        model.onContentResize();

        expect(model.isSticky).toBe(false);
        expect(el.distanceFromBottom).toBe(500);
        expect(model.isAtBottom).toBe(false);
    });

    it('keeps following after a wheel up when the content does not yet overflow', () => {
        const {model, el} = createList({isBusy: true, contentHeight: 300});
        model.onWheel(wheelUp());
        el.grow(900);
        model.onContentResize();

        expect(model.isSticky).toBe(true);
        expect(el.distanceFromBottom).toBe(0);
    });

    it('sticks again when the user scrolls back to the bottom', () => {
        const {model, el} = createList({isBusy: true});
        model.onWheel(wheelUp());
        el.scrollBy(-200);
        model.onScroll();
        el.scrollBy(196);
        model.onScroll();

        expect(model.isSticky).toBe(true);
        expect(model.isAtBottom).toBe(true);
    });

    it('jumps to the bottom on scrollToBottom, and sticks', () => {
        const {model, el} = createList({isBusy: false});
        el.scrollBy(-400);
        model.onScroll();
        model.scrollToBottom();

        expect(el.distanceFromBottom).toBe(0);
        expect(model.isSticky).toBe(true);
    });
});

//------------------
// Helpers
//------------------
/** A scroll container with a fixed viewport height, starting scrolled to the bottom. */
class FakeViewport {
    clientHeight = 400;
    scrollHeight: number;
    scrollTop: number;

    constructor(contentHeight: number) {
        this.scrollHeight = contentHeight;
        this.scrollTop = Math.max(0, contentHeight - this.clientHeight);
    }

    get distanceFromBottom(): number {
        return this.scrollHeight - this.scrollTop - this.clientHeight;
    }

    grow(px: number) {
        this.scrollHeight += px;
    }

    scrollBy(px: number) {
        this.scrollTo({top: this.scrollTop + px});
    }

    scrollTo({top}: {top: number}) {
        this.scrollTop = Math.min(
            Math.max(0, top),
            Math.max(0, this.scrollHeight - this.clientHeight)
        );
    }
}

function createList({isBusy, contentHeight = 1000}: {isBusy: boolean; contentHeight?: number}) {
    const model = new ChatMessageListLocalModel(),
        el = new FakeViewport(contentHeight);
    onTestFinished(() => model.destroy());
    model.chatModel = {isBusy, messages: []} as ChatModel;
    model.viewportRef(el as unknown as HTMLDivElement);
    return {model, el};
}

function wheelUp(): WheelEvent {
    return {deltaY: -100} as WheelEvent;
}
