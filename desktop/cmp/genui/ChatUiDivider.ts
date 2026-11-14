import {hr} from '@xh/hoist/cmp/layout';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiSpecOptions} from './Types';
import './ChatUiDivider.scss';

/** Props of a divider component. It takes none. */
export type ChatUiDividerSpecProps = Record<string, never>;

/**
 * A divider component for a {@link ChatUiCatalog}: a rule between two parts of a nested answer.
 * It renders Hoist's `hr` element, in the chat's border color. It adds no line to copied text.
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
        props: {type: 'object', additionalProperties: false, properties: {}},
        standalone: false,
        render: () => hr({className: 'xh-chat-ui-divider'}),
        result: () => '',
        example: {}
    };
}

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A rule between two parts of an answer. Use it in a column to set apart groups that have no ' +
    'titles of their own. It takes no props.';
