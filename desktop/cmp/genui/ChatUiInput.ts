import type {ChatUiComponentSpec} from '../../../genui';
import {chatUiButtonSpec} from './ChatUiButton';
import {chatUiCheckboxSpec} from './ChatUiCheckbox';
import {chatUiDateInputSpec} from './ChatUiDateInput';
import {chatUiFormSpec} from './ChatUiForm';
import {chatUiNumberInputSpec} from './ChatUiNumberInput';
import {chatUiRadioInputSpec} from './ChatUiRadioInput';
import {chatUiSegmentedControlSpec} from './ChatUiSegmentedControl';
import {chatUiSelectSpec} from './ChatUiSelect';
import {chatUiSliderSpec} from './ChatUiSlider';
import {chatUiSwitchSpec} from './ChatUiSwitch';
import {chatUiTextAreaSpec} from './ChatUiTextArea';
import {chatUiTextInputSpec} from './ChatUiTextInput';

/** Props that every built-in input takes, as written by the model. */
export interface ChatUiInputSpecProps<V = unknown> {
    /**
     * Name of the field, unique in its form. The key of its value among those a form sends.
     */
    name: string;

    /** Label shown with the input. Default none. */
    label?: string;

    /** Validation rules, shown as messages beside the input. */
    rules?: ChatUiInputRules;

    /**
     * The value. A state prop: the document's state holds it where the model binds it, such as
     * to an OpenUI `$variable`, and the input keeps it otherwise.
     */
    value?: V;
}

/**
 * Validation rules of a built-in input, as written by the model. Each input takes the rules that
 * suit its value, and runs them as Hoist rules on a `FieldModel`.
 */
export interface ChatUiInputRules {
    /** True if the user must give a value. */
    required?: boolean;

    /** True if the text must be an email address. */
    email?: boolean;

    /** Fewest characters of text. */
    minLength?: number;

    /** Most characters of text. At most 100, the most that an action can send. */
    maxLength?: number;

    /** Least number, or earliest date as `YYYY-MM-DD`. */
    min?: number | string;

    /** Greatest number, or latest date as `YYYY-MM-DD`. */
    max?: number | string;
}

/** A choice of a select, a segmented control or a radio input, as written by the model. */
export interface ChatUiOption {
    /** What the choice stores. */
    value: string | number;

    /** What the choice shows. Default the value. */
    label?: string;
}

/**
 * The built-in form components, for a {@link ChatUiCatalog}: a form, a button, and an input of
 * each kind. Each is a spec over a Hoist component, with its default name. For other names or
 * limits, list the specs one by one.
 *
 * ```ts
 * const catalog = new ChatUiCatalog({
 *     components: [chatUiStackSpec(), chatUiTextSpec(), ...chatUiInputSpecs()],
 *     modes: ['document']
 * });
 * ```
 */
export function chatUiInputSpecs(): ChatUiComponentSpec<any>[] {
    return [
        chatUiFormSpec(),
        chatUiButtonSpec(),
        chatUiTextInputSpec(),
        chatUiTextAreaSpec(),
        chatUiNumberInputSpec(),
        chatUiSelectSpec(),
        chatUiDateInputSpec(),
        chatUiCheckboxSpec(),
        chatUiSwitchSpec(),
        chatUiSegmentedControlSpec(),
        chatUiRadioInputSpec(),
        chatUiSliderSpec()
    ];
}
