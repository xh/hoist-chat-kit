import {filler, span, vbox} from '@xh/hoist/cmp/layout';
import {statCard, statCardStrip} from '@xh/hoist/cmp/statcard';
import {hoistCmp, HoistModel, type HoistProps, managed, uses, XH} from '@xh/hoist/core';
import {castArray, dropRightWhile, isArray, isFinite, isString, omit} from 'lodash';
import {button} from '@xh/hoist/desktop/cmp/button';
import {toolbar} from '@xh/hoist/desktop/cmp/toolbar';
import {Icon} from '@xh/hoist/icon';
import {useEffect, useRef, useState} from 'react';
import {
    type BlueprintDataProvider,
    BlueprintModel,
    type FieldDef,
    runDatasetQueryAsync
} from '../../../../blueprint';
import {ChatUiCatalog} from '../../../../genui';
import {AnswerLoadGate} from '../../../../genui/impl/AnswerLoadGate';
import {CUBE_GRID_STYLES} from '../../../../blueprint/impl/builtInWidgets';
import {resolveFormat} from '../../../../blueprint/impl/formats';
import {chatArtifactProvider} from '../../../../genui/impl/answerData';
import {getArtifactRows} from '../../../../impl/ArtifactRows';
import {
    ChatUiAnswerHostContext,
    type ChatUiAnswerRenderProps
} from '../../../../genui/impl/specWidgets';
import {
    type BlueprintPanelFrame,
    BlueprintViewModel
} from '../../blueprint/impl/BlueprintViewModel';
import {chatUiFrame} from '../ChatUiFrame';
import './ChatUiAnswer.scss';
import {ChartWidgetModel} from '../../blueprint/ChartWidget';
import {CubeGridWidgetModel} from '../../blueprint/CubeGridWidget';
import {StatCardStripWidgetModel} from '../../blueprint/StatCardStripWidget';
import {chatUiChart, type ChatUiChartSpecProps} from '../ChatUiChart';
import {chatUiGrid, type ChatUiGridColumn} from '../ChatUiGrid';
import type {ChatUiNumberFormat} from '../Types';

interface ChatUiAnswerProps extends HoistProps, ChatUiAnswerRenderProps {}

/** An answer blueprint in a chat reply: its root element, with no toolbar or frame of its own. */
export const chatUiAnswer = hoistCmp.factory<ChatUiAnswerProps>({
    displayName: 'ChatUiAnswer',
    model: false,
    render(props) {
        // Owned here, not with useLocalModel(), as a document may render with no model context.
        // React may unmount and mount it again, as StrictMode does, so the cleanup clears what it
        // destroys, and a mount that finds no model renders again to make one.
        const held = useRef<ChatUiAnswerModel>(null),
            [, setMounts] = useState(0);
        held.current ??= new ChatUiAnswerModel(props as ChatUiAnswerProps);
        useEffect(() => {
            if (!held.current) setMounts(it => it + 1);
            return () => {
                XH.safeDestroy(held.current);
                held.current = null;
            };
        }, []);
        useEffect(() => held.current?.update(props as ChatUiAnswerProps));
        const impl = held.current,
            root = impl.viewModel.renderElement(impl.blueprintModel.blueprint?.root),
            {catalog, context} = props as ChatUiAnswerProps,
            canAdd =
                !context.isPartial && !!context.chatModel && !!catalog.addToHost?.isAvailable(),
            addBar = canAdd ? answerAddBar({answer: props as ChatUiAnswerProps}) : null,
            bar = impl.gate?.barState ? answerLoadBar({gate: impl.gate}) : null;
        return bar || addBar ? vbox(bar, root, addBar) : root;
    }
});

/**
 * A widget drawn as a panel in an answer, in the frame of chat kit's other cards: as tall as its
 * content, its frame's border and, with a title, its header strip.
 */
const answerFrame: BlueprintPanelFrame = ({title, contentHeight, children}) =>
    vbox({
        className: 'xh-chat-ui-answer-panel',
        height: `calc(${contentHeight}px + 2 * var(--xh-border-width)${
            title ? ' + var(--xh-chat-part-header-height, 28px)' : ''
        })`,
        width: '100%',
        flex: 'none',
        children: chatUiFrame({title, children})
    });

/** Adds a complete answer to the app's host. */
const answerAddBar = hoistCmp.factory<{answer: ChatUiAnswerProps} & HoistProps>({
    displayName: 'ChatUiAnswerAddBar',
    model: false,
    render({answer}) {
        const {catalog, context, blueprint} = answer,
            {addToHost} = catalog,
            {chatModel} = context;
        return toolbar({
            className: 'xh-chat-ui-answer-add-bar',
            compact: true,
            items: [
                filler(),
                button({
                    text: addToHost.label ?? 'Add to dashboard',
                    icon: Icon.add(),
                    minimal: true,
                    disabled: chatModel.isBusy,
                    onClick: () => {
                        const id = catalog.answerIdOf(context, blueprint?.root);
                        if (id) addToHost.add(id, chatModel);
                    }
                })
            ]
        });
    }
});

