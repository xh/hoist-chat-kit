import {render} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import type {PlainObject} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactNode} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatModel, type ChatTextPart} from '../../core';
import {ScriptedChatTransport, textEvents} from '../../transport';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import type {ChatUiDocumentSegment} from '../ChatUiTextSegment';
import {openUiLangFormat} from './OpenUiLangFormat';

/**
 * A program with state, as it streams into a rendered message one character at a time. Each
 * prefix must render what has arrived, with no fallback: a statement still being written is
 * partial, not wrong.
 */
describe('OpenUI Lang streaming with state', () => {
    beforeAll(() => initTestAppAsync());

    const GRID_PROGRAM =
            'root = Stack([table])\n' +
            '$sector = "Rates"\n' +
            'positions = Query("query_positions", {sector: $sector}, {firstRows: []})\n' +
            'table = Grid($sector + " by region", [{field: "region"}, {field: "pnl"}], null, positions.firstRows)',
        CARDS_PROGRAM =
            'root = Stack([cards])\n' +
            'desks = [{name: "Rates", pnl: 4200000}, {name: "Credit", pnl: -1300000}]\n' +
            'cards = Stack(@Each(desks, "desk", Card(desk.name, "Desk", [{label: "P&L", value: desk.pnl, format: "currency", decimals: 0}])), "row")';

    it('keeps a statement partial while its last argument is a name still being written', () => {
        const catalog = createCatalog(),
            at = GRID_PROGRAM.lastIndexOf('positions.firstRows');
        for (let end = at + 1; end <= at + 'positions'.length; end++) {
            const [segment] = catalog.parseText(GRID_PROGRAM.slice(0, end), {
                isStreaming: true,
                messageId: 'm1',
                partId: 'p1'
            }) as ChatUiDocumentSegment[];

            expect(segment.type).toBe('document');
            expect(segment.elementErrors).toBeUndefined();
            expect(segment.document.elements.table).toMatchObject({isPartial: true});
        }
    });

    it.each<[string, string]>([
        ['a grid whose rows a query gives', GRID_PROGRAM],
        ['cards that an @Each makes', CARDS_PROGRAM]
    ])('renders %s with no fallback at any character', (_, program) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
            error = vi.spyOn(console, 'error').mockImplementation(() => {});
        onTestFinished(() => {
            warn.mockRestore();
            error.mockRestore();
        });
        const catalog = createCatalog(),
            chatModel = createChatModel(),
            view = (text: string, isStreaming: boolean): ReactNode =>
                fragment(
                    catalog
                        .parseText(text, {isStreaming, messageId: 'm1', partId: 'p1'})
                        .map((it, idx) =>
                            div({
                                key: idx,
                                item: catalog.renderSegment(it, {
                                    chatModel,
                                    messageId: 'm1',
                                    part: PART
                                })
                            })
                        )
                ),
            {container, rerender} = render(view(program.slice(0, 1), true));

        for (let end = 2; end <= program.length; end++) {
            rerender(view(program.slice(0, end), end < program.length));
            expect(`${end}: ${container.textContent}`).not.toContain('could not be displayed');
        }
        rerender(view(program, false));
        expect(container.textContent).not.toContain('could not be displayed');
        expect(warn.mock.calls.flat().join(' ')).not.toContain('could not be displayed');
        expect(error).not.toHaveBeenCalled();
        expect(container.textContent).toContain(
            program === GRID_PROGRAM ? 'Rates by region' : 'Credit'
        );
    });

    it('shows why a program was refused, in the fallback itself', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        onTestFinished(() => warn.mockRestore());
        const catalog = createCatalog(),
            [segment] = catalog.parseText(
                'root = Stack([cards])\ncards = Stack(@Each([1, 2], item, Card("A", "B", [])))',
                {messageId: 'm1', partId: 'p1'}
            ),
            {container} = render(
                fragment(
                    catalog.renderSegment(segment, {
                        chatModel: createChatModel(),
                        messageId: 'm1',
                        part: PART
                    })
                )
            );

        expect(container.textContent).toContain('names the variable of an @Each');
        expect(container.textContent).not.toContain('This content could not be displayed.');
    });
});

//------------------
// Helpers
//------------------
const PART: ChatTextPart = {type: 'text', id: 'p1', text: '', state: 'done'};

const STACK: ChatUiComponentSpec = {
        name: 'stack',
        description: 'A stack.',
        props: {
            type: 'object',
            additionalProperties: false,
            properties: {direction: {enum: ['column', 'row']}}
        },
        slots: ['default'],
        standalone: false,
        render: (_, {children}) => fragment({items: children})
    },
    // A table with a required list of rows, as the built-in grid has.
    GRID: ChatUiComponentSpec = {
        name: 'grid',
        description: 'A table.',
        props: {
            type: 'object',
            required: ['columns', 'rows'],
            additionalProperties: false,
            properties: {
                title: {type: 'string'},
                columns: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['field'],
                        additionalProperties: false,
                        properties: {field: {type: 'string'}}
                    }
                },
                sortBy: {type: 'string'},
                rows: {type: 'array', items: {type: 'object'}}
            }
        },
        render: ({title}: PlainObject) => div(title)
    },
    // A card with a list of fields that takes no unknown key, as the built-in card has.
    CARD: ChatUiComponentSpec = {
        name: 'card',
        description: 'A card.',
        props: {
            type: 'object',
            required: ['title'],
            additionalProperties: false,
            properties: {
                title: {type: 'string'},
                subtitle: {type: 'string'},
                fields: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['label', 'value'],
                        additionalProperties: false,
                        properties: {
                            label: {type: 'string'},
                            value: {type: ['string', 'number']},
                            format: {enum: ['number', 'percent', 'currency', 'none']},
                            decimals: {type: 'integer'}
                        }
                    }
                }
            }
        },
        render: ({title, fields}: PlainObject) =>
            div(`${title}: ${(fields ?? []).map((it: PlainObject) => it.label).join(',')}`)
    };

function createCatalog(): ChatUiCatalog {
    return new ChatUiCatalog({
        components: [STACK, GRID, CARD],
        textFormats: [
            openUiLangFormat({root: 'stack', bindings: true, queryTools: ['query_positions']})
        ],
        modes: ['openui']
    });
}

function createChatModel(): ChatModel {
    const chatModel = new ChatModel({
        initialMessages: [{id: 'm1', role: 'assistant', parts: []}],
        tools: [
            {
                name: 'query_positions',
                parameters: {type: 'object', properties: {sector: {type: 'string'}}},
                execute: async () => ({firstRows: [{region: 'EMEA', pnl: 1}]})
            }
        ],
        transport: new ScriptedChatTransport({respond: () => textEvents('Done.')})
    });
    onTestFinished(() => chatModel.destroy());
    return chatModel;
}
