import type {FieldModel} from '@xh/hoist/cmp/form';
import {HoistModel, type PlainObject} from '@xh/hoist/core';
import {action, computedStruct, observableRef} from '@xh/hoist/mobx';
import {isArray, isBoolean, isEmpty, isNil, isNumber, without} from 'lodash';
import {
    CHAT_UI_MAX_CONTEXT_ENTRIES,
    CHAT_UI_MAX_CONTEXT_VALUE_LENGTH,
    type ChatUiAction
} from '../../../../genui';

/** A field of a generative UI form, as its input registers it. */
export interface ChatUiFormField {
    /** Name of the field, as the model wrote it. Its key among the values the form sends. */
    readonly name: string;

    /** The Hoist field model that holds and validates the value. */
    readonly fieldModel: FieldModel;

    /** The value as plain JSON, such as a date as `YYYY-MM-DD`. */
    readonly value: unknown;
}

/**
 * The fields of one generative UI form. Hoist's `FormModel` takes its fields when it is created,
 * and the inputs of a model-written form arrive one at a time as the reply streams. So each input
 * owns a `FormModel` of one field, and registers that field here. The form's buttons validate the
 * fields together, and send their values.
 * @internal
 */
export class ChatUiFormModel extends HoistModel {
    override xhImpl = true;

    @observableRef accessor fields: ChatUiFormField[] = [];

    @action
    register(field: ChatUiFormField) {
        this.fields = [...without(this.fields, field), field];
    }

    @action
    unregister(field: ChatUiFormField) {
        this.fields = without(this.fields, field);
    }

    /** Validate every field, and show the errors beside the inputs. True if all are valid. */
    async validateAsync(): Promise<boolean> {
        const results = await Promise.all(
            this.fields.map(it => it.fieldModel.validateAsync({display: true}))
        );
        return results.every(Boolean);
    }

    /**
     * The values of the fields that have one, by field name, in the form a `send` action takes
     * as its `context`: text, a number or a boolean. A list goes as its JSON, such as `[25,75]`,
     * as a list in the context of an OpenUI `@ToAssistant` does.
     */
    @computedStruct
    get values(): PlainObject {
        const ret: PlainObject = {};
        this.fields.forEach(({name, value}) => {
            const sent = toContextValue(value);
            if (name && sent != null) ret[name] = sent;
        });
        return ret;
    }

    /**
     * An action with the form's values added to its context, for a `send`. The action's own
     * context wins where both name a key. Any other action is returned as it is.
     */
    withValues(sendAction: ChatUiAction): ChatUiAction {
        if (sendAction?.type !== 'send') return sendAction;
        const context = {...this.values, ...sendAction.context};
        return isEmpty(context) ? sendAction : {...sendAction, context};
    }

    /**
     * Why an action cannot send the form's values within the caps of a `send`, or null if it
     * can. The caps keep all of a message readable before the user sends it.
     */
    getSendProblem(sendAction: ChatUiAction): string {
        if (sendAction?.type !== 'send') return null;
        const context: PlainObject = {...this.values, ...sendAction.context},
            keys = Object.keys(context),
            tooLong = keys.find(it => `${context[it]}`.length > CHAT_UI_MAX_CONTEXT_VALUE_LENGTH);

        if (keys.length > CHAT_UI_MAX_CONTEXT_ENTRIES) {
            return `This form holds ${keys.length} values, and can send at most ${CHAT_UI_MAX_CONTEXT_ENTRIES}.`;
        }
        return tooLong
            ? `'${tooLong}' is longer than ${CHAT_UI_MAX_CONTEXT_VALUE_LENGTH} characters.`
            : null;
    }
}

//------------------
// Implementation
//------------------
function toContextValue(value: unknown): string | number | boolean {
    if (isNil(value) || value === '') return null;
    if (isNumber(value) || isBoolean(value)) return value;
    if (isArray(value)) return isEmpty(value) ? null : JSON.stringify(value);
    return `${value}`;
}
