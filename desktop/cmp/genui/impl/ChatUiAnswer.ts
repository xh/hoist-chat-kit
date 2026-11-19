import {hoistCmp, HoistModel, type HoistProps, managed, XH} from '@xh/hoist/core';
import {useOnUnmount} from '@xh/hoist/utils/react';
import {useEffect, useState} from 'react';
import {type BlueprintDataProvider, BlueprintModel} from '../../../../blueprint';
import {ChatUiCatalog} from '../../../../genui';
import {
    ChatUiAnswerHostContext,
    type ChatUiAnswerRenderProps
} from '../../../../genui/impl/specWidgets';
import {BlueprintViewModel} from '../../blueprint/impl/BlueprintViewModel';

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

//------------------
// Implementation
//------------------
class ChatUiAnswerModel extends HoistModel {
    @managed readonly host: ChatUiAnswerHostContext;
    @managed readonly blueprintModel: BlueprintModel;
    @managed readonly viewModel: BlueprintViewModel;

    constructor({blueprint, catalog, dataCatalog, context}: ChatUiAnswerRenderProps) {
        super();
        this.host = new ChatUiAnswerHostContext(context);
        this.blueprintModel = new BlueprintModel({
            blueprint,
            catalog: dataCatalog,
            registry: catalog.registry,
            dataProvider: NO_DATASETS,
            isAnswer: true,
            hostContext: this.host
        });
        this.viewModel = new BlueprintViewModel(this.blueprintModel);
    }

    update({blueprint, context, completeIds}: ChatUiAnswerRenderProps) {
        this.host.update(context, completeIds);
        const errors = this.blueprintModel
            .updateBlueprint(blueprint)
            .filter(it => it.severity === 'error');
        if (errors.length) this.logError('An answer that degraded still has errors', errors);
    }
}

const NO_DATASETS: BlueprintDataProvider = {
    loadAsync: () => Promise.reject(new Error('A chat answer reads no datasets yet.'))
};
