import {formFieldSet} from '@xh/hoist/cmp/form';
import {creates, hoistCmp, type HoistProps} from '@xh/hoist/core';
import type {ChatUiComponentSpec} from '../../../genui';
import {ChatUiFormModel} from './impl/ChatUiFormModel';
import {inColumn} from './impl/ChatUiStackDirection';
import type {ChatUiSpecOptions} from './Types';
import './ChatUiForm.scss';

/** Props of a {@link ChatUiForm}, as written by the model. */
export interface ChatUiFormSpecProps {
    /** Title of the form, shown in its header. Default none. */
    title?: string;
}

/**
 * A form container for a {@link ChatUiCatalog}: groups inputs and buttons, over Hoist's
 * `FormFieldSet`. Its children are the built-in inputs, the buttons that submit them, and any
 * layout around them.
 *
 * A button inside the form submits it. The click validates every field, and shows each message
 * beside its input. The set takes the color of the worst problem, as a Hoist `FormFieldSet`
 * does. If all fields are valid, the button's action runs, and a `send` carries the value of
 * each field in its `context`, by field name.
 *
 * It shows only inside a nested answer, so it has no tool or tag of its own.
 */
export function chatUiFormSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiFormSpecProps> {
    const {name = 'form', description = DESCRIPTION} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120, description: 'Title of the form.'}
            }
        },
        slots: ['default'],
        standalone: false,
        render: ({title}, {children}) => inColumn(chatUiForm({title, items: children})),
        result: ({title}) => title ?? '',
        example: {title: 'Contact details'}
    };
}

/** Props for {@link ChatUiForm}. */
export interface ChatUiFormProps extends HoistProps<ChatUiFormModel>, ChatUiFormSpecProps {}

/**
 * A group of inputs and the buttons that submit them - the component that
 * {@link chatUiFormSpec} renders, over Hoist's `FormFieldSet`. Each built-in input inside it
 * registers its field, and each {@link ChatUiButton} inside it validates the fields before its
 * action runs. It fills the width it is given, and each field fills the form.
 */
export const [ChatUiForm, chatUiForm] = hoistCmp.withFactory<ChatUiFormProps>({
    displayName: 'ChatUiForm',
    model: creates(ChatUiFormModel),
    className: 'xh-chat-ui-form',

    render({className, title, children}) {
        return formFieldSet({className, title, items: children});
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A form: a group of inputs with the buttons that submit them. Put the inputs and at least ' +
    'one button in its children. A click on a button checks every input first. Hold at most 8 ' +
    'inputs, as a message carries at most 8 values.';
