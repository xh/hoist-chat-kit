import type {ReactElement} from 'react';
import {Icon} from '@xh/hoist/icon';

/**
 * Kit-wide settings - see {@link ChatKit.defaults}. A setting that belongs to one component sits
 * in that component's own `defaults` instead.
 */
export interface ChatKitDefaults {
    /**
     * Returns the icon that marks the assistant - in a reply's header, the empty state and the
     * helper button. Called for each use, so that each gets its own element. A component's
     * `assistantIcon` prop overrides it. Default `() => Icon.ai()`, Hoist's sparkles.
     */
    assistantIcon: () => ReactElement;

    /**
     * What a chat spinner does under reduced motion - when the browser reports
     * `prefers-reduced-motion: reduce`, or inside an element with class `xh-chat--reduced-motion`.
     *
     *  - `static` - a static icon replaces the spinner, inside chat only. The words and the
     *    ticking elapsed time still say the reply is busy.
     *  - `spin` - the spinner keeps spinning, as Hoist's own spinner always does. Suits apps used
     *    over Citrix, where sessions often report reduced motion.
     *
     * Default 'static'.
     */
    reducedMotionSpinner: 'static' | 'spin';

    /**
     * Milliseconds without data from the server - heartbeats included - after which a reply in
     * progress shows as stalled. A soft state: the reply keeps running, and the next byte clears
     * it. Set the transport's `idleTimeout`, the hard failure, longer than this.
     * `ChatModelConfig.stallAfterMs` overrides it for one chat. Default 30,000.
     */
    stallAfterMs: number;

    /**
     * Which steps of a reply the screen reader announcer reads, besides the finished reply:
     * none, only failures, or all. Default 'failures'.
     */
    announceSteps: 'none' | 'failures' | 'all';

    /**
     * Where the composer keeps its unsent draft - `local` storage, so a draft survives a reload,
     * or `memory` only. Default 'local'.
     */
    drafts: 'local' | 'memory';

    /** Key combos for the chat's keyboard shortcuts - see {@link ChatShortcuts}. */
    shortcuts: ChatShortcuts;
}

/**
 * Key combos for the chat's keyboard shortcuts, in the format of Hoist's `useHotkeys`, such as
 * `mod+shift+o`. Set an action to null to drop its shortcut.
 */
export interface ChatShortcuts {
    /** Start a new chat, in a workspace or dock. Default `mod+shift+o`. */
    newChat: string;

    /** Open or close the dock, page-wide, while a dock exists. Default `ctrl+.`. */
    toggleDock: string;

    /** Open the helper of the focused component. Default `mod+i`. */
    openHelper: string;

    /** Focus the composer, when focus is not in a text field. Default `/`. */
    focusComposer: string;

    /** Move focus to the next region, with Shift to go back. Default `f6`. */
    cycleRegions: string;

    /** Show or hide the thread sidebar of a workspace. Default null. */
    toggleSidebar: string;
}

/**
 * Settings that span the kit's components, as `static defaults`, after the pattern of Hoist's
 * `GridModel.defaults`. Set fields once at startup, in the app's `AppModel` or `Bootstrap.ts`:
 *
 * ```ts
 * ChatKit.defaults.stallAfterMs = 45_000;
 * ChatKit.defaults.shortcuts.newChat = null;
 * ```
 *
 * Instance config and component props always win over these defaults.
 */
export class ChatKit {
    /** Kit-wide settings - see {@link ChatKitDefaults}. */
    static defaults: ChatKitDefaults = {
        assistantIcon: () => Icon.ai(),
        reducedMotionSpinner: 'static',
        stallAfterMs: 30_000,
        announceSteps: 'failures',
        // Read by the composer's drafts and the keyboard map, which later work adds.
        // TODO(design-open B6) - local drafts, cleared on logout by `ChatKit.clearLocalData()`.
        drafts: 'local',
        // TODO(design-open B3) - shortcuts on by default, each one remappable or off.
        shortcuts: {
            newChat: 'mod+shift+o',
            toggleDock: 'ctrl+.',
            openHelper: 'mod+i',
            focusComposer: '/',
            cycleRegions: 'f6',
            toggleSidebar: null
        }
    };
}
