import {type FieldModel, form, FormModel} from '@xh/hoist/cmp/form';
import {creates, hoistCmp, HoistModel, type HoistProps, type PlainObject, XH} from '@xh/hoist/core';
import type {RuleLike} from '@xh/hoist/data';
import {formField} from '@xh/hoist/desktop/cmp/form';
import {action, observableRef} from '@xh/hoist/mobx';
import {identity, isEqual} from 'lodash';
import type {ReactElement} from 'react';
import type {ChatUiRenderContext} from '../../../../genui';
import {type ChatUiFormField, ChatUiFormModel} from './ChatUiFormModel';
import './ChatUiField.scss';

/** Props for {@link chatUiField}. */
export interface ChatUiFieldProps extends HoistProps<ChatUiFieldModel> {
    /** Name of the field, as the model wrote it. */
    name: string;

    /** Label shown over the input, and the field's name in a validation message. */
    label?: string;

    /** True to show no label over the input, for an input that draws its own. */
    hideLabel?: boolean;

    /** The validation rules, as the model wrote them. */
    rules?: PlainObject;

    /** Turns the model's rules into Hoist rules. A function that does not change between renders. */
    toRules?: (rules: PlainObject) => RuleLike[];

    /** The value, as plain JSON - the state prop of the component. */
    value?: unknown;

    /** The Hoist input's value for a JSON value, such as a `LocalDate` for a date string. */
    toInput?: (value: unknown) => unknown;

    /** The JSON value for a Hoist input's value. */
    fromInput?: (value: unknown) => unknown;

    /** Writes the value - the render context's `setProp`. */
    setProp: ChatUiRenderContext['setProp'];

    /** The Hoist input. The field binds it, so it takes no `value`, `bind` or `model`. */
    children?: ReactElement;
}

/**
 * One field of generative UI: a Hoist input in a Hoist `FormField`, bound to a state prop. The
 * `FormField` draws the label, the mark of a required field and the validation message, and a
 * `FieldModel` holds the value and runs the rules. Inside a generative UI form, the field
 * registers with it, so that the form's buttons validate and send it.
 * @internal
 */
export const chatUiField = hoistCmp.factory<ChatUiFieldProps>({
    displayName: 'ChatUiField',
    model: creates(() => new ChatUiFieldModel(), {publishMode: 'none'}),
    className: 'xh-chat-ui-field',

    render({model, className, label, hideLabel, children}) {
        const {formModel} = model;
        if (!formModel) return null;
        return form({
            model: formModel,
            item: formField({
                className,
                field: VALUE,
                label: hideLabel ? null : (label ?? null),
                item: children
            })
        });
    }
});

/**
 * Holds one field for the life of its input. Hoist's `FormModel` takes its fields and their
 * rules when it is created, so this owns a `FormModel` of one field, and builds a new one when
 * the name, label or rules change, as they do while the props stream. It keeps the field and the
 * state prop in step: a value the state gives re-initializes the field, and a value the user
 * commits goes to the state.
 * @internal
 */
export class ChatUiFieldModel extends HoistModel implements ChatUiFormField {
    override xhImpl = true;

    @observableRef accessor formModel: FormModel = null;

    private chatForm: ChatUiFormModel = null;

    get name(): string {
        return this.props.name;
    }

    get fieldModel(): FieldModel {
        return this.formModel?.fields[VALUE] as FieldModel;
    }

    /** The field's value as plain JSON. */
    get value(): unknown {
        return this.toJson(this.fieldModel?.value);
    }

    override onLinked() {
        this.chatForm = this.lookupModel(ChatUiFormModel);
        this.chatForm?.register(this);

        this.addReaction(
            {
                track: () => {
                    const {name, label, rules} = this.props;
                    return {name, label, rules};
                },
                run: () => this.createFormModel(),
                equals: 'structural',
                fireImmediately: true
            },
            {
                // The state changed, as on a reset or a write from another input.
                track: () => this.props.value,
                run: value => {
                    const next = this.toInput(value);
                    if (!isEqual(next, this.fieldModel.value)) this.fieldModel.init(next);
                },
                equals: 'structural'
            },
            {
                // The user committed a value.
                track: () => this.fieldModel?.value,
                run: () => {
                    const {value} = this,
                        {value: current = null, setProp} = this.props;
                    if (!isEqual(value, current)) setProp(VALUE, value);
                }
            }
        );
    }

    override destroy() {
        this.chatForm?.unregister(this);
        XH.safeDestroy(this.formModel);
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private get props(): ChatUiFieldProps {
        return this.componentProps as ChatUiFieldProps;
    }

    @action
    private createFormModel() {
        const {name, label, rules, toRules, value} = this.props,
            previous = this.formModel;
        this.formModel = new FormModel({
            fields: [
                {
                    name: VALUE,
                    displayName: label || name,
                    initialValue: this.toInput(value),
                    rules: toRules?.(rules ?? {}) ?? []
                }
            ],
            xhImpl: true
        });
        XH.safeDestroy(previous);
    }

    private toInput(value: unknown): unknown {
        return (this.props.toInput ?? identity)(value ?? null) ?? null;
    }

    private toJson(value: unknown): unknown {
        return (this.props.fromInput ?? identity)(value ?? null) ?? null;
    }
}

// Name of the one field of each field's FormModel, and of the state prop it mirrors.
const VALUE = 'value';
