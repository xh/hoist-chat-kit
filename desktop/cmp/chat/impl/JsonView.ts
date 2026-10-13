import {isString} from 'lodash';
import {pre} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import '../../../../styles/vars.scss';
import './JsonView.scss';

interface JsonViewProps extends HoistProps {
    /** Value to show - strings as is, anything else as indented JSON. */
    value: unknown;
}

/**
 * Compact, scrollable view of a JSON value, for tool inputs and outputs and unrendered data parts.
 * @internal
 */
export const jsonView = hoistCmp.factory<JsonViewProps>({
    displayName: 'ChatJsonView',
    model: false,
    observer: false,
    className: 'xh-chat-json',

    render({className, value}) {
        return pre({className, item: formatJson(value)});
    }
});

function formatJson(value: unknown): string {
    if (isString(value)) return value;
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch (ignored) {
        return String(value);
    }
}
