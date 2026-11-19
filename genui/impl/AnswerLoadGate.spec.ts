import {observable, runInAction} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {afterEach, beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {BlueprintDataProvider, BlueprintDataRequest} from '../../blueprint';
import type {ChatModel} from '../../core';
import {AnswerLoadGate} from './AnswerLoadGate';
import {getCallBudget} from './callBudget';

/**
 * A chat answer loads data within the chat's bounds: the latest reply loads and stays live, an
 * older one waits for the user, and the chat starts only so many loads a minute.
 */
describe('AnswerLoadGate', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const REQ: BlueprintDataRequest = {dataset: 'positions', params: {}, fields: [], groupBy: []};

    function setup(opts: {isLatest?: boolean; maxLoadsPerMinute?: number} = {}) {
        const {isLatest = true, maxLoadsPerMinute} = opts,
            chat = observable({
                messages: [
                    {id: 'a1', role: 'assistant'},
                    {id: 'u2', role: 'user'},
                    ...(isLatest ? [] : [{id: 'a2', role: 'assistant'}])
                ]
            }),
            pushes: ((u: object) => void)[] = [],
            provider = {
                loadAsync: vi.fn(async () => ({rows: [{id: 1}]})),
                subscribe: vi.fn((_req, push) => {
                    pushes.push(push);
                    return closeSub;
                })
            } satisfies BlueprintDataProvider,
            closeSub = vi.fn(),
            gate = new AnswerLoadGate({
                provider,
                chatModel: chat as unknown as ChatModel,
                messageId: 'a1',
                maxLoadsPerMinute
            });
        onTestFinished(() => gate.destroy());
        return {chat, provider, gate, pushes, closeSub};
    }

    it('loads at once, and stays live, for the latest reply', async () => {
        const {provider, gate, pushes} = setup(),
            got: object[] = [];
        gate.subscribe(REQ, u => got.push(u));
        await wait();
        expect(provider.subscribe).toHaveBeenCalledOnce();
        pushes[0]({replace: [{id: 2}]});
        expect(got).toEqual([{replace: [{id: 2}]}]);
        expect(gate.barState).toBeNull();
    });

    it('holds the loads of an earlier reply until the user acts, then loads once with no updates', async () => {
        const {provider, gate} = setup({isLatest: false}),
            got: object[] = [];
        gate.subscribe(REQ, u => got.push(u));
        await wait();
        expect(provider.loadAsync).not.toHaveBeenCalled();
        expect(gate.barState).toBe('held');

        gate.noteUserAction();
        await vi.waitFor(() => expect(got).toEqual([{replace: [{id: 1}], aggregates: undefined}]));
        expect(provider.subscribe).not.toHaveBeenCalled();
        expect(gate.barState).toBeNull();
    });

    it('stops the updates of a reply once it is no longer the latest, and keeps its data', async () => {
        const {chat, gate, closeSub} = setup();
        gate.subscribe(REQ, () => {});
        await wait();
        runInAction(() => chat.messages.push({id: 'a2', role: 'assistant'}));
        expect(closeSub).toHaveBeenCalledOnce();
        expect(gate.barState).toBeNull();
    });

    it('waits past the cap a minute allows, then lets the user retry once the minute is up', async () => {
        vi.useFakeTimers({now: 0});
        const {provider, gate} = setup({maxLoadsPerMinute: 2});
        await Promise.all([gate.loadAsync(REQ), gate.loadAsync(REQ)]);
        const third = gate.loadAsync(REQ);
        expect(provider.loadAsync).toHaveBeenCalledTimes(2);
        expect(gate.barState).toBe('capped');
        expect(gate.canRetry).toBe(false);

        vi.advanceTimersByTime(60_000);
        expect(gate.canRetry).toBe(true);
        gate.retry();
        await third;
        expect(provider.loadAsync).toHaveBeenCalledTimes(3);
        expect(gate.barState).toBeNull();
    });

    it("shares the chat's budget with its OpenUI programs", async () => {
        const {chat, provider, gate} = setup({maxLoadsPerMinute: 1});
        getCallBudget(chat as unknown as ChatModel).take(1);
        gate.loadAsync(REQ);
        await wait();
        expect(provider.loadAsync).not.toHaveBeenCalled();
        expect(gate.barState).toBe('capped');
    });
});
