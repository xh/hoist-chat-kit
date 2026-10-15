import {isString} from 'lodash';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import type {ChatAssistantModel} from '../../../../assist';
import type {ChatToolCallPart} from '../../../../core';
import {chatSpinner} from '../../chat';

/** @internal */
interface ChatAssistantPartProps extends HoistProps {
    part: ChatToolCallPart;
    assistant: ChatAssistantModel;
}

/**
 * Give a helper the renderers of its tool calls: each change as one line - a check and what
 * changed, in past tense, with Show - and the Ask in chat button.
 * @internal
 */
export function installChatAssistantRenderers(assistant: ChatAssistantModel) {
    const {renderers} = assistant;
    if (renderers.changeLine) return;
    renderers.changeLine = part => chatAssistantChangeLine({part, assistant});
    renderers.askInChat = part => chatAssistantAskInChat({part, assistant});
}

/**
 * One change a tool call made, as a line: a spinner while it runs, then a check and the tool's
 * own past-tense result, with Show to flash the change again on the component. A call waiting for
 * approval, failed or denied shows through the call's own approval card and caption.
 * @internal
 */
export const chatAssistantChangeLine = hoistCmp.factory<ChatAssistantPartProps>({
    displayName: 'ChatAssistantChangeLine',
    model: false,
    className: 'xh-chat-hline',

    render({className, part, assistant}) {
        const {state, id: toolCallId, toolName, output} = part;
        if (state === 'input-available' || state === 'running') {
            const spec = assistant.chatModel?.getToolSpec(toolName);
            return div({
                className: `${className} xh-chat-hline--running`,
                items: [
                    span({className: 'xh-chat-hline__icon', item: chatSpinner()}),
                    span({
                        className: 'xh-chat-hline__text',
                        item: `${spec?.displayName ?? toolName}…`
                    })
                ]
            });
        }
        if (state !== 'output-available') return null;

        const canShow =
            assistant.canShowChange(toolCallId) && !!assistant.getChangeTargets(toolCallId);
        return div({
            className,
            items: [
                span({className: 'xh-chat-hline__icon', item: Icon.check()}),
                span({
                    className: 'xh-chat-hline__text',
                    item: isString(output) ? output : 'Done.'
                }),
                canShow
                    ? button({
                          className: 'xh-chat-hline__show',
                          text: 'Show',
                          minimal: true,
                          onClick: () => assistant.showChange(toolCallId)
                      })
                    : null
            ]
        });
    }
});

/**
 * The Ask in chat button, which the model offers for a question about anything other than the
 * component. A click asks the question in the app's main chat.
 * @internal
 */
export const chatAssistantAskInChat = hoistCmp.factory<ChatAssistantPartProps>({
    displayName: 'ChatAssistantAskInChat',
    model: false,
    className: 'xh-chat-assistant-ask',

    render({className, part, assistant}) {
        const question = part.input?.question;
        if (part.state !== 'output-available' || !isString(question) || !question.trim()) {
            return null;
        }
        return div({
            className,
            item: button({
                icon: Icon.comment(),
                text: 'Ask in chat',
                outlined: true,
                title: question,
                onClick: () => assistant.askInChat(question)
            })
        });
    }
});
