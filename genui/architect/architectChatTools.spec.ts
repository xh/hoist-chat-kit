import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {BlueprintModel} from '../../blueprint';
import {FakeBlueprintDataProvider} from '../../blueprint/demo';
import {ChatToolResult} from '../../core';
import {chatUiTextSpec} from '../../desktop/cmp/genui';
import {getArtifactRows} from '../../impl/ArtifactRows';
import {ChatUiCatalog} from '../ChatUiCatalog';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {architectChatTools} from './architectChatTools';
import {blueprintContextProvider} from './blueprintContextProvider';

/**
 * The Architect's tools as chat kit client tools, and the context a chat sends with each step. A
 * query's result becomes an artifact of the reply, which the chat keeps.
 */
describe('Architect chat tools', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open() {
        const ret = new BlueprintModel({
            blueprint: loadBlueprint('p2-linked-dashboard.json'),
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            mode: 'design',
            access: 'write'
        });
        onTestFinished(() => ret.destroy());
        return ret;
    }

    it("adds read_answer with the chat's catalog", () => {
        const names = (tools: {name: string}[]) => tools.map(it => it.name),
            catalog = new ChatUiCatalog({components: [chatUiTextSpec()]});
        expect(names(architectChatTools(open()))).not.toContain('read_answer');
        expect(names(architectChatTools(open()))).toContain('request_design_mode');
        expect(names(architectChatTools(open(), {catalog}))).toContain('read_answer');
    });

    it("offers the registry's client tools, under names a model API takes, with input normalized", async () => {
        const registry = scenarioRegistry(),
            calls = [];
        registry.addTools(
            {
                name: 'acme.lookupSymbol',
                summary: 'Find the symbol for a company name.',
                guidance: 'Use before you filter by a company the user names.',
                parameters: {
                    type: 'object',
                    required: ['name'],
                    properties: {name: {type: 'string'}, exchange: {type: 'string'}}
                },
                runsOn: 'client',
                needsApproval: true,
                execute: (input, ctx) => {
                    calls.push({input, target: ctx.target});
                    return {symbol: 'NVDA'};
                }
            },
            {
                name: 'acme.explainVar',
                summary: 'Explain a VaR move.',
                parameters: {type: 'object', properties: {}},
                runsOn: 'server'
            }
        );
        const model = new BlueprintModel({
            blueprint: loadBlueprint('p2-linked-dashboard.json'),
            catalog: portfolioCatalog,
            registry,
            dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            mode: 'design',
            access: 'write'
        });
        onTestFinished(() => model.destroy());

        const tools = architectChatTools(model),
            tool = tools.find(it => it.name === 'acme__lookupSymbol');
        expect(tools.map(it => it.name)).not.toContain('acme__explainVar');
        expect(tool.description).toBe(
            'Find the symbol for a company name. Use before you filter by a company the user names.'
        );
        expect(tool.needsApproval).toBe(true);
        expect(await tool.execute({name: 'Nvidia', exchange: ''}, null)).toEqual({symbol: 'NVDA'});
        expect(calls).toEqual([{input: {name: 'Nvidia'}, target: model}]);
    });

    it('offers the tools a target can run as chat kit client tools', async () => {
        const model = open(),
            read = architectChatTools(model).find(it => it.name === 'read_blueprint');
        expect(read.parameters.type).toBe('object');
        expect(await read.execute({}, null)).toMatchObject({version: 1});
    });

    it("returns a query's result as an artifact of the reply: its dataset and request, no rows", async () => {
        const model = open(),
            tool = architectChatTools(model).find(it => it.name === 'query_dataset'),
            input = {
                dataset: 'positions',
                params: {asOf: '2026-07-01'},
                fields: ['mktVal'],
                groupBy: ['sector'],
                filter: {field: 'sector', op: '!=', value: 'Energy'},
                top: 2
            },
            chatModel = {},
            result = await tool.execute(input, {chatModel} as any);
        expect(result).toBeInstanceOf(ChatToolResult);
        expect(getArtifactRows(chatModel, result.output.id)).toEqual(result.output.rows);
        const [artifact] = result.artifacts;
        expect(artifact).toEqual({
            id: result.output.id,
            columns: [
                {name: 'sector', label: 'Sector', type: 'string'},
                {name: 'mktVal', label: 'Market Value', type: 'number'}
            ],
            totalRows: 2,
            metadata: {dataset: 'positions', request: input}
        });
    });

    it('sends the version, mode, access and current variable values as context', async () => {
        const model = open(),
            provider = blueprintContextProvider(model);
        model.setAccess('read');
        model.setVariable('asOf', '2026-07-01');
        expect(await provider.getContext(null)).toEqual({
            version: 1,
            mode: 'run',
            access: 'read',
            variables: {asOf: '2026-07-01', selection: null}
        });
    });
});
