import {HoistBase} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {last} from 'lodash';

/**
 * How urgently a screen reader reads an announcement - see {@link ChatAnnouncer.announce}.
 *
 *  - `polite` - after what it is reading now. For finished replies, warnings and confirmations.
 *  - `assertive` - at once, interrupting. For failures only.
 */
export type ChatAnnouncePoliteness = 'polite' | 'assertive';

/** One announcement in a live region - see {@link ChatAnnouncer}. */
export interface ChatAnnouncement {
    /** Unique per announcement, so that a region re-renders text that repeats. */
    id: number;

    /** The text to read. */
    text: string;
}

/**
 * The kit's one voice for screen readers - use the `chatAnnouncer` singleton. Chat components
 * never speak through live regions of their own: the message list is `role="log"` with
 * `aria-live="off"`, and every announcement goes through here, so they stay spaced and in order.
 *
 * The announcer holds the text of two visually hidden live regions, one polite and one
 * assertive, which the desktop message list renders. Polite announcements come at least 2 s
 * apart, and those that wait meanwhile join into one. Assertive ones never wait.
 *
 * Announce what the user needs to know once: a reply that finished, a tool call that needs
 * approval, a failure. Never announce tokens, status words, elapsed time or countdowns.
 */
export class ChatAnnouncer extends HoistBase {
    /** Least time between two polite announcements, in milliseconds. */
    static readonly POLITE_GAP_MS = 2000;

    /** Text of the polite region, or null. (observable) */
    @observableRef accessor polite: ChatAnnouncement = null;

    /** Text of the assertive region, or null. (observable) */
    @observableRef accessor assertive: ChatAnnouncement = null;

    /**
     * Read text to screen reader users. Blank text is ignored.
     *
     * @param politeness - default 'polite'.
     */
    announce(text: string, politeness: ChatAnnouncePoliteness = 'polite') {
        text = text?.trim();
        if (!text) return;

        if (politeness === 'assertive') {
            this.setRegion('assertive', text);
            return;
        }
        if (last(this.pendingPolite) !== text) this.pendingPolite.push(text);
        this.schedulePolite();
    }

    /** Drop waiting announcements and empty both regions. */
    clear() {
        clearTimeout(this.politeTimer);
        this.politeTimer = null;
        this.pendingPolite = [];
        this.lastPoliteAt = null;
        this.setRegion('polite', null);
        this.setRegion('assertive', null);
    }

    /**
     * Register a component that renders the regions. When several are mounted, only the first
     * renders text, so that a screen reader hears each announcement once.
     * @internal
     */
    @action
    attachRegions(host: object) {
        this.regionHosts = [...this.regionHosts, host];
    }

    /** @internal */
    @action
    detachRegions(host: object) {
        this.regionHosts = this.regionHosts.filter(it => it !== host);
    }

    /**
     * True if the host should render the regions' text. (observable)
     * @internal
     */
    isRegionHost(host: object): boolean {
        return this.regionHosts[0] === host;
    }

    override destroy() {
        clearTimeout(this.politeTimer);
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    @observableRef private accessor regionHosts: object[] = [];
    private pendingPolite: string[] = [];
    private lastPoliteAt: number = null;
    private politeTimer: ReturnType<typeof setTimeout> = null;
    private nextId = 1;

    private schedulePolite() {
        if (this.politeTimer) return;

        const wait =
            this.lastPoliteAt == null
                ? 0
                : this.lastPoliteAt + ChatAnnouncer.POLITE_GAP_MS - Date.now();
        if (wait <= 0) {
            this.flushPolite();
        } else {
            this.politeTimer = setTimeout(() => {
                this.politeTimer = null;
                this.flushPolite();
            }, wait);
        }
    }

    private flushPolite() {
        const text = this.pendingPolite.join(' ');
        this.pendingPolite = [];
        this.lastPoliteAt = Date.now();
        this.setRegion('polite', text);
    }

    @action
    private setRegion(region: ChatAnnouncePoliteness, text: string) {
        this[region] = text ? {id: this.nextId++, text} : null;
    }
}

/** The kit's announcer - see {@link ChatAnnouncer}. */
export const chatAnnouncer = new ChatAnnouncer();
