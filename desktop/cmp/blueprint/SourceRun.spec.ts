import {fireEvent, render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {BlueprintModel} from '../../../blueprint';
import {FakeBlueprintDataProvider} from '../../../blueprint/demo';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {blueprintView} from './BlueprintView';

/** A manual source's widgets say when its rows are for inputs no longer set, and offer Run. */
describe('a manual source in the view', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('marks its widgets stale when an input changes, and runs it from their Run button', async () => {
        const bp = loadBlueprint('p1-one-grid.json');
        Object.assign(bp.sources.positions, {run: 'manual', live: false});
        const provider = new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            model = new BlueprintModel({
                blueprint: bp,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: provider,
                mode: 'run'
            });
        onTestFinished(() => model.destroy());
        const source = () => model.getSource('positions'),
            {container} = render(blueprintView({model}) as ReactElement),
            marker = () => container.querySelector('.xh-blueprint-view__stale');
        await vi.waitFor(() => expect(source().hasLoaded).toBe(true));
        expect(marker()).toBeNull();

        model.setVariable('asOf', '2026-07-01');
        await vi.waitFor(() => expect(marker()?.textContent).toMatch(/Inputs changed/));

        const load = vi.spyOn(provider, 'loadAsync');
        fireEvent.click(marker().querySelector('button'));
        await vi.waitFor(() => expect(marker()).toBeNull());
        expect(source().isStale).toBe(false);
        expect(load.mock.calls.at(-1)[0].params).toEqual({asOf: '2026-07-01'});
    });
});
