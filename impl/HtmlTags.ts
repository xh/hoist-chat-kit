import {elementFactory} from '@xh/hoist/core';

/**
 * Element factory for a native `button`, which Hoist's layout tags do not include. For compact
 * controls inside text, such as citation chips, where a Hoist button would be too heavy.
 * @internal
 */
export const htmlButton = elementFactory('button');

/** Element factory for a native `mark`, for a highlighted span of text. @internal */
export const htmlMark = elementFactory('mark');

/** Element factory for a native `caption`, for a table's accessible name. @internal */
export const htmlCaption = elementFactory('caption');
