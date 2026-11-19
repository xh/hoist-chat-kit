import {fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {Blueprint, BlueprintDataProvider} from '../../blueprint';
import type {ChatModel, ChatToolCallPart} from '../../core';
import {chatUiStackSpec, chatUiStatCardsSpec, chatUiTextSpec} from '../../desktop/cmp/genui';
import {keepArtifactRows} from '../../impl/ArtifactRows';
import {portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {ChatArtifactRegistry} from '../ChatArtifactRegistry';
import {ChatUiCatalog} from '../ChatUiCatalog';

/**
 * `show_ui` takes an answer blueprint: it reads the app's datasets and the chat's artifacts, loads
 * within the chat's bounds, and shows nothing for an answer with errors.
 */
describe('show_ui with answer blueprints', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const ROWS = [
        {id: 'a', mktVal: 100, sector: 'Energy'},
        {id: 'b', mktVal: 250, sector: 'Technology'}
    ];

    function setup(opts: {isLatest?: boolean} = {}) {
        const was = ChatUiCatalog.answerBlueprints;
        ChatUiCatalog.answerBlueprints = true;
        onTestFinished(() => {
            ChatUiCatalog.answerBlueprints = was;
        });
        const provider = {
                loadAsync: vi.fn(async () => ({rows: ROWS}))
            } satisfies BlueprintDataProvider,
            artifacts = new ChatArtifactRegistry(),
            chatModel = {
                messages: [
                    {id: 'm1', role: 'assistant'},
                    ...(opts.isLatest === false ? [{id: 'm2', role: 'assistant'}] : [])
                ],
                artifacts,
                getMessage: () => null
            } as unknown as ChatModel,
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), chatUiTextSpec(), chatUiStatCardsSpec()],
                modes: ['document'],
                answers: {dataCatalog: portfolioCatalog, dataProvider: provider}
            });
        return {catalog, provider, artifacts, chatModel};
    }

    const answer = (source: object): Blueprint => ({
        sources: {pos: source},
        root: 'cards',
        elements: {
            cards: {component: 'statCardStrip', config: {source: 'pos', cards: [{field: 'mktVal'}]}}
        }
    });
    const DATASET = {dataset: 'positions', params: {asOf: '2026-11-19'}};

    function show(catalog: ChatUiCatalog, chatModel: ChatModel, input: object) {
        const part: ChatToolCallPart = {
            type: 'tool-call',
            id: 't1',
            toolCallId: 't1',
            toolName: 'show_ui',
            state: 'output-available',
            input
        } as any;
        return render(
            fragment({
                children: catalog.documentTool.renderer(part, {chatModel, messageId: 'm1'})
            }) as ReactElement
        );
    }

    it('describes the registry, with no reserved widget', () => {
        const {catalog} = setup(),
            {parameters, description} = catalog.documentTool,
            names = parameters.properties.elements.additionalProperties.properties.component.enum;
        expect(names).toEqual(expect.arrayContaining(['statCardStrip', 'cubeGrid', 'text']));
        expect(names).not.toContain('fallback');
        expect(description).toContain('statCardStrip: Stat cards.');
    });

    it("offers the app's own widgets and types, beside chat kit's", () => {
        const app = scenarioRegistry(),
            catalog = new ChatUiCatalog({
                components: [chatUiTextSpec()],
                answers: {registry: app}
            }),
            {registry} = catalog;
        Object.keys(app.widgets).forEach(it => expect(registry.widgets[it]).toBeTruthy());
        Object.keys(app.variableTypes).forEach(it =>
            expect(registry.variableTypes[it]).toBeTruthy()
        );
        expect(registry.widgets.text).toBeTruthy();
        expect(registry.actions.send).toBeTruthy();
    });

    it('shows nothing for an answer with errors, and gives the model its issues', async () => {
        const {catalog, chatModel} = setup(),
            run = (input: object) => catalog.documentTool.execute(input, {chatModel} as any);
        expect(await run(answer(DATASET))).toContain('Rendered an answer of 1 element');
        expect(() => run(answer({dataset: 'nope'}))).toThrow(/Invalid answer[\s\S]*nope/);
        expect(() => run(answer({artifact: 'art_never'}))).toThrow(
            /Invalid answer[\s\S]*unknown artifact 'art_never'/
        );
    });

    it('renders a reply stored as a catalog document as it always has', () => {
        const {catalog, chatModel} = setup();
        show(catalog, chatModel, {
            root: 'top',
            elements: {
                top: {component: 'stack', props: {}, children: ['t']},
                t: {component: 'text', props: {text: 'Stored reply'}}
            }
        });
        expect(screen.getByText('Stored reply')).toBeTruthy();
    });

    it("loads a dataset through the app's provider in the latest reply", async () => {
        const {catalog, provider, chatModel} = setup();
        show(catalog, chatModel, answer(DATASET));
        await vi.waitFor(() => expect(provider.loadAsync).toHaveBeenCalledOnce());
        expect(await screen.findByText('Market Value')).toBeTruthy();
    });

    it('holds the dataset of an earlier reply until the user asks for current data', async () => {
        const {catalog, provider, chatModel} = setup({isLatest: false});
        show(catalog, chatModel, answer(DATASET));
        expect(await screen.findByText('Data from an earlier reply.')).toBeTruthy();
        expect(provider.loadAsync).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('Load current data'));
        await vi.waitFor(() => expect(provider.loadAsync).toHaveBeenCalledOnce());
    });

    it("reads a chat's artifact through the dataset it names", async () => {
        const {catalog, artifacts, chatModel} = setup();
        artifacts.add({
            id: 'art_1',
            columns: [{name: 'mktVal', type: 'number'}],
            rows: [{mktVal: 100}, {mktVal: 250}],
            totalRows: 2,
            metadata: {dataset: 'positions'}
        });
        const load = vi.spyOn(artifacts, 'loadRangeAsync'),
            {container} = show(catalog, chatModel, answer({artifact: 'art_1'}));
        await vi.waitFor(() => expect(load).toHaveBeenCalledWith('art_1', 0, 2));
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-stat-card__value')?.textContent).toMatch(/\d/)
        );
    });

    describe("a query's artifact kept without its rows, as after a reload", () => {
        const keep = (artifacts: ChatArtifactRegistry) =>
            artifacts.add({
                id: 'art_2',
                columns: [{name: 'mktVal', type: 'number'}],
                totalRows: 2,
                metadata: {
                    dataset: 'positions',
                    request: {
                        dataset: 'positions',
                        params: {asOf: '2026-11-19'},
                        fields: ['mktVal']
                    }
                }
            });

        it('shows the rows the model saw while the chat holds them, with no query', async () => {
            const {catalog, provider, artifacts, chatModel} = setup();
            keep(artifacts);
            keepArtifactRows(chatModel, 'art_2', [{mktVal: 100}, {mktVal: 250}]);
            const {container} = show(catalog, chatModel, answer({artifact: 'art_2'}));
            await vi.waitFor(() =>
                expect(container.querySelector('.xh-stat-card__value')?.textContent).toMatch(/\d/)
            );
            expect(provider.loadAsync).not.toHaveBeenCalled();
        });

        it("runs its request again through the app's provider once its rows are gone", async () => {
            const {catalog, provider, artifacts, chatModel} = setup();
            keep(artifacts);
            show(catalog, chatModel, answer({artifact: 'art_2'}));
            await vi.waitFor(() =>
                expect(provider.loadAsync).toHaveBeenCalledWith(
                    expect.objectContaining({dataset: 'positions', fields: ['mktVal']}),
                    undefined
                )
            );
        });

        it('waits in an earlier reply until the user asks for current data', async () => {
            const {catalog, provider, artifacts, chatModel} = setup({isLatest: false});
            keep(artifacts);
            show(catalog, chatModel, answer({artifact: 'art_2'}));
            expect(await screen.findByText('Data from an earlier reply.')).toBeTruthy();
            expect(provider.loadAsync).not.toHaveBeenCalled();

            fireEvent.click(screen.getByText('Load current data'));
            await vi.waitFor(() => expect(provider.loadAsync).toHaveBeenCalledOnce());
        });

        it('says it is no longer available, with no request to run', async () => {
            const {catalog, artifacts, chatModel} = setup();
            artifacts.add({id: 'art_3', columns: [{name: 'mktVal', type: 'number'}], totalRows: 2});
            show(catalog, chatModel, answer({artifact: 'art_3'}));
            expect(
                await screen.findByText('The data for this answer is no longer available.')
            ).toBeTruthy();
        });
    });
});
