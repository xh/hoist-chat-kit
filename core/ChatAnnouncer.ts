import {HoistBase} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {findLast, last, without} from 'lodash';

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
 * assertive, which the desktop message list and composer render. Polite announcements come at
 * least 2 s apart, and those that wait meanwhile join into one. Assertive ones never wait.
 *
 * Each announcement shows in the regions of one component only, so that a screen reader reads it
 * once: the newest visible one when it is made. A component that mounts later never shows it, so
 * a remounted list does not read the last thread's words into the new one.
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
     * Register a component that renders the regions, while it is mounted.
     * @internal
     */
    attachRegions(host: ChatAnnouncerRegionHost) {
        this.regionHosts = [...without(this.regionHosts, host), host];
    }

    /** @internal */
    detachRegions(host: ChatAnnouncerRegionHost) {
        this.regionHosts = without(this.regionHosts, host);
    }

    /**
     * The announcement a host's region shows, or null - only one made while the host was the
     * newest visible host. (observable)
     * @internal
     */
    getRegionText(
        host: ChatAnnouncerRegionHost,
        politeness: ChatAnnouncePoliteness
    ): ChatAnnouncement {
        const target = politeness === 'polite' ? this.politeHost : this.assertiveHost;
        return target === host ? this[politeness] : null;
    }

    override destroy() {
        clearTimeout(this.politeTimer);
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private regionHosts: ChatAnnouncerRegionHost[] = [];
    @observableRef private accessor politeHost: ChatAnnouncerRegionHost = null;
    @observableRef private accessor assertiveHost: ChatAnnouncerRegionHost = null;
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
        const host = text ? this.findRegionHost() : null;
        if (region === 'polite') {
            this.politeHost = host;
        } else {
            this.assertiveHost = host;
        }
    }

    // The newest host that is visible, else the newest - a page may hide an older chat in a tab.
    private findRegionHost(): ChatAnnouncerRegionHost {
        const {regionHosts} = this;
        return findLast(regionHosts, it => it.isVisible()) ?? last(regionHosts) ?? null;
    }
}

/**
 * A component that renders the announcer's regions - see {@link ChatAnnouncer.attachRegions}.
 * @internal
 */
export interface ChatAnnouncerRegionHost {
    /** True if the regions are on screen, rather than in a hidden tab or a collapsed panel. */
    isVisible(): boolean;
}

/** The kit's announcer - see {@link ChatAnnouncer}. */
export const chatAnnouncer = new ChatAnnouncer();
