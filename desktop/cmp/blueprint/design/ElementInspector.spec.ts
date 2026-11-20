import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../../blueprint';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {elementInspector, ElementInspectorModel} from './ElementInspector';

/**
 * The selected element's config, an editor per property of its widget's schema. Each commit is
 * one edit by the user, and a refused one leaves the blueprint as it was, with its issues shown.
 */
describe('ElementInspector', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(file = 'p3-morning-report.json', select = 'posGrid') {
        const model = new BlueprintModel({
                blueprint: loadBlueprint(file),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            inspector = new ElementInspectorModel(design);
        design.select({kind: 'element', id: select});
        onTestFinished(() => {
            inspector.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, inspector};
    }

    it("edits the selected element's config, one property per edit, and removes a cleared one", () => {
        const {model, inspector} = open();
        expect(inspector.nodes.map(it => it.key)).toContain('title');

        inspector.commit('title', 'Positions');
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
        expect(model.history.at(-1)).toMatchObject({author: 'user', description: 'Grid: title'});

        inspector.commit('title', undefined);
        expect(model.blueprint.elements.posGrid.config).not.toHaveProperty('title');
        model.undo();
        expect(model.blueprint.elements.posGrid.config.title).toBe('Positions');
    });

    it('shows and edits the active preset for a path that presets control', () => {
        const {model, inspector} = open();
        expect(inspector.values.columnState).toEqual(['mktVal', 'pnlDay', 'pnlMtd', 'pnlYtd']);

        inspector.commit('columnState', ['mktVal']);
        const {presets, elements} = model.blueprint;
        expect(presets.posViews.items.pnl.set.elements.posGrid.config.columnState).toEqual([
            'mktVal'
        ]);
        expect(elements.posGrid.config).not.toHaveProperty('columnState');
    });

    it('keeps the blueprint as it was after a refused edit, with the issues at the property', () => {
        const {model, inspector} = open(),
            before = model.blueprint;
        inspector.commit('sizingMode', 'huge');
        expect(model.blueprint).toBe(before);
        expect(inspector.issuesFor('sizingMode').length).toBeGreaterThan(0);
        expect(inspector.issuesFor('title')).toEqual([]);

        inspector.refuse('columns', 'Not valid JSON.');
        expect(inspector.issuesFor('columns')).toMatchObject([{message: 'Not valid JSON.'}]);
        inspector.commit('title', 'Fine');
        expect(inspector.issuesFor('columns')).toEqual([]);
    });

    it('starts a new list item from the schema, with fields of the widget source', () => {
        const {inspector} = open('p2-linked-dashboard.json', 'headline'),
            cards = inspector.nodes.find(it => it.key === 'cards'),
            item = cards.kind === 'list' ? cards.item : null;
        expect(inspector.newValue(item.schema)).toMatchObject({field: expect.any(String)});
    });

    it('is read-only outside design mode', () => {
        const {model, inspector} = open();
        expect(inspector.readOnly).toBe(false);
        model.setMode('run');
        expect(inspector.readOnly).toBe(true);
    });

    it('draws a labelled editor per property, and JSON for what the schema cannot express', () => {
        const {design} = open(),
            {container} = render(elementInspector({designModel: design}) as ReactElement),
            labels = [...container.querySelectorAll('.xh-blueprint-element-inspector__label')].map(
                it => it.textContent
            );
        expect(labels).toEqual(expect.arrayContaining(['Source *', 'Title', 'Sizing mode']));
        expect(container.querySelector('.xh-json-input')).not.toBeNull();
        expect(container.textContent).not.toContain('No model found');
    });
});
