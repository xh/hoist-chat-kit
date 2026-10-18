import {isEmpty, take, without} from 'lodash';
import type {ReactElement} from 'react';
import {useState} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {checkbox, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {throwIf} from '@xh/hoist/utils/js';
import {ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import {chatComposerPill} from './ChatComposerPill';
import './ChatScopeChip.scss';

/** A document the user can scope a question to - see {@link ChatScopeChip}. */
export interface ChatScopeDocument {
    /** Unique id, recorded in the run options. */
    id: string;

    /** Name to show. */
    name: string;

    /** Icon before the name. Default a file icon. */
    icon?: ReactElement;
}

/** Props for {@link ChatScopeChip}. */
export interface ChatScopeChipProps extends HoistProps<ChatModel> {
    /** The documents to choose from. */
    documents: ChatScopeDocument[];

    /**
     * Key of the selection in `ChatModel.runOptions`, as an array of document ids. Default
     * 'documentIds'.
     */
    runOption?: string;

    /**
     * Ids of the selected documents, in place of the chat's run options. Pass it with
     * `onChange` to keep the selection in the app's own state. Empty means all documents.
     */
    value?: string[];

    /** Called with the new selection, in place of writing the chat's run options. */
    onChange?: (ids: string[]) => void;

    /** Show a search box above the list once it holds more documents than this. Default 8. */
    searchThreshold?: number;

    /** Tooltip. Default the names of the selected documents. */
    tooltip?: string;
}

/**
 * A composer pill that scopes the next question to some of the app's documents - "All documents"
 * when none are chosen, else "Documents" with the count chosen. It opens a list of checkboxes,
 * with a search box for a long list, and Clear.
 *
 * By default the chip binds to the chat's `runOptions`, under `documentIds`, so each question
 * records the scope it was asked with, and a retry, regenerate or edit re-runs with it. Under a
 * thread layer, the scope belongs to the thread. Pass `value` and `onChange` to bind it to the
 * app's own state instead.
 *
 * Shows each document's icon and name only. A document service may not report page counts or
 * sizes, so the chip never shows them.
 */
export const [ChatScopeChip, chatScopeChip] = hoistCmp.withFactory<ChatScopeChipProps>({
    displayName: 'ChatScopeChip',
    model: uses(ChatModel, {optional: true}),
    className: 'xh-chat-scope-chip',

    render(props) {
        const {
                className,
                model,
                documents = [],
                runOption = 'documentIds',
                value,
                onChange,
                searchThreshold = 8,
                tooltip
            } = props,
            isBound = value !== undefined || onChange != null;
        // TODO(design-open B4) - the scope persists per thread, and each question stores its own.
        throwIf(
            !isBound && !model,
            'ChatScopeChip requires a ChatModel, or the value and onChange props.'
        );

        const selectedIds: string[] = (isBound ? value : model.runOptions?.[runOption]) ?? [],
            selected = documents.filter(it => selectedIds.includes(it.id)),
            // A chosen id no longer in the list does not count - unless no list has loaded yet.
            count = isEmpty(documents) ? selectedIds.length : selected.length,
            setSelectedIds = (ids: string[]) => {
                if (isBound) {
                    onChange?.(ids);
                } else {
                    model.runOptions = withRunOption(model.runOptions, runOption, ids);
                }
            };

        return chatComposerPill({
            className,
            icon: Icon.book(),
            text: isEmpty(selectedIds) ? 'All documents' : 'Documents',
            count: isEmpty(selectedIds) ? null : count,
            tooltip: tooltip ?? scopeTooltip(selected, selectedIds, count),
            'aria-label': `Document scope: ${scopeWords(selectedIds, count)}`,
            content: scopeList({
                documents,
                selectedIds,
                count,
                searchThreshold,
                onChange: setSelectedIds
            })
        });
    }
});

//------------------
// Implementation
//------------------
interface ScopeListProps {
    documents: ChatScopeDocument[];
    selectedIds: string[];
    count: number;
    searchThreshold: number;
    onChange: (ids: string[]) => void;
}

/** The popover's content: search, the list of checkboxes, and a footer with Clear. */
const scopeList = hoistCmp.factory<HoistProps & ScopeListProps>({
    displayName: 'ChatScopeList',
    model: false,

    render({documents, selectedIds, count, searchThreshold, onChange}) {
        const [search, setSearch] = useState(''),
            query = search.trim().toLowerCase(),
            shown = query
                ? documents.filter(it => it.name.toLowerCase().includes(query))
                : documents,
            toggle = (id: string, isOn: boolean) =>
                onChange(isOn ? [...without(selectedIds, id), id] : without(selectedIds, id));

        return div({
            className: 'xh-chat-scope-chip__popover',
            role: 'dialog',
            'aria-label': 'Document scope',
            items: [
                documents.length > searchThreshold
                    ? div({
                          className: 'xh-chat-scope-chip__search',
                          item: textInput({
                              value: search,
                              onChange: v => setSearch(v ?? ''),
                              commitOnChange: true,
                              leftIcon: Icon.search(),
                              placeholder: 'Search documents',
                              autoFocus: true,
                              enableClear: true,
                              width: null,
                              domAttrs: {'aria-label': 'Search documents'}
                          })
                      })
                    : null,
                div({
                    className: 'xh-chat-scope-chip__list',
                    items: isEmpty(shown)
                        ? [
                              div({
                                  className: 'xh-chat-scope-chip__empty',
                                  item: query
                                      ? `No documents match '${search.trim()}'`
                                      : 'No documents'
                              })
                          ]
                        : shown.map(doc =>
                              checkbox({
                                  key: doc.id,
                                  className: 'xh-chat-scope-chip__option',
                                  value: selectedIds.includes(doc.id),
                                  label: span({
                                      className: 'xh-chat-scope-chip__option-label',
                                      items: [
                                          doc.icon ?? Icon.fileText(),
                                          span({
                                              className: 'xh-chat-scope-chip__option-name',
                                              item: doc.name
                                          })
                                      ]
                                  }),
                                  onChange: (isOn: boolean) => toggle(doc.id, isOn)
                              })
                          )
                }),
                div({
                    className: 'xh-chat-scope-chip__footer',
                    items: [
                        span({
                            className: 'xh-chat-scope-chip__summary',
                            item: isEmpty(selectedIds)
                                ? 'All documents'
                                : `${count} of ${documents.length}`
                        }),
                        button({
                            text: 'Clear',
                            minimal: true,
                            disabled: isEmpty(selectedIds),
                            onClick: () => onChange([])
                        })
                    ]
                })
            ]
        });
    }
});

/** The run options with the selection set under its key, or the key removed for none. */
function withRunOption(runOptions: Record<string, any>, key: string, ids: string[]) {
    const {[key]: _prev, ...rest} = runOptions ?? {};
    if (!isEmpty(ids)) return {...rest, [key]: ids};
    return isEmpty(rest) ? null : rest;
}

function scopeWords(selectedIds: string[], count: number): string {
    if (isEmpty(selectedIds)) return 'All documents';
    return `${count} ${count === 1 ? 'document' : 'documents'}`;
}

function scopeTooltip(selected: ChatScopeDocument[], selectedIds: string[], count: number): string {
    if (isEmpty(selectedIds)) return 'Answers draw on all documents';
    const names = take(selected, MAX_TOOLTIP_NAMES).map(it => it.name),
        more = count - names.length;
    return more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ');
}

const MAX_TOOLTIP_NAMES = 5;
