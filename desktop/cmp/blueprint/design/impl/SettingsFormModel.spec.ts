import type {PlainObject} from '@xh/hoist/core';
import {observable, runInAction} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {toEditorSpec} from '../../../../../blueprint';
import {SettingsFormModel} from './SettingsFormModel';

const SCHEMA = {
    type: 'object',
    required: ['source'],
    properties: {
        source: {type: 'string'},
        title: {type: 'string'},
        stripeRows: {type: 'boolean', default: true}
    }
};

function open(initial: PlainObject) {
    const config = observable.box<PlainObject>(initial, {deep: false}),
        commits: [string, unknown][] = [],
        model = new SettingsFormModel({
            nodes: toEditorSpec(SCHEMA),
            values: () => config.get(),
            commit: (key, value) => {
                commits.push([key, value]);
                const next = {...config.get()};
                if (value === undefined) delete next[key];
                else next[key] = value;
                runInAction(() => config.set(next));
            }
        });
    onTestFinished(() => model.destroy());
    return {config, commits, model, form: model.formModel};
}

describe('SettingsFormModel', () => {
    beforeAll(() => initTestAppAsync());

    it('holds a field per setting, at its config value, with an unset one null', () => {
        const {form} = open({source: 'positions'});
        expect(form.getData()).toEqual({source: 'positions', title: null, stripeRows: null});
        expect(form.getField('source').isRequired).toBe(true);
        expect(form.getField('title').displayName).toBe('Title');
    });

    it('commits each field change once, and an emptied one as unset', () => {
        const {form, commits, config} = open({source: 'positions'});
        form.setValues({title: 'P&L'});
        expect(commits).toEqual([['title', 'P&L']]);
        expect(config.get()).toEqual({source: 'positions', title: 'P&L'});
        form.setValues({title: null});
        expect(commits.at(-1)).toEqual(['title', undefined]);
        expect(config.get()).toEqual({source: 'positions'});
    });

    it('follows a change from outside, such as an undo, without echoing it back as an edit', () => {
        const {form, commits, config} = open({source: 'positions'});
        runInAction(() => config.set({source: 'orders', stripeRows: false}));
        expect(form.getData()).toEqual({source: 'orders', title: null, stripeRows: false});
        expect(commits).toEqual([]);
        expect(form.isDirty).toBe(false);
    });
});
