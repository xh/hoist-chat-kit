import {describe, expect, it} from 'vitest';
import {loadBlueprint, scenarioFiles, scenarioRegistry} from '../../test/blueprintFixtures';
import type {Blueprint} from '../Blueprint';
import {stampSchemaVersions} from './BlueprintDocumentModel';

const registry = scenarioRegistry();

// The widgets a blueprint uses that its schema map leaves out, or names at another version.
const unstamped = (bp: Blueprint) =>
    Object.values(bp.elements ?? {})
        .map(it => registry.widgets[it.component])
        .filter(spec => spec && bp.schema?.widgets?.[spec.name] !== spec.version)
        .map(spec => spec.name);

describe('stampSchemaVersions', () => {
    it("stamps the format's version and each widget's a blueprint uses, keeping other entries", () => {
        const bp: Blueprint = {
                schema: {blueprint: 0, resolvers: {today: 2}},
                root: 'grid',
                elements: {grid: {component: 'cubeGrid', config: {source: 'positions'}}}
            },
            stamped = stampSchemaVersions(bp, registry);
        expect(stamped.schema).toEqual({
            blueprint: 1,
            resolvers: {today: 2},
            widgets: {cubeGrid: registry.widgets.cubeGrid.version}
        });
        expect(bp.schema.blueprint).toBe(0);
    });

    it.each(scenarioFiles().filter(f => loadBlueprint(f).elements))(
        'finds every widget the scenario blueprint %s uses in its schema map',
        file => expect(unstamped(loadBlueprint(file))).toEqual([])
    );
});