/**
 * Says why an answer's data waits, with the way on: an earlier reply loads once the user asks,
 * and a chat past its loads for the minute retries once the minute is up.
 */
export const answerLoadBar = hoistCmp.factory<{gate: AnswerLoadGate} & HoistProps>({
    displayName: 'ChatUiAnswerLoadBar',
    model: false,
    className: 'xh-chat-ui-answer-load-bar',
    render({gate, className}) {
        const isHeld = gate.barState === 'held';
        return toolbar({
            className,
            compact: true,
            items: [
                span(
                    isHeld
                        ? 'Data from an earlier reply.'
                        : 'This chat has loaded as much data as it may for a minute.'
                ),
                filler(),
                isHeld
                    ? button({
                          text: 'Load current data',
                          icon: Icon.refresh(),
                          onClick: () => gate.noteUserAction()
                      })
                    : button({
                          text: 'Retry',
                          icon: Icon.refresh(),
                          disabled: !gate.canRetry,
                          onClick: () => gate.retry()
                      })
            ]
        });
    }
});

ChatUiCatalog.answerRenderer = props => chatUiAnswer(props);

/** A statCardStrip drawn as chat kit's stat cards draw, on the chat's surface. */
const statCardsCard = hoistCmp.factory({
    displayName: 'ChatUiStatCardsCard',
    model: uses(StatCardStripWidgetModel),
    render({model}) {
        return statCardStrip({
            className: 'xh-chat-ui-stat-cards',
            children: model.cards.map(({title, value, subValue, detail, intent}, idx) =>
                statCard({key: idx, title, value, subValue, detail, intent})
            )
        });
    }
});

/** A cubeGrid drawn as chat kit's grid draws: a preview of its rows, and the full grid on Expand. */
const gridCard = hoistCmp.factory({
    displayName: 'ChatUiGridCard',
    model: uses(CubeGridWidgetModel),
    render({model}) {
        const {source, resolvedConfig: config, blueprintModel, id} = model,
            host = blueprintModel.hostContext as ChatUiAnswerHostContext;
        if (!source) return null;
        const isPartial = !!host?.isPartial(id),
            columns = castArray(config.columnState ?? [])
                .map(it => (isString(it) ? it : it?.field))
                .filter(it => source.fields[it])
                .map(it => toGridColumn(source.fields[it], blueprintModel));
        return chatUiGrid({
            title: config.title,
            columns,
            // Plain copies, without the key the source gives each row.
            rows: withStandIn(
                source.cube.store.records.map(it => omit({...it.data}, 'id')),
                {},
                isPartial
            ),
            sortBy: isString(config.sortBy) ? config.sortBy : null,
            isPartial
        });
    }
});

/** A chart drawn as chat kit's chart draws, with its menu, Expand and export. */
const chartCard = hoistCmp.factory({
    displayName: 'ChatUiChartCard',
    model: uses(ChartWidgetModel),
    render({model}) {
        const host = model.blueprintModel.hostContext as ChatUiAnswerHostContext,
            isPartial = !!host?.isPartial(model.id),
            props = toChatChartProps(model, isPartial);
        return props ? chatUiChart({...props, isPartial}) : null;
    }
});

/**
 * A chart's props as chat kit's chart takes them: the chart's own layout, with its y format as a
 * chat number format, and the points a chat chart would not have, which the Cube fills in as null,
 * left out. Null until the chart's source has a view.
 */
export function toChatChartProps(
    model: ChartWidgetModel,
    isPartial = false
): ChatUiChartSpecProps & {title?: string} {
    const layout = model.getLayoutProps();
    if (!layout) return null;
    const {source, resolvedConfig: config} = model,
        yField = source.fields[castArray(config.y ?? [])[0]],
        isDatetime = layout.xAxis?.type === 'datetime';
    // A pie names its slices in pairs, as a model writes them, where other charts take categories.
    const categories: string[] = layout.xAxis?.categories ?? [],
        isPie = layout.type === 'pie',
        // An axis with no title takes none, where the translation wrote it as empty text.
        xAxis = {...layout.xAxis, title: layout.xAxis?.title || null};
    if (isPie) delete xAxis.categories;
    return {
        ...(config.title ? {title: config.title} : {}),
        type: layout.type as ChatUiChartSpecProps['type'],
        xAxis: xAxis as ChatUiChartSpecProps['xAxis'],
        yAxis: {
            ...layout.yAxis,
            title: layout.yAxis?.title || null,
            ...(yField ? toChatFormat(yField, model.blueprintModel) : {})
        },
        series: (layout.series ?? []).map((it, idx, all) => ({
            ...it,
            data: withStandIn<unknown>(
                isDatetime
                    ? it.data.filter(point => isArray(point) && point[1] != null)
                    : isPie
                      ? it.data.map((value, pointIdx) => [categories[pointIdx], value])
                      : dropRightWhile(it.data, point => point == null),
                null,
                isPartial && idx === all.length - 1
            )
        }))
    } as ChatUiChartSpecProps & {title?: string};
}

ChatUiCatalog.answerPresentations.push({
    widget: 'chart',
    presentation: {
        name: 'card',
        label: 'Card',
        guidance: 'Draws the chart as a chat reply does, with its menu, Expand and export.',
        component: chartCard
    }
});

