import {action, observable} from '@xh/hoist/mobx';
import './gesture.scss';

const CLS = 'xh-layout-gesture';

/**
 * Whether a pointer gesture over a layout is under way: a move or resize of a canvas cell, or a
 * drag of a dock view. While one is, the page selects no text, and an overlay can hold back marks
 * that would follow the pointer or cover the gesture, such as a hover outline.
 */
class LayoutGesture {
    @observable accessor active = false;

    @action
    start() {
        if (!this.active)
            SAFETY_NET.forEach(type => window.addEventListener(type, this.onWindow, true));
        this.active = true;
        document.body.classList.add(CLS);
    }

    @action
    end() {
        SAFETY_NET.forEach(type => window.removeEventListener(type, this.onWindow, true));
        this.active = false;
        document.body.classList.remove(CLS);
    }

    // A gesture never outlives its pointer, though a path that starts one fails to end it.
    private onWindow = (e: Event) => {
        if (e.type !== 'keydown' || (e as KeyboardEvent).key === 'Escape') this.end();
    };
}

const SAFETY_NET = ['pointerup', 'dragend', 'blur', 'keydown'];

export const layoutGesture = new LayoutGesture();
