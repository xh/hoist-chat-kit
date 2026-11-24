import {fireEvent, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {type Blueprint, BlueprintModel, validateBlueprint} from '../../../blueprint';
import {portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {blueprintView} from './BlueprintView';

/**
 * A prompted variable shows in a `variableInput` element, placed like any other, usually in the
 * root panel's tbar. The blueprint draws no toolbar of its own.
 */
describe('variableInput', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const withInputs = (inputs: object[], variables: Blueprint['variables']): Blueprint => ({
        schema: {blueprint: 1},
        root: 'page',
        variables,
        elements: {
            page: {
                component: 'panel',
                tbar: inputs.map((_, idx) => ({id: `input${idx}`})),
                children: [{id: 'note'}]
            },
            note: {component: 'markdown', config: {text: 'Body'}},
            ...Object.fromEntries(
                inputs.map((config, idx) => [`input${idx}`, {component: 'variableInput', config}])
            )
        }
    });

    function show(blueprint: Blueprint) {
        const model = new BlueprintModel({
            blueprint,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: null
        });
        onTestFinished(() => model.destroy());
        render(blueprintView({model}) as ReactElement);
        return model;
    }

    const issuesOf = (blueprint: Blueprint) =>
        validateBlueprint(blueprint, {catalog: portfolioCatalog, registry: scenarioRegistry()}).map(
            it => [it.code, it.severity, it.path]
        );

    it("shows its variable's input beside the variable's label, or its name in words", () => {
        const tbar = () => document.querySelector('.xh-panel .xh-toolbar');
        show(withInputs([{variable: 'asOf'}], {asOf: {type: 'localDate', setBy: 'prompt'}}));
        expect(tbar().textContent).toContain('As Of');
        expect(tbar().querySelector('.xh-blueprint-variable-input input')).not.toBeNull();
        document.body.innerHTML = '';
        show(
            withInputs([{variable: 'fund', label: 'Portfolio'}], {
                fund: {type: 'string', setBy: 'prompt', default: {value: 'Oak'}}
            })
        );
        expect(tbar().textContent).toContain('Portfolio');
    });

    it('sets its variable as the user changes the input', () => {
        const model = show(
            withInputs([{variable: 'live'}], {live: {type: 'bool', label: 'Live', setBy: 'prompt'}})
        );
        fireEvent.click(screen.getByRole('checkbox'));
        expect(model.getVariable('live').value).toBe(true);
    });

    it('draws no toolbar of its own for a prompted variable', () => {
        show({
            schema: {blueprint: 1},
            root: 'note',
            variables: {asOf: {type: 'localDate', label: 'As of', setBy: 'prompt'}},
            elements: {note: {component: 'markdown', config: {text: 'Body'}}}
        });
        expect(document.querySelector('.xh-toolbar')).toBeNull();
    });

    it('warns of a prompted variable no input shows, and refuses an input for one not prompted', () => {
        expect(
            issuesOf(withInputs([], {asOf: {type: 'localDate', setBy: 'prompt'}}))
        ).toContainEqual(['variable.noInput', 'warning', '/variables/asOf']);
        expect(
            issuesOf(withInputs([{variable: 'asOf'}], {asOf: {type: 'localDate', setBy: 'prompt'}}))
        ).toEqual([]);
        expect(
            issuesOf(withInputs([{variable: 'asOf'}], {asOf: {type: 'localDate'}}))
        ).toContainEqual([
            'variableInput.notPrompted',
            'error',
            '/elements/input0/config/variable'
        ]);
        expect(issuesOf(withInputs([{variable: 'nope'}], {}))).toContainEqual([
            'variableInput.unknownVariable',
            'error',
            '/elements/input0/config/variable'
        ]);
    });
});
