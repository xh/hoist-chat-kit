import {statCard, statCardStrip} from '@xh/hoist/cmp/statcard';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    managed,
    type PlainObject,
    uses,
    XH
} from '@xh/hoist/core';
import {castArray, isFinite, isPlainObject, isString, omit} from 'lodash';
import {useOnUnmount} from '@xh/hoist/utils/react';
import {useEffect, useState} from 'react';
import {type BlueprintDataProvider, BlueprintModel, type FieldDef} from '../../../../blueprint';
import {ChatUiCatalog} from '../../../../genui';
import {
    ChatUiAnswerHostContext,
    type ChatUiAnswerRenderProps
} from '../../../../genui/impl/specWidgets';
import {BlueprintViewModel} from '../../blueprint/impl/BlueprintViewModel';
import {CubeGridWidgetModel} from '../../blueprint/CubeGridWidget';
import {StatCardStripWidgetModel} from '../../blueprint/StatCardStripWidget';
import {chatUiGrid, type ChatUiGridColumn} from '../ChatUiGrid';

interface ChatUiAnswerProps extends HoistProps, ChatUiAnswerRenderProps {}

/** An answer blueprint in a chat reply: its root element, with no toolbar or frame of its own. */
export const chatUiAnswer = hoistCmp.factory<ChatUiAnswerProps>({
    displayName: 'ChatUiAnswer',
    model: false,
    render(props) {
        // Owned here, not with useLocalModel(), as a document may render with no model context.
        const [impl] = useState(() => new ChatUiAnswerModel(props as ChatUiAnswerProps));
        useOnUnmount(() => XH.safeDestroy(impl));
        useEffect(() => impl.update(props as ChatUiAnswerProps));
        return impl.viewModel.renderElement(impl.blueprintModel.blueprint?.root);
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
        const columns = castArray(config.columnState ?? [])
            .map(it => (isString(it) ? it : it?.field))
            .filter(it => source.fields[it])
            .map(it => toGridColumn(source.fields[it]));
        return chatUiGrid({
            title: config.title,
            columns,
            // Plain copies, without the key the source gives each row.
            rows: source.cube.store.records.map(it => omit({...it.data}, 'id')),
            sortBy: isString(config.sortBy) ? config.sortBy : null,
            isPartial: !!host?.isPartial(id)
        });
    }
});

ChatUiCatalog.answerPresentations.push({
    widget: 'cubeGrid',
    presentation: {
        name: 'card',
        label: 'Card',
        guidance:
            'Draws the grid as a chat reply does: a preview of the first rows and columns, with the full grid on Expand.',
        component: gridCard
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
    @managed readonly blueprintModel: BlueprintModel;
    @managed readonly viewModel: BlueprintViewModel;

    constructor(props: ChatUiAnswerRenderProps) {
        super();
        const {catalog, dataCatalog, context} = props;
        this.host = new ChatUiAnswerHostContext(context);
        // Opened empty, then updated, as the constructor checks a blueprint in full.
        this.blueprintModel = new BlueprintModel({
            catalog: dataCatalog,
            registry: catalog.registry,
            dataProvider: NO_DATASETS,
            isAnswer: true,
            hostContext: this.host
        });
        this.update(props);
        this.viewModel = new BlueprintViewModel(this.blueprintModel);
    }

    update({blueprint, context, partialIds, writingIds}: ChatUiAnswerRenderProps) {
        this.host.update(context, partialIds, writingIds);
        const errors = this.blueprintModel
            .updateBlueprint(blueprint, {partialIds})
            .filter(it => it.severity === 'error');
        if (errors.length) this.logError('An answer that degraded still has errors', errors);
    }
}

// A field as a chat grid column, the reverse of how an inline grid's columns become fields.
function toGridColumn(def: FieldDef): ChatUiGridColumn {
    const type =
            def.type === 'localDate' || def.type === 'date'
                ? 'date'
                : def.type === 'bool'
                  ? 'boolean'
                  : def.type === 'number' || def.type === 'int'
                    ? 'number'
                    : 'string',
        ret: ChatUiGridColumn = {
            field: def.name,
            type,
            ...(def.label ? {headerName: def.label} : {})
        };
    if (type !== 'number') return ret;
    const format = (isPlainObject(def.format) ? def.format : {}) as PlainObject;
    return {
        ...ret,
        format:
            def.kind === 'fraction'
                ? 'percent'
                : format.prefix === '$'
                  ? 'currency'
                  : format.withCommas === false
                    ? 'none'
                    : 'number',
        ...(isFinite(format.precision) ? {decimals: format.precision} : {})
    };
}

const NO_DATASETS: BlueprintDataProvider = {
    loadAsync: () => Promise.reject(new Error('A chat answer reads no datasets yet.'))
};
