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
        this.active = true;
        document.body.classList.add(CLS);
    }

    @action
    end() {
        this.active = false;
        document.body.classList.remove(CLS);
    }
}

export const layoutGesture = new LayoutGesture();