ChatUiCatalog.answerPresentations.push({
    widget: 'cubeGrid',
    presentation: {
        name: 'card',
        label: 'Card',
        guidance:
            'Draws the grid as a chat reply does: a preview of the first rows and columns, with the full grid on Expand.',
        component: gridCard,
        // It draws the source's rows flat, as they are.
        ignores: [...CUBE_GRID_STYLES, 'groupBy', 'filter', 'expandLevel', 'summaryRow']
    }
});

ChatUiCatalog.answerPresentations.push({
    widget: 'statCardStrip',
    presentation: {
        name: 'card',
        label: 'Card',
        guidance: 'Draws the cards as a chat reply does, on the surface of the chat.',
        component: statCardsCard
    }
});

//------------------
// Implementation
//------------------
class ChatUiAnswerModel extends HoistModel {
    @managed readonly host: ChatUiAnswerHostContext;
    /** Bounds the answer's loads within its chat. Null for an answer shown outside a chat. */
    @managed readonly gate: AnswerLoadGate;
    @managed readonly blueprintModel: BlueprintModel;
    @managed readonly viewModel: BlueprintViewModel;

    constructor(props: ChatUiAnswerRenderProps) {
        super();
        const {catalog, dataCatalog, artifacts, artifactRegistry, context} = props,
            {chatModel, messageId} = context,
            provider = props.dataProvider ?? NO_DATASETS;
        this.host = new ChatUiAnswerHostContext(context);
        this.gate = chatModel ? new AnswerLoadGate({provider, chatModel, messageId}) : null;
        // Opened empty, then updated, as the constructor checks a blueprint in full.
        this.blueprintModel = new BlueprintModel({
            catalog: dataCatalog,
            artifacts,
            // A query's artifact shows the rows the model saw, or once they are gone, as after a
            // reload, runs its request again within the bounds.
            artifactProvider: chatArtifactProvider(artifactRegistry, {
                rowsOf: id => getArtifactRows(chatModel, id),
                query: request =>
                    runDatasetQueryAsync(request, {
                        catalogs: [this.blueprintModel.catalog],
                        dataProvider: this.gate ?? provider
                    })
            }),
            registry: catalog.registry,
            dataProvider: this.gate ?? provider,
            isAnswer: true,
            hostContext: this.host,
            // An answer draws as a chat reply does, with no size to fill.
            defaultPresentation: 'card'
        });
        this.update(props);
        this.viewModel = new BlueprintViewModel(this.blueprintModel, {framePanel: answerFrame});
        this.addReaction({
            track: () => this.blueprintModel.userActedAt,
            run: () => this.gate?.noteUserAction()
        });
    }

    update({
        blueprint,
        context,
        partialIds,
        writingIds,
        bindings,
        dataCatalog,
        artifacts
    }: ChatUiAnswerRenderProps) {
        this.host.update(context, partialIds, writingIds, bindings);
        const errors = this.blueprintModel
            .updateBlueprint(blueprint, {partialIds, catalog: dataCatalog, artifacts})
            .filter(it => it.severity === 'error');
        if (errors.length) this.logError('An answer that degraded still has errors', errors);
    }
}

// A field as a chat grid column, the reverse of how an inline grid's columns become fields.
function toGridColumn(def: FieldDef, blueprintModel: BlueprintModel): ChatUiGridColumn {
    const ret: ChatUiGridColumn = {
        field: def.name,
        type: toChatType(def),
        ...(def.label ? {headerName: def.label} : {})
    };
    return ret.type === 'number' ? {...ret, ...toChatFormat(def, blueprintModel)} : ret;
}

function toChatType(def: FieldDef): ChatUiGridColumn['type'] {
    if (def.type === 'localDate' || def.type === 'date') return 'date';
    if (def.type === 'bool') return 'boolean';
    return def.type === 'number' || def.type === 'int' ? 'number' : 'string';
}

// A number field's format as a chat number format, the reverse of how a chat format becomes one.
// Reads the format the field shows with, through its kind, as a catalog's `chance` is a fraction.
function toChatFormat(
    def: FieldDef,
    {catalog, blueprint}: BlueprintModel
): {format: ChatUiNumberFormat; decimals?: number} {
    const format = resolveFormat(def, [], {catalog, blueprint}),
        base = catalog?.kinds[def.kind]?.base ?? def.kind;
    return {
        format:
            base === 'fraction'
                ? 'percent'
                : format.prefix === '$'
                  ? 'currency'
                  : format.withCommas === false
                    ? 'none'
                    : 'number',
        ...(isFinite(format.precision) ? {decimals: format.precision} : {})
    };
}

/**
 * Items with one stand-in after them while the answer streams. Chat kit's grid and chart leave out
 * their last item then, as it may be cut short. The translation already did, so they drop this.
 */
function withStandIn<T>(items: T[], standIn: T, isPartial: boolean): T[] {
    return isPartial ? [...items, standIn] : items;
}

const NO_DATASETS: BlueprintDataProvider = {
    loadAsync: () => Promise.reject(new Error('A chat answer reads no datasets yet.'))
};
