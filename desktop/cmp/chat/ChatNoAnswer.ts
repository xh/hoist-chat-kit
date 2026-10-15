import {take} from 'lodash';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {pluralize} from '@xh/hoist/utils/js';
import type {ChatDataPart, ChatNoAnswerData} from '../../../core';
import '../../../styles/vars.scss';
import './ChatNoAnswer.scss';

/** Props for {@link ChatNoAnswer}. */
export interface ChatNoAnswerProps extends HoistProps {
    /** The reply's `xh.chat.noAnswer` data part. */
    part: ChatDataPart;

    /** Called on Edit Question. Shows the button if given. */
    onEditQuestion?: () => void;
}

/**
 * The fixed "not found" reply, for a data part of type `xh.chat.noAnswer`: a template in a dotted
 * frame, tagged "Fixed reply", that says nothing was found and lists the documents searched. Its
 * wording never comes from the model, so it cannot read as a generated answer.
 *
 * The message view renders it for the part by default. Register a renderer for the type in the
 * chat's `dataRenderers` to replace it.
 */
export const [ChatNoAnswer, chatNoAnswer] = hoistCmp.withFactory<ChatNoAnswerProps>({
    displayName: 'ChatNoAnswer',
    model: false,
    className: 'xh-chat-no-answer',

    render({className, part, onEditQuestion}, ref) {
        const data: ChatNoAnswerData = part?.data ?? {},
            documents = data.documents ?? [],
            count = data.documentCount ?? (documents.length || null),
            searched = count != null ? `the ${pluralize('document', count, true)} searched` : null;

        // TODO: offer "Search All N Documents" when the scope was narrower than all, once the
        // chat can resend a question with a wider scope.
        return div({
            ref,
            className,
            role: 'note',
            'aria-label': 'Fixed reply',
            items: [
                div({
                    className: 'xh-chat-no-answer__title',
                    items: [
                        Icon.search(),
                        span({
                            className: 'xh-chat-no-answer__title-text',
                            item: searched ? 'Not found in the selected documents' : 'Not found'
                        }),
                        span({className: 'xh-chat-no-answer__tag', item: 'Fixed reply'})
                    ]
                }),
                div({
                    className: 'xh-chat-no-answer__message',
                    item:
                        `I couldn't find this in ${searched ?? 'the documents searched'}, so I ` +
                        "haven't answered. Nothing here is generated from general knowledge."
                }),
                documents.length
                    ? div({
                          className: 'xh-chat-no-answer__scope',
                          items: [
                              span({
                                  className: 'xh-chat-no-answer__scope-names',
                                  item: `Searched: ${formatNames(documents.map(it => it.name))}`
                              }),
                              span({
                                  className: 'xh-chat-no-answer__scope-count',
                                  item: `Searched: ${pluralize('document', count, true)}`
                              })
                          ]
                      })
                    : null,
                onEditQuestion
                    ? div({
                          className: 'xh-chat-no-answer__buttons',
                          item: button({
                              icon: Icon.edit(),
                              text: 'Edit Question',
                              onClick: onEditQuestion
                          })
                      })
                    : null
            ]
        });
    }
});

// Up to three names, then "+N".
function formatNames(names: string[]): string {
    const shown = take(names, MAX_NAMES).join(', '),
        more = names.length - MAX_NAMES;
    return more > 0 ? `${shown} +${more}` : shown;
}

const MAX_NAMES = 3;
