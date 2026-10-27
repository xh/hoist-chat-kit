import type {ReactNode} from 'react';
import {details, div, li, pre, summary, ul} from '@xh/hoist/cmp/layout';
import type {ChatUiFallbackSpec, ChatUiPlaceholderSpec} from './ChatUiComponentSpec';
import '../styles/vars.scss';
import './ChatUiFallback.scss';

/**
 * The default fallback element: a caption, with what went wrong and the input the model wrote
 * behind a "View input" disclosure. A catalog's own `fallback` can render this for the cases it
 * does not handle itself.
 */
export function chatUiFallback({caption, errors, input}: ChatUiFallbackSpec): ReactNode {
    return div({
        className: 'xh-chat-ui-fallback',
        role: 'note',
        items: [
            div({className: 'xh-chat-ui-fallback__caption', item: caption}),
            details({
                className: 'xh-chat-ui-fallback__details',
                items: [
                    summary('View input'),
                    errors.length ? ul(errors.map((it, idx) => li({key: idx, item: it}))) : null,
                    input != null ? pre(formatInput(input)) : null
                ]
            })
        ]
    });
}

/** The default placeholder, for a component still streaming in - "Building chart…". */
export function chatUiPlaceholder({displayName}: ChatUiPlaceholderSpec): ReactNode {
    return div({
        className: 'xh-chat-ui-placeholder',
        role: 'status',
        item: displayName ? `Building ${displayName.toLowerCase()}…` : 'Building…'
    });
}

//------------------
// Implementation
//------------------
function formatInput(input: unknown): string {
    if (typeof input === 'string') return input;
    try {
        return JSON.stringify(input, null, 2);
    } catch (ignored) {
        return String(input);
    }
}
