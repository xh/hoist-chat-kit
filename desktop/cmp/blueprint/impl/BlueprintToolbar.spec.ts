import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {BlueprintModel, FakeBlueprintDataProvider} from '../../../../blueprint';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {blueprintToolbar} from './BlueprintToolbar';

/** The toolbar of a blueprint's prompts, each by its label, else its name in words. */
describe('BlueprintToolbar', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('names a prompt with no label by its name in words', () => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        delete (bp.variables.asOf as any).label;
        const model = new BlueprintModel({
            blueprint: bp,
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog})
        });
        onTestFinished(() => model.destroy());
        const {container} = render(blueprintToolbar({blueprintModel: model}) as ReactElement);
        expect(container.textContent).toContain('As Of');
        expect(container.textContent).not.toContain('asOf');
    });
});
