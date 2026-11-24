import {LocalDate} from '@xh/hoist/utils/datetime';
import {isEmpty, isString} from 'lodash';
import {type EditorNode, isVarBinding, labelOf} from '../../../../../blueprint';

type ChoiceNode = Extract<EditorNode, {kind: 'choice'}>;

/** A setting's value as its input shows it: an unset one at its default, else empty. */
export function toFieldValue(node: EditorNode, value: unknown): unknown {
    if (isVarBinding(value)) return value;
    switch (node.kind) {
        case 'boolean':
            return !!(value ?? node.default);
        case 'date':
            return isString(value) && value ? LocalDate.get(value) : null;
        case 'choice': {
            if (!isDefaulted(node)) return value ?? null;
            const options = node.options.filter(it => it !== true);
            if (value === true) return options[0];
            return value ?? node.default ?? (node.options.includes(false) ? false : null);
        }
        case 'stringList':
            return value ?? [];
        case 'field':
            return value ?? (node.multiple ? [] : null);
        default:
            return value ?? null;
    }
}

/** A setting's value as the blueprint holds it, from its input: one at its default unset. */
export function fromFieldValue(node: EditorNode, value: unknown): unknown {
    if (isVarBinding(value)) return value;
    switch (node.kind) {
        case 'boolean':
            return value === (node.default ?? false) ? undefined : value;
        case 'date':
            return (value as LocalDate)?.isoString ?? undefined;
        case 'choice':
            if (isDefaulted(node) && value === node.default) return undefined;
            return value == null || value === '' ? undefined : value;
        case 'stringList':
            return isEmpty(value) && !node.required ? undefined : value;
        case 'field':
            if (node.multiple) return isEmpty(value) && !node.required ? undefined : value;
            return value == null || value === '' ? undefined : value;
        default:
            return value == null || value === '' ? undefined : value;
    }
}

/**
 * True for a choice that shows every option at once, so shows its default while unset: one with
 * pictures, one with an off state, or a few short options.
 */
function isDefaulted(node: ChoiceNode): boolean {
    return !!node.thumbnails || node.options.includes(false) || isShortChoice(node);
}

/** True for a choice of a few short options, such as an alignment, which show all at once. */
export function isShortChoice(node: ChoiceNode): boolean {
    return (
        node.options.length <= 3 &&
        node.options.every(it => isString(it) && choiceLabel(node, it).length <= 10)
    );
}

/** An option's label: its schema's `x-labels` entry, else Off for false, else its name. */
export function choiceLabel(node: EditorNode, value: unknown): string {
    return (
        node.schema['x-labels']?.[String(value)] ??
        (value === false ? 'Off' : labelOf(String(value)))
    );
}
