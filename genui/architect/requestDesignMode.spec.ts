import {render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {BlueprintModel} from '../../blueprint';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {requestDesignModeTool} from './requestDesignMode';

/**
 * `request_design_mode` asks the user, on the chat's approval card in the kit's own words, to let
 * the Architect edit the blueprint. Only the model can call it, and it reports the mode that
 * results, which the model never assumes.
 */
describe('request_design_mode', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(access: 'read' | 'write' = 'write') {
        const ret = new BlueprintModel({
            blueprint: loadBlueprint('p2-linked-dashboard.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: null,
            mode: 'run',
            access
        });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    it('switches to design mode once approved, and reports the mode', async () => {
        const model = open(),
            tool = requestDesignModeTool(model);
        expect(await tool.execute({}, null)).toEqual({mode: 'design'});
        expect(model.mode).toBe('design');
    });

    it('asks in run mode with write access, and never runs from a UI action', () => {
        const model = open(),
            {needsApproval, allowActions} = requestDesignModeTool(model) as any;
        expect(allowActions).toBe(false);
        expect(needsApproval({})).toBe(true);
        model.setMode('design');
        expect(needsApproval({})).toBe(false);
    });

    it('leaves the mode alone without write access, and says why', async () => {
        const model = open('read'),
            tool = requestDesignModeTool(model) as any;
        expect(tool.needsApproval({})).toBe(false);
        expect(await tool.execute({}, null)).toEqual({
            mode: 'run',
            refused: expect.stringMatching(/read access.*copy/)
        });
        expect(model.mode).toBe('run');
    });

    it("asks in the kit's words, with the model's reason only as a quote beneath", () => {
        const tool = requestDesignModeTool(open()),
            prompt = (tool.approvalPrompt as (input: object) => any)({
                reason: 'To add the chart to your dashboard.'
            });
        render(fragment(prompt) as ReactElement);
        expect(screen.getByText(/Let the Architect edit this blueprint\?/)).toBeTruthy();
        expect(screen.getByText('"To add the chart to your dashboard."')).toBeTruthy();
    });
});
