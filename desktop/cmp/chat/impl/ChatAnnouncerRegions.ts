import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {useEffect, useState} from 'react';
import {type ChatAnnouncement, chatAnnouncer} from '../../../../core';
import './ChatAnnouncerRegions.scss';

/**
 * The two visually hidden live regions of the kit's announcer, one polite and one assertive. The
 * message list renders them. When several lists are mounted, only the first fills its regions, so
 * a screen reader hears each announcement once.
 * @internal
 */
export const chatAnnouncerRegions = hoistCmp.factory<HoistProps>({
    displayName: 'ChatAnnouncerRegions',
    model: false,
    className: 'xh-chat-announcer',

    render({className}) {
        // A token for this instance, registered while mounted.
        const [host] = useState(() => ({})),
            isHost = chatAnnouncer.isRegionHost(host);
        useEffect(() => {
            chatAnnouncer.attachRegions(host);
            return () => chatAnnouncer.detachRegions(host);
        }, [host]);

        return div({
            className,
            items: [
                region('polite', isHost ? chatAnnouncer.polite : null),
                region('assertive', isHost ? chatAnnouncer.assertive : null)
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
