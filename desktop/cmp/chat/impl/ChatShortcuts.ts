import type {PanelProps} from '@xh/hoist/desktop/cmp/panel';
import {ChatKit, type ChatShortcuts} from '../../../../core';

/**
 * A hotkey, in the config format of Hoist's `useHotkeys` and Panel `hotkeys`.
 * @internal
 */
export type ChatHotkeyConfig = NonNullable<PanelProps['hotkeys']>[number];

/**
 * What each shortcut does where it is bound. An action left out has no binding there.
 * @internal
 */
export interface ChatShortcutHandlers {
    newChat?: () => void;
    focusComposer?: () => void;
    cycleRegions?: (back: boolean) => void;
    toggleSidebar?: () => void;
}

/**
 * Hotkeys for the given actions, keyed from `ChatKit.defaults.shortcuts`, for a component to bind
 * with Hoist's `useHotkeys` or a Panel's `hotkeys`. An action set to null there gets none.
 *
 * Each handler runs once per key press: it skips an event that an inner element already handled
 * - as a chat panel handles `/` before the workspace around it - and marks the event handled.
 * `focusComposer` waits while focus is in a text field, where `/` types a slash. The rest work
 * from anywhere in the component. No shortcut ever approves, applies or deletes.
 *
 * @internal
 */
// TODO(design-open B3) - shortcuts on by default, each one remappable or null in `ChatKit.defaults`.
// TODO(P7): bind `toggleDock` page-wide once the dock exists, and `openHelper` in components with
// a helper.
export function getChatHotkeys(handlers: ChatShortcutHandlers): ChatHotkeyConfig[] {
    const {shortcuts} = ChatKit.defaults,
        ret: ChatHotkeyConfig[] = [],
        add = (action: keyof ChatShortcuts, combo: string, run: () => void, label: string) => {
            if (!combo) return;
            ret.push({
                combo,
                label,
                group: 'Chat',
                allowInInput: action !== 'focusComposer',
                onKeyDown: (e: KeyboardEvent) => {
                    if (e.defaultPrevented) return;
                    e.preventDefault();
                    run();
                }
            });
        },
        {newChat, focusComposer, cycleRegions, toggleSidebar} = handlers;

    if (newChat) add('newChat', shortcuts.newChat, newChat, 'Start a new chat');
    if (focusComposer) {
        add('focusComposer', shortcuts.focusComposer, focusComposer, 'Focus the composer');
    }
    if (cycleRegions) {
        const combo = shortcuts.cycleRegions;
        add('cycleRegions', combo, () => cycleRegions(false), 'Next region');
        // Shift goes back, unless the combo already holds it.
        if (combo && !/(^|\+)\s*shift\s*(\+|$)/i.test(combo)) {
            add('cycleRegions', `shift+${combo}`, () => cycleRegions(true), 'Previous region');
        }
    }
    if (toggleSidebar) {
        add('toggleSidebar', shortcuts.toggleSidebar, toggleSidebar, 'Show or hide the sidebar');
    }
    return ret;
}

/**
 * A region that F6 moves focus to: its root, and where in it focus lands.
 * @internal
 */
export interface ChatRegion {
    /** Selector for the region's root, within the component. */
    selector: string;

    /** Selector for the element to focus first, within the root. Else the first tabbable. */
    focusSelector?: string;
}

/**
 * Move focus to the next region present, or the previous with `back`, wrapping around. From
 * outside every region, forward starts at the first and back at the last.
 * @internal
 */
export function cycleChatRegions(root: HTMLElement, regions: ChatRegion[], back: boolean) {
    if (!root) return;
    const present = regions
        .map(region => ({region, el: root.querySelector<HTMLElement>(region.selector)}))
        .filter(it => it.el);
    if (!present.length) return;

    const active = document.activeElement,
        current = present.findIndex(it => it.el.contains(active)),
        count = present.length,
        next = current < 0 ? (back ? count - 1 : 0) : (current + (back ? count - 1 : 1)) % count,
        {region, el} = present[next],
        target =
            (region.focusSelector && el.querySelector<HTMLElement>(region.focusSelector)) ??
            el.querySelector<HTMLElement>(TABBABLE) ??
            el;
    target.focus();
}

//------------------
// Implementation
//------------------
const TABBABLE = [
    'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'button:not([disabled])',
    'select:not([disabled])',
    'a[href]',
    '[tabindex="0"]'
].join(', ');
