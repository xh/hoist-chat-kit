import {div, img, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {type ChatImagePolicy, isChatImageAllowed} from '../../../cmp/markdown';
import type {ChatFilePart} from '../../../core';
import '../../../styles/vars.scss';
import './ChatFileChip.scss';
import {formatFileSize} from './impl/ChatFormat';
import {classNames} from '../../../impl/ClassNames';

/** Props for {@link ChatFileChip}. */
export interface ChatFileChipProps extends HoistProps {
    /** The file to show. */
    file: ChatFilePart;

    /** Called when the user removes the file. Shows a remove button when provided. */
    onRemove?: (file: ChatFilePart) => void;

    /**
     * Images at a URL to load as a thumbnail. Default false, as loading one sends a request that
     * could leak data - see {@link ChatMarkdownProps.allowImages}. An image with inline `data`,
     * such as the user's own attachment, always shows.
     */
    allowImages?: ChatImagePolicy;
}

/**
 * A compact chip for a file attached to a message - a thumbnail for an image, otherwise an icon
 * for its type - with its name and size. An image at a URL shows a thumbnail only if
 * `allowImages` permits it. Shows a remove button when `onRemove` is provided, as in the
 * composer's attachment tray.
 */
export const [ChatFileChip, chatFileChip] = hoistCmp.withFactory<ChatFileChipProps>({
    displayName: 'ChatFileChip',
    model: false,
    className: 'xh-chat-file-chip',

    render({className, file, onRemove, allowImages = false}, ref) {
        const {name, mediaType, size} = file,
            previewSrc = getPreviewSrc(file, allowImages);

        return div({
            ref,
            className: classNames(className, {'xh-chat-file-chip--removable': !!onRemove}),
            title: name,
            items: [
                previewSrc
                    ? img({className: 'xh-chat-file-chip__thumb', src: previewSrc, alt: name})
                    : div({
                          className: 'xh-chat-file-chip__icon',
                          item: Icon.fileIcon({filename: name})
                      }),
                div({
                    className: 'xh-chat-file-chip__text',
                    items: [
                        span({className: 'xh-chat-file-chip__name', item: name}),
                        span({
                            className: 'xh-chat-file-chip__meta',
                            item: formatFileSize(size) ?? formatMediaType(mediaType)
                        })
                    ]
                }),
                onRemove
                    ? button({
                          className: 'xh-chat-file-chip__remove',
                          icon: Icon.x(),
                          tooltip: `Remove ${name}`,
                          'aria-label': `Remove ${name}`,
                          onClick: () => onRemove(file)
                      })
                    : null
            ]
        });
    }
});

//------------------
// Implementation
//------------------
function getPreviewSrc({mediaType, url, data}: ChatFilePart, allowImages: ChatImagePolicy): string {
    if (!mediaType?.startsWith('image/')) return null;
    if (data) return `data:${mediaType};base64,${data}`;
    return isChatImageAllowed(allowImages, url) ? url : null;
}

function formatMediaType(mediaType: string): string {
    return mediaType?.split('/').pop()?.toUpperCase() ?? null;
}
