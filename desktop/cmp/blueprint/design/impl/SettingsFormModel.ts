import {FormModel} from '@xh/hoist/cmp/form';
import {HoistModel, managed, type PlainObject} from '@xh/hoist/core';
import {required} from '@xh/hoist/data';
import {isEqual, mapValues} from 'lodash';
import type {EditorNode} from '../../../../../blueprint';

export interface SettingsFormConfig {
    /** The settings, a field each. */
    nodes: EditorNode[];
    /** The settings' values as the blueprint holds them, an unset one absent. Read reactively. */
    values: () => PlainObject;
    /** Apply one setting's change as one edit. `undefined` unsets it. */
    commit: (key: string, value: unknown) => void;
}

/**
 * A Hoist form over a set of blueprint settings, such as an element's config: a field per setting,
 * each change committed as one edit, and the fields following the blueprint as it changes from
 * outside, by undo, a preset or the Architect, with no edit echoed back.
 */
export class SettingsFormModel extends HoistModel {
    @managed readonly formModel: FormModel;

    private readonly cfg: SettingsFormConfig;
    // True while the form takes the blueprint's values, so the change is not committed again.
    private syncing = false;

    constructor(cfg: SettingsFormConfig) {
        super();
        this.cfg = cfg;
        this.formModel = new FormModel({
            fields: cfg.nodes.map(node => ({
                name: node.key,
                displayName: node.label,
                rules: node.required ? [required] : []
            })),
            initialValues: this.fieldValues()
        });
        this.addReaction(
            {
                track: () => this.fieldValues(),
                run: values => {
                    this.syncing = true;
                    try {
                        this.formModel.init(values);
                    } finally {
                        this.syncing = false;
                    }
                },
                equals: isEqual
            },
            {
                track: () => this.formModel.getData(),
                run: data => {
                    if (this.syncing) return;
                    const current = this.fieldValues();
                    Object.entries(data).forEach(([key, value]) => {
                        if (!isEqual(value, current[key])) {
                            this.cfg.commit(key, value == null || value === '' ? undefined : value);
                        }
                    });
                },
                equals: isEqual
            }
        );
    }

    // The blueprint's values as fields hold them: an unset setting null.
    private fieldValues(): PlainObject {
        const values = this.cfg.values() ?? {};
        return mapValues(
            Object.fromEntries(this.cfg.nodes.map(it => [it.key, null])),
            (_, key) => values[key] ?? null
        );
    }
}
