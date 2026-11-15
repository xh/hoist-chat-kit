import {type FieldModel, form, FormModel} from '@xh/hoist/cmp/form';
import {creates, hoistCmp, HoistModel, type HoistProps, type PlainObject, XH} from '@xh/hoist/core';
import type {RuleLike} from '@xh/hoist/data';
import {formField} from '@xh/hoist/desktop/cmp/form';
import {action, observableRef} from '@xh/hoist/mobx';
import {debounce, type DebouncedFunc, identity, isEqual} from 'lodash';
import {type ReactElement, useLayoutEffect} from 'react';
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

    /**
     * Milliseconds to wait after the user's last change before the value goes to the state, so
     * that a run of changes, such as the drag of a slider, makes one write. Default 0. Read once.
     */
    writeDelay?: number;

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
        // A write still waiting goes to the state before the document can destroy it.
        useLayoutEffect(() => () => model.flushWrite(), [model]);

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
 * commits goes to the state, at once or after `writeDelay`. A write that waits goes at once when
 * the user presses or focuses anything, so that a button reads the value shown.
 * @internal
 */
export class ChatUiFieldModel extends HoistModel implements ChatUiFormField {
    override xhImpl = true;

    @observableRef accessor formModel: FormModel = null;

    private chatForm: ChatUiFormModel = null;

    // True once the user has set a value. Until then, a change to a prop that checks the value
    // applies the state's value again.
    private userActed = false;

    private delayedWrite: DebouncedFunc<() => void> = null;

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
        const {writeDelay} = this.props;
        if (writeDelay > 0) this.delayedWrite = debounce(() => this.writeValue(), writeDelay);

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
                // The state changed, as on a reset or a write from another input. Or a prop that
                // checks the value changed, such as the choices of a radio group or the range of
                // a slider, as they stream in after the value. That applies the value again, but
                // only until the user acts.
                track: () => {
                    const {value} = this.props;
                    return [value, this.toInput(value)];
                },
                run: ([value, next], [previous]) => {
                    const {fieldModel} = this;
                    if (isEqual(next, fieldModel.value)) return;
                    if (this.userActed && isEqual(value, previous)) return;
                    fieldModel.init(next);
                },
                equals: 'structural'
            },
            {
                // The user committed a value. A new field, or a new initial value, comes from the
                // state, and is not written back to it.
                track: () => {
                    const {fieldModel} = this;
                    return [fieldModel, fieldModel?.initialValue, fieldModel?.value];
                },
                run: ([field, initial], [previousField, previousInitial]) => {
                    if (field !== previousField || initial !== previousInitial) return;
                    this.userActed = true;
                    if (this.delayedWrite) {
                        waitingWrites.add(this);
                        listenForPresses();
                        this.delayedWrite();
                    } else {
                        this.writeValue();
                    }
                }
            }
        );
    }

    // Once the first render is done, as the form's buttons observe its fields.
    override afterLinked() {
        this.chatForm?.register(this);
    }

    /** Write a value that waits on `writeDelay` now. */
    flushWrite() {
        this.delayedWrite?.flush();
    }

    override destroy() {
        this.delayedWrite?.cancel();
        waitingWrites.delete(this);
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

    private writeValue() {
        waitingWrites.delete(this);
        const {value} = this,
            {value: current = null, setProp} = this.props;
        if (!isEqual(value, current)) setProp(VALUE, value);
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
                    // What the user set, as its write to the state may still wait.
                    initialValue:
                        previous && this.userActed
                            ? previous.fields[VALUE].value
                            : this.toInput(value),
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

// Fields with a write that waits on `writeDelay`. A press or a move of focus anywhere writes
// them first, so that a button the user then clicks, its tooltip and a reset all see the value
// that the field shows.
const waitingWrites = new Set<ChatUiFieldModel>();
let isListening = false;

function listenForPresses() {
    if (isListening) return;
    isListening = true;
    const flush = () => [...waitingWrites].forEach(it => it.flushWrite());
    document.addEventListener('pointerdown', flush, true);
    document.addEventListener('focusin', flush, true);
}

// Name of the one field of each field's FormModel, and of the state prop it mirrors.
const VALUE = 'value';
