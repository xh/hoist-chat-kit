import {separator} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {isString} from 'lodash';
import {useContext} from 'react';
import type {ChatUiComponentSpec} from '../../../genui';
import {ChatUiStackDirection} from './impl/ChatUiStackDirection';
import type {ChatUiSpecOptions} from './Types';
import '../../../styles/vars.scss';
import './ChatUiDivider.scss';

/** Props of a divider component, as written by the model. */
export interface ChatUiDividerSpecProps {
    /** Caption shown within the rule, such as the name of the part that follows. Default none. */
    label?: string;
}

/**
 * A divider component for a {@link ChatUiCatalog}: a rule between two parts of a nested answer.
 * It renders Hoist's `Separator`, in the chat's border color, with an optional `label` within the
 * rule. In a row stack it stands as a vertical rule, with no label. Copied text holds its label
 * only.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiDividerSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiDividerSpecProps> {
    const {name = 'divider', description = DESCRIPTION} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            additionalProperties: false,
            properties: {
                label: {type: 'string', maxLength: 60, description: 'Caption within the rule.'}
            }
        },
        standalone: false,
        render: ({label}) => chatUiDivider({label: isString(label) && label.trim() ? label : null}),
        result: ({label}) => label ?? '',
        example: {}
    };
}

//------------------
// Implementation
//------------------
// A Separator across a column, or up a row, as the stack around it runs.
const chatUiDivider = hoistCmp.factory<HoistProps & {label: string}>({
    displayName: 'ChatUiDivider',
    model: false,
    observer: false,

    render({label}) {
        const direction = useContext(ChatUiStackDirection);
        return separator({
            className: 'xh-chat-ui-divider',
            orientation: direction === 'row' ? 'vertical' : 'horizontal',
            label
        });
    }
});

const DESCRIPTION =
    'A rule between two parts of an answer, with an optional label. Use it in a column to set ' +
    'apart groups that have no titles of their own.';
