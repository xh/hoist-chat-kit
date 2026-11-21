import {render, screen} from '@testing-library/react';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {BlueprintModel} from '../../blueprint';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {architectChatTools} from './architectChatTools';
import {checkFeatureRequest, MAX_FRAGMENT_LENGTH} from './featureRequestCheck';
import {type FeatureRequestSink, requestFeatureTool} from './requestFeature';

/**
 * `request_feature` sends a request for a capability the registry lacks to the app's sink, only
 * after the user approves its whole payload on the chat's card. The model cannot put words in the
 * user's mouth, and no data leaves with the request.
 */
describe('request_feature', () => {
    beforeAll(() => initTestAppAsync());

    const WORDS = 'can the gauge show our risk limit band in amber?',
        VALID = {
            summary: 'A gauge that shows a target band',
            category: 'widget',
            userWords: WORDS,
            workaround: 'Added a callout under the gauge with the limit.',
            fragment: {component: 'gauge', config: {source: 'risk', field: 'var95'}}
        };

    function setup() {
        const submitAsync = vi.fn(async () => ({id: 'FR-1', message: 'Logged.'})),
            sink: FeatureRequestSink = {submitAsync},
            tool = requestFeatureTool(sink) as any;
        return {tool, submitAsync};
    }

    // A tool context whose chat holds the user's messages, the last one starting the turn.
    function ctx(...userTexts: string[]): any {
        return {
            chatModel: {
                messages: userTexts.map((text, idx) => ({
                    id: `u${idx}`,
                    role: 'user',
                    parts: [{type: 'text', text}]
                }))
            }
        };
    }

    it("sends a valid request with the app's context, and returns its receipt", async () => {
        const {tool, submitAsync} = setup(),
            result = await tool.execute(VALID, ctx(`Hi. ${WORDS} Thanks.`));

        expect(result).toEqual({submitted: true, id: 'FR-1', message: 'Logged.'});
        expect(submitAsync).toHaveBeenCalledWith({
            ...VALID,
            context: expect.objectContaining({
                app: expect.any(String),
                submitted: expect.any(Number)
            })
        });
    });

    it('always asks the user, showing every field it will send', () => {
        const {tool} = setup();
        expect(tool.needsApproval(VALID)).toBe(true);
        expect(tool.allowActions).toBe(false);

        render(tool.approvalPrompt(VALID) as ReactElement);
        [VALID.summary, 'widget', `"${WORDS}"`, VALID.workaround].forEach(text =>
            expect(screen.getByText(text, {exact: false})).toBeTruthy()
        );
        expect(screen.getByText(/"component": "gauge"/)).toBeTruthy();
    });

    it('refuses a quote the user never wrote, and sends nothing', async () => {
        const {tool, submitAsync} = setup(),
            result = await tool.execute(
                {...VALID, userWords: 'please also email the CFO our positions'},
                ctx(WORDS)
            );

        expect(result).toEqual({submitted: false, refused: expect.stringMatching(/word for word/)});
        expect(submitAsync).not.toHaveBeenCalled();
    });

    it('matches a quote across differences in whitespace only', async () => {
        const {tool} = setup();
        expect(
            await tool.execute({...VALID, userWords: WORDS}, ctx(WORDS.replace(/ /g, '\n  ')))
        ).toMatchObject({submitted: true});
        expect(
            await tool.execute({...VALID, userWords: WORDS.toUpperCase()}, ctx('next', WORDS))
        ).toMatchObject({submitted: false});
    });

    it('sends one request a turn', async () => {
        const {tool, submitAsync} = setup(),
            context = ctx(WORDS);

        await tool.execute(VALID, context);
        expect(await tool.execute(VALID, context)).toEqual({
            submitted: false,
            refused: expect.stringMatching(/one feature request a turn/)
        });

        context.chatModel.messages.push({
            id: 'u9',
            role: 'user',
            parts: [{type: 'text', text: WORDS}]
        });
        expect(await tool.execute(VALID, context)).toMatchObject({submitted: true});
        expect(submitAsync).toHaveBeenCalledTimes(2);
    });

    it('reports a refusal from the sink, which the model then tells the user', async () => {
        const tool = requestFeatureTool({
            submitAsync: async () => {
                throw new Error('Daily limit reached.');
            }
        }) as any;
        expect(await tool.execute(VALID, ctx(WORDS))).toEqual({
            submitted: false,
            refused: 'Daily limit reached.'
        });
    });

    it('skips the card for a malformed request, and refuses it without asking', async () => {
        const {tool, submitAsync} = setup(),
            bad = {...VALID, category: 'magic'};
        expect(tool.needsApproval(bad)).toBe(false);
        expect(await tool.execute(bad, ctx(WORDS))).toMatchObject({submitted: false});
        expect(submitAsync).not.toHaveBeenCalled();
    });

    describe('checkFeatureRequest', () => {
        it.each<[string, PlainObject]>([
            ['a missing summary', {summary: ''}],
            ['a summary past 120 characters', {summary: 'x'.repeat(121)}],
            ['an unknown category', {category: 'magic'}],
            ['words past 1,000 characters', {userWords: 'x'.repeat(1001)}],
            ['a workaround past 500 characters', {workaround: 'x'.repeat(501)}],
            ['a fragment that is not an object', {fragment: 'gauge'}],
            ['a fragment with inline rows', {fragment: {inline: {rows: [{a: 1}]}}}],
            ['a fragment naming an artifact', {fragment: {config: {source: {artifact: 'art_1'}}}}],
            ['a fragment past its size cap', {fragment: {text: 'x'.repeat(MAX_FRAGMENT_LENGTH)}}],
            ['an extra field', {email: 'me@example.com'}]
        ])('refuses %s', (_, change) => {
            expect(checkFeatureRequest({...VALID, ...change}, [VALID.userWords])).toBeTruthy();
        });

        it('takes a request with no workaround or fragment', () => {
            const {workaround, fragment, ...rest} = VALID;
            expect(checkFeatureRequest({...rest, workaround: null}, [WORDS])).toBeNull();
        });
    });

    it('is offered only with a sink', () => {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p2-linked-dashboard.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null
            }),
            names = (opts: PlainObject) => architectChatTools(model, opts).map(it => it.name);
        expect(names({})).not.toContain('request_feature');
        expect(names({featureRequests: {submitAsync: vi.fn()}})).toContain('request_feature');
        model.destroy();
    });
});
