import {describe, expect, it} from 'vitest';
import {exampleBlueprintOf} from './demo/exampleBlueprint';
import {variableLabel} from './variableLabel';

/** A variable shows to users by its label, else by its name in words. */
describe('variableLabel', () => {
    it("reads a variable's label, else its name in words", () => {
        expect(variableLabel('asOf', {label: 'As of'})).toBe('As of');
        expect(variableLabel('asOf', {})).toBe('As Of');
        expect(variableLabel('fund_id')).toBe('Fund Id');
    });

    it("labels an example's date variable as its dataset's param is labelled", () => {
        const catalog = {
                getDataset: () =>
                    ({
                        name: 'positions',
                        params: {asOf: {type: 'localDate', required: true, label: 'As of'}}
                    }) as any
            },
            {blueprint} = exampleBlueprintOf(
                {name: 'cubeGrid', example: {component: 'cubeGrid', config: {source: 'positions'}}},
                catalog
            );
        expect(blueprint.variables.asOf).toMatchObject({type: 'localDate', label: 'As of'});
    });
});
