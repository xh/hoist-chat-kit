import {dropRight, escape, isFinite, isPlainObject, isString} from 'lodash';
import {div} from '@xh/hoist/cmp/layout';
import {treeMap, TreeMapModel} from '@xh/hoist/cmp/treemap';
import {
    creates,
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject
} from '@xh/hoist/core';
import {Store, type StoreRecord} from '@xh/hoist/data';
import {Icon} from '@xh/hoist/icon';
import {computed} from '@xh/hoist/mobx';
import type {ChatUiComponentSpec} from '../../../genui';
import {
    CHAT_UI_DECIMALS_SCHEMA,
    CHAT_UI_NUMBER_FORMAT_SCHEMA,
    fmtChatUiNumber
} from './ChatUiFormat';
import {chatUiFrame, chatUiSkeleton} from './ChatUiFrame';
import type {ChatUiNumberFormat, ChatUiSpecOptions} from './Types';
import './ChatUiTreeMap.scss';

/** One box of a {@link ChatUiTreeMap}, as written by the model. */
export interface ChatUiTreeMapNode {
    /** Name of the box, such as `Rates`. */
    label: string;

    /** Size of the box. The box takes the absolute value, and a zero shows no box. */
    value: number;

    /**
     * Sets the color of the box: green above zero and red below, stronger the further from zero.
     * Default none - a neutral box.
     */
    heat?: number;
}

/** Props of a {@link ChatUiTreeMap}, as written by the model. */
export interface ChatUiTreeMapSpecProps {
    /** Title of the treemap, shown in its header strip. */
    title?: string;

    /** The boxes. */
    nodes: ChatUiTreeMapNode[];

    /** How a value displays in the tooltip. Default `number`. */
    format?: ChatUiNumberFormat;

    /** Decimal places for a value. Default suits the value and the format. */
    decimals?: number;

    /** What the heat measures, such as `Day change`. Names it in the tooltip. Default `Heat`. */
    heatLabel?: string;

    /** How a heat displays in the tooltip. Default `number`. */
    heatFormat?: ChatUiNumberFormat;
}

/** Options for {@link chatUiTreeMapSpec}. */
export interface ChatUiTreeMapSpecOptions extends ChatUiSpecOptions {
    /** Most boxes the model may send. Default 60. */
    maxNodes?: number;

    /** Height of the treemap, in pixels. Default the `--xh-chat-chart-height` CSS variable. */
    height?: number;
}

/**
 * A treemap component for a {@link ChatUiCatalog}: boxes sized by one number and colored by
 * another, for the parts of a whole. It renders Hoist's `TreeMap`, over a `TreeMapModel` and a
 * `Store` that it creates once and loads as the boxes stream in.
 *
 * The treemap needs Highcharts with two modules, which the app imports in its `Bootstrap.ts`:
 * `highcharts/modules/heatmap`, then `highcharts/modules/treemap`. The first holds the color axis
 * that colors a box by its heat. With no heatmap module, every box takes one default color.
 *
 * The model writes the boxes before the formats, so that `Treemap("Title", [...])` is a whole
 * call in OpenUI Lang. The tooltip reads the formats when it shows.
 *
 * The model's tool is `show_treemap`, unless renamed with `name`.
 */
export function chatUiTreeMapSpec(
    opts: ChatUiTreeMapSpecOptions = {}
): ChatUiComponentSpec<ChatUiTreeMapSpecProps> {
    const {name = 'treemap', description = DESCRIPTION, maxNodes = 60, height} = opts;

    return {
        name,
        description,
        props: {
            type: 'object',
            required: ['nodes'],
            additionalProperties: false,
            properties: {
                title: {type: 'string', maxLength: 120},
                nodes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: maxNodes,
                    items: {
                        type: 'object',
                        required: ['label', 'value'],
                        additionalProperties: false,
                        properties: {
                            label: {type: 'string', minLength: 1, maxLength: 60},
                            value: {
                                type: 'number',
                                description: 'Size of the box. Its sign is ignored.'
                            },
                            heat: {
                                type: 'number',
                                description:
                                    'Color of the box: green above zero, red below, stronger ' +
                                    'further from zero. Default a neutral box.'
                            }
                        }
                    }
                },
                format: CHAT_UI_NUMBER_FORMAT_SCHEMA,
                decimals: CHAT_UI_DECIMALS_SCHEMA,
                heatLabel: {
                    type: 'string',
                    maxLength: 40,
                    description: 'What the heat measures - e.g. "Day change".'
                },
                heatFormat: {
                    ...CHAT_UI_NUMBER_FORMAT_SCHEMA,
                    description: 'How to display the heat. Default "number".'
                }
            }
        },
        render: (props, {isPartial}) => chatUiTreeMap({...props, height, isPartial}),
        example: {
            title: 'Exposure by desk',
            nodes: [
                {label: 'Rates', value: 4200000, heat: 0.012},
                {label: 'Credit', value: 2600000, heat: -0.008},
                {label: 'FX', value: 1100000}
            ],
            format: 'currency',
            decimals: 0,
            heatLabel: 'Day change',
            heatFormat: 'percent'
        }
    };
}

