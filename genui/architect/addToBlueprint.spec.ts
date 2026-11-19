import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {BlueprintModel} from '../../blueprint';
import type {ChatModel} from '../../core';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {addToBlueprint} from './addToBlueprint';

/**
 * The button on an answer adds it to a blueprint through the Architect. The click is the user's
 * consent to design mode, for the turn that adds the answer only.
 */
describe('addToBlueprint', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function setup(access: 'read' | 'write' = 'write', mode: 'run' | 'design' = 'run') {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p2-linked-dashboard.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null,
                mode,
                access
            }),
            modes: string[] = [],
            chatModel = {
                isBusy: false,
                sendAsync: vi.fn(async () => {
                    modes.push(model.mode);
                })
            } as unknown as ChatModel;
        onTestFinished(() => model.destroy());
        return {model, chatModel, modes};
    }

    it('is available only with write access', () => {
        expect(addToBlueprint(setup('write').model).isAvailable()).toBe(true);
        expect(addToBlueprint(setup('read').model).isAvailable()).toBe(false);
    });

    it('asks the Architect to add the answer in design mode, then returns to run mode', async () => {
        const {model, chatModel, modes} = setup();
        await addToBlueprint(model).add('m1:0', chatModel);
        expect(chatModel.sendAsync).toHaveBeenCalledWith('Add answer m1:0 to my dashboard.');
        expect(modes).toEqual(['design']);
        expect(model.mode).toBe('run');
    });

    it('leaves design mode on when the user had it on', async () => {
        const {model, chatModel} = setup('write', 'design');
        await addToBlueprint(model).add('m1:0', chatModel);
        expect(model.mode).toBe('design');
    });

    it('does nothing while the chat is busy', async () => {
        const {model, chatModel} = setup();
        (chatModel as any).isBusy = true;
        await addToBlueprint(model).add('m1:0', chatModel);
        expect(chatModel.sendAsync).not.toHaveBeenCalled();
        expect(model.mode).toBe('run');
    });
});
