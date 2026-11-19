import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {BlueprintModel, FakeBlueprintDataProvider} from '../../blueprint';
import {ChatMessage, type ChatModel, type ChatPart} from '../../core';
import {chatUiStackSpec, chatUiStatCardsSpec, chatUiTextSpec} from '../../desktop/cmp/genui';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import {ChatArtifactRegistry} from '../ChatArtifactRegistry';
import {ChatUiCatalog} from '../ChatUiCatalog';
import {openUiLangFormat} from '../openui';
import {READ_ANSWER_MAX_ROWS, readAnswerTool} from './readAnswer';

/**
 * `read_answer` gives the Architect an answer of its own chat to add to the host: its blueprint,
 * and what each artifact it reads becomes in the host. It never gives an artifact's rows.
 */
describe('read_answer', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const catalog = new ChatUiCatalog({
        components: [chatUiTextSpec(), chatUiStatCardsSpec()],
        answers: {dataCatalog: portfolioCatalog}
    });

    function setup() {
        const host = new BlueprintModel({
                blueprint: loadBlueprint('p2-linked-dashboard.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'run',
                access: 'write'
            }),
            asOf = host.variables.find(it => it.name === 'asOf').value,
            artifacts = new ChatArtifactRegistry(),
            messages: ChatMessage[] = [],
            chatModel = {messages, artifacts} as unknown as ChatModel,
            reply = (id: string, ...parts: Partial<ChatPart>[]) =>
                messages.push(
                    new ChatMessage({
                        id,
                        role: 'assistant',
                        parts: parts.map((it, idx) => ({id: `${id}p${idx}`, ...it}) as ChatPart)
                    })
                ),
            tool = readAnswerTool(catalog, host),
            run = (input: object) => tool.execute(input, {chatModel} as any) as any;
        onTestFinished(() => host.destroy());
        artifacts.add({
            id: 'art_tech',
            columns: [
                {name: 'trader', type: 'string'},
                {name: 'pnlDay', type: 'number'}
            ],
            rows: [{trader: 'Secret Sam', pnlDay: -5}],
            totalRows: 1,
            metadata: {
                dataset: 'positions',
                request: {
                    dataset: 'positions',
                    params: {asOf},
                    groupBy: ['trader'],
                    filter: {field: 'sector', op: '=', value: 'Technology'}
                }
            }
        });
        return {run, reply, messages};
    }

    const showUi = (input: object): Partial<ChatPart> =>
        ({type: 'toolCall', toolName: 'show_ui', state: 'output-available', input}) as any;

    const chart = {
        sources: {tech: {artifact: 'art_tech'}},
        root: 'c',
        elements: {
            c: {
                component: 'chart',
                config: {source: 'tech', type: 'bar', x: 'trader', y: ['pnlDay']}
            }
        }
    };

    it('lists the answers of recent replies, by message and position', () => {
        const {run, reply} = setup();
        reply('m1', {type: 'text', text: 'Here.', state: 'done'} as any, showUi(chart));
        reply('m2', {
            type: 'toolCall',
            toolName: 'show_stat_cards',
            state: 'output-available',
            input: {cards: [{label: 'P&L', value: 5}]}
        } as any);
        expect(run({})).toEqual([
            {answer: 'm1:0', kind: 'show_ui', widgets: ['chart']},
            {answer: 'm2:0', kind: 'component', widgets: ['statCardStrip']}
        ]);
    });

    it("maps an artifact to the host's source that gives its rows, with its widget config", () => {
        const {run, reply} = setup();
        reply('m1', showUi(chart));
        const {blueprint, artifacts} = run({answer: 'm1:0'});
        expect(blueprint).toEqual(chart);
        expect(artifacts).toEqual([
            expect.objectContaining({
                id: 'art_tech',
                totalRows: 1,
                host: expect.objectContaining({
                    config: {
                        groupBy: ['trader'],
                        filter: {field: 'sector', op: '=', value: 'Technology'}
                    },
                    matches: ['positions']
                })
            })
        ]);
    });

    it("never gives an artifact's rows", () => {
        const {run, reply} = setup();
        reply('m1', showUi(chart));
        expect(JSON.stringify(run({answer: 'm1:0'}))).not.toContain('Secret Sam');
    });

    it('gives at most a capped number of the inline rows the model wrote, with their count', () => {
        const {run, reply} = setup(),
            rows = Array.from({length: 30}, (_, v) => ({x: `r${v}`, v}));
        reply(
            'm1',
            showUi({
                sources: {s: {inline: {fields: [{name: 'x', type: 'string'}], rows}}},
                root: 't',
                elements: {t: {component: 'text', config: {text: 'x'}}}
            })
        );
        const {inline} = run({answer: 'm1:0'}).blueprint.sources.s;
        expect(inline.rows).toHaveLength(READ_ANSWER_MAX_ROWS);
        expect(inline.rowCount).toBe(30);
    });

    it('gives the text of a program with state, as its blueprint exists only while it runs', () => {
        const program = 'root = Stack([note])\n$name = "Ann"\nnote = Text("Hi " + $name)',
            withPrograms = new ChatUiCatalog({
                components: [chatUiStackSpec(), chatUiTextSpec()],
                textFormats: [openUiLangFormat({root: 'stack', bindings: true})],
                modes: ['openui']
            }),
            message = new ChatMessage({
                id: 'm1',
                role: 'assistant',
                parts: [{id: 'p1', type: 'text', text: program, state: 'done'} as ChatPart]
            });
        expect(withPrograms.answersOf(message)).toEqual([
            {kind: 'program', partId: 'p1', source: program}
        ]);
    });

    it("reads only this chat's replies", () => {
        const {run, reply, messages} = setup();
        reply('m1', showUi(chart));
        messages.push(new ChatMessage({id: 'u1', role: 'user', content: 'hi'}));
        expect(() => run({answer: 'm9:0'})).toThrow(/no answer 'm9:0'/);
        expect(() => run({answer: 'm1:1'})).toThrow(/no answer/);
        expect(() => run({answer: 'u1:0'})).toThrow(/no answer/);
        expect(() => readAnswerTool(catalog, null).execute({}, null)).toThrow(/only in a chat/);
    });
});