/** Props for {@link ChatUiTreeMap}. */
export interface ChatUiTreeMapProps extends HoistProps, Partial<ChatUiTreeMapSpecProps> {
    /** Height of the treemap, in pixels. Default the `--xh-chat-chart-height` CSS variable. */
    height?: number;

    /** True while the props stream. The last box is left out, as it may be cut short. */
    isPartial?: boolean;
}

/**
 * Boxes sized by one number and colored by another - the component that
 * {@link chatUiTreeMapSpec} renders. It owns one Hoist `TreeMapModel` and its `Store` for its
 * life, and loads the store as the boxes change. Labels are escaped, as Highcharts reads a label
 * as HTML.
 */
export const [ChatUiTreeMap, chatUiTreeMap] = hoistCmp.withFactory<ChatUiTreeMapProps>({
    displayName: 'ChatUiTreeMap',
    className: 'xh-chat-ui-treemap',
    // Its own model, kept out of context, so that it needs no model above it.
    model: creates(() => new ChatUiTreeMapLocalModel(), {publishMode: 'none'}),

    render({model, className, title, height, isPartial}) {
        const impl = model as ChatUiTreeMapLocalModel,
            {hasBoxes, treeMapModel} = impl,
            isBuilding = isPartial && !hasBoxes;

        return chatUiFrame({
            className,
            title,
            icon: Icon.treeList(),
            status: isBuilding && !title ? 'Building treemap…' : null,
            item: div({
                className: 'xh-chat-ui-treemap__body',
                style: height ? {height} : null,
                item: isBuilding
                    ? chatUiSkeleton(null)
                    : hasBoxes
                      ? treeMap({model: treeMapModel})
                      : div({
                            className: 'xh-chat-ui-center',
                            role: 'note',
                            item: 'No values to show.'
                        })
            })
        });
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A treemap: one box per item, sized by its value and optionally colored by a second ' +
    'number, its heat. Use it for the parts of a whole where relative size matters, such as ' +
    'exposure by desk colored by the day change. Prefer a chart for a trend, and a grid when ' +
    'exact values matter.';

class ChatUiTreeMapLocalModel extends HoistModel {
    override xhImpl = true;

    @managed store = new Store({
        fields: [
            {name: 'name', type: 'string'},
            {name: 'value', type: 'number'},
            {name: 'heat', type: 'number'}
        ]
    });

    @managed treeMapModel = new TreeMapModel({
        store: this.store,
        labelField: 'name',
        valueField: 'value',
        heatField: 'heat',
        tooltip: record => this.renderTooltip(record)
    });

    get props(): ChatUiTreeMapProps {
        return this.componentProps as ChatUiTreeMapProps;
    }

    /**
     * The complete boxes, as store data. Highcharts reads a name as HTML, so it is escaped. A box
     * with no heat is neutral, as are boxes whose heats are all zero.
     */
    @computed
    get rows(): PlainObject[] {
        const {nodes, isPartial} = this.props,
            // While streaming, the last box may be cut short - its value still being written.
            complete = (isPartial ? dropRight(nodes) : (nodes ?? [])).filter(
                it => isPlainObject(it) && isString(it.label) && isFinite(it.value)
            );

        return complete.map(({label, value, heat}, idx) => ({
            id: idx,
            name: escape(label),
            value,
            heat: isFinite(heat) ? heat : null
        }));
    }

    /** True if any complete box has a size. Hoist's TreeMap draws no box for a zero. */
    @computed
    get hasBoxes(): boolean {
        return this.rows.some(it => it.value !== 0);
    }

    override onLinked() {
        super.onLinked();
        this.addReaction({
            track: () => this.rows,
            run: rows => this.store.loadData(rows),
            equals: 'structural',
            fireImmediately: true
        });
    }

    // Hoist's own tooltip markup, with the model's label for the heat and the chat's formats.
    private renderTooltip(record: StoreRecord): string {
        const {format, decimals, heatLabel, heatFormat} = this.props,
            {name, value, heat} = record.data,
            row = (label: string, html: unknown) =>
                `<div class='xh-treemap-tooltip__row'><div>${label}:</div><div>${html}</div></div>`;

        return (
            `<div class='xh-treemap-tooltip'>` +
            `<div class='xh-treemap-tooltip__label'>${name}</div>` +
            row('Value', fmtChatUiNumber(value, format, decimals, {asHtml: true})) +
            (isFinite(heat)
                ? row(
                      escape(heatLabel || 'Heat'),
                      fmtChatUiNumber(heat, heatFormat, null, {asHtml: true, withSignGlyph: true})
                  )
                : '') +
            `</div>`
        );
    }
}
