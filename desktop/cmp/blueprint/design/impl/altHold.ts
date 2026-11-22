import {action, observable} from '@xh/hoist/mobx';

const CLS = 'xh-blueprint-alt-hold';

/**
 * Alt held while designing in Edit: the next click passes through to the widget, as in Interact.
 * One click only: a pass-through uses the hold up until Alt is pressed again. While it is active,
 * the page shows the pointer cursor over elements, and hover outlines hide.
 */
class AltHold {
    @observable accessor active = false;

    /** Follow Alt on the page while a designer is open. Returns a function that stops. */
    follow(): () => void {
        if (!this.followers++) {
            window.addEventListener('keydown', this.onKeyDown, true);
            window.addEventListener('keyup', this.onKeyUp, true);
            window.addEventListener('blur', this.release);
        }
        return () => {
            if (--this.followers) return;
            window.removeEventListener('keydown', this.onKeyDown, true);
            window.removeEventListener('keyup', this.onKeyUp, true);
            window.removeEventListener('blur', this.release);
            this.release();
        };
    }

    /** Use the hold up for the click that passed through. */
    consume() {
        this.release();
    }

    //------------------
    // Implementation
    //------------------
    private followers = 0;

    private onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Alt' && !e.repeat) this.set(true);
    };

    private onKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') this.release();
    };

    private release = () => this.set(false);

    @action
    private set(active: boolean) {
        if (this.active === active) return;
        this.active = active;
        document.body.classList.toggle(CLS, active);
    }
}

export const altHold = new AltHold();
