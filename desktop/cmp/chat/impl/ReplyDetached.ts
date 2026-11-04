import {createContext} from 'react';
import {elementFactory} from '@xh/hoist/core';

/**
 * True inside a reply left running on the server - see `ChatReplyStatus` `detached`. Its open
 * tool calls show as not finished yet, rather than as running, as the chat no longer follows them.
 * A context rather than a prop, so that each part's memoized render need not take the message.
 * @internal
 */
export const ReplyDetachedContext = createContext(false);

/** @internal */
export const replyDetachedProvider = elementFactory(ReplyDetachedContext.Provider);
