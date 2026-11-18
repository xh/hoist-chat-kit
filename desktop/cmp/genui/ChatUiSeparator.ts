import {hr} from '@xh/hoist/cmp/layout';
import type {ChatUiComponentSpec} from '../../../genui';
import type {ChatUiSpecOptions} from './Types';
import '../../../styles/vars.scss';
import './ChatUiSeparator.scss';

/** Props of a separator component. It takes none. */
export type ChatUiSeparatorSpecProps = Record<string, never>;

/**
 * A separator component for a {@link ChatUiCatalog}: a rule between two parts of a nested answer.
 * It renders Hoist's `hr` element, in the chat's border color. It adds no line to copied text.
 *
 * It has no tool or tag of its own. The model nests it in a document.
 */
export function chatUiSeparatorSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiSeparatorSpecProps> {
    const {name = 'separator', description = DESCRIPTION} = opts;

    return {
        name,
        description,
        props: {type: 'object', additionalProperties: false, properties: {}},
        standalone: false,
        render: () => hr({className: 'xh-chat-ui-separator'}),
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
