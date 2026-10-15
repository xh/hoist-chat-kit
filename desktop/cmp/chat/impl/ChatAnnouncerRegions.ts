import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {useEffect, useRef, useState} from 'react';
import {type ChatAnnouncement, chatAnnouncer, type ChatAnnouncerRegionHost} from '../../../../core';
import './ChatAnnouncerRegions.scss';

/**
 * The two visually hidden live regions of the kit's announcer, one polite and one assertive. The
 * message list and the composer render them, so that a layout with either one speaks. Each
 * announcement fills the regions of one mounted instance only, the newest visible one when it is
 * made, so that a screen reader hears it once.
 * @internal
 */
export const chatAnnouncerRegions = hoistCmp.factory<HoistProps>({
    displayName: 'ChatAnnouncerRegions',
    model: false,
    className: 'xh-chat-announcer',

    render({className}) {
        // A token for this instance, registered while mounted.
        const ref = useRef<HTMLDivElement>(null),
            [host] = useState<ChatAnnouncerRegionHost>(() => ({
                isVisible: () => isVisible(ref.current)
            }));
        useEffect(() => {
            chatAnnouncer.attachRegions(host);
            return () => chatAnnouncer.detachRegions(host);
        }, [host]);

        return div({
            ref,
            className,
            items: [
                region('polite', chatAnnouncer.getRegionText(host, 'polite')),
                region('assertive', chatAnnouncer.getRegionText(host, 'assertive'))
            ]
        });
    }
});

//------------------
// Implementation
//------------------
// The region stays mounted, and its text is keyed by announcement, so that a repeat of the same
// words still changes the region - which is what makes a screen reader read it.
function region(politeness: 'polite' | 'assertive', announcement: ChatAnnouncement) {
    return div({
        key: politeness,
        className: `xh-chat-announcer__${politeness}`,
        role: politeness === 'assertive' ? 'alert' : 'status',
        'aria-live': politeness,
        'aria-atomic': true,
        item: announcement ? div({key: announcement.id, item: announcement.text}) : null
    });
}

// Hidden by an ancestor - an inactive tab, a collapsed panel - or not in the page.
function isVisible(el: HTMLElement): boolean {
    if (!el?.isConnected) return false;
    return el.checkVisibility ? el.checkVisibility() : true;
}
