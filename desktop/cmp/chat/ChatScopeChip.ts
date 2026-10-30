import {isEmpty, take, upperFirst, without} from 'lodash';
import type {ReactElement, ReactNode} from 'react';
import {useState} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {checkbox, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {tooltip} from '@xh/hoist/kit/blueprint';
import {pluralize, throwIf} from '@xh/hoist/utils/js';
import {ChatModel} from '../../../core';
import '../../../styles/vars.scss';
import {chatComposerPill} from './ChatComposerPill';
import './ChatScopeChip.scss';

/**
 * An option the user can choose in a {@link ChatScopeChip}, such as a document, an agent, a skill
 * or a tool.
 */
export interface ChatScopeOption {
    /** Unique id, recorded in the selection. */
    id: string;

    /** Name to show. */
    name: string;

    /** Icon before the name. Default none. */
    icon?: ReactElement;

    /** Short text at the end of the row, such as why the item is locked. */
    secondaryText?: ReactNode;

    /** Content of a tooltip on an info icon at the end of the row. */
    info?: ReactNode;

    /**
     * True to lock the item as it is, checked or not. Select All and Clear leave it alone. Use
     * it for an item the app requires, with `secondaryText` to say why.
     */
    disabled?: boolean;
}

/** Props for {@link ChatScopeChip}. */
export interface ChatScopeChipProps extends HoistProps<ChatModel> {
    /** The options to choose from. */
    options: ChatScopeOption[];

    /** The kind of item, in the singular, for the chip's words. Default 'item'. */
    noun?: string;

    /** Icon on the chip. Default a filter icon. */
    icon?: ReactElement;

    /**
     * Key of the selection in `ChatModel.runOptions`, as an array of item ids. Required unless
     * the chip binds to `value` and `onChange`.
     */
    runOption?: string;

    /**
     * Ids of the checked items, in place of the chat's run options. Pass it with `onChange` to
     * keep the selection in the app's own state. Empty means none.
     */
    value?: string[];

    /** Called with the new selection, in place of writing the chat's run options. */
    onChange?: (ids: string[]) => void;

    /** Show a search box above the list once it holds more items than this. Default 8. */
    searchThreshold?: number;

    /** Tooltip. Default the names of the checked items. */
    tooltip?: string;

    /** Which edge of the chip the popover lines up with - see `ChatComposerPill.popoverAlign`. */
    popoverAlign?: 'start' | 'end';
}

/**
 * A composer pill for choosing some of a set of items for the next question, such as the
 * documents to search, or the agents, skills or tools to use. It opens a list of checkboxes, with
 * a search box for a long list, Select All and Clear.
 *
 * The selection is the checked items, and empty means none. To start with every item on, pass
 * every id. The chip reads "All tools" with every item checked, "No tools" with none, and else
 * "Tools" with the count - with the words from `noun`.
 *
 * Bind the chip to the chat's `runOptions` with `runOption`, so each question records the
 * selection it was asked with, and a retry, regenerate or edit re-runs with it. Under a thread
 * layer, the selection belongs to the thread. Pass `value` and `onChange` to bind it to the app's
 * own state instead.
 *
 * Each row shows the item's icon and name, and its optional `secondaryText` and `info`. A
 * `disabled` item stays as it is.
 */
export const [ChatScopeChip, chatScopeChip] = hoistCmp.withFactory<ChatScopeChipProps>({
    displayName: 'ChatScopeChip',
    model: uses(ChatModel, {optional: true}),
    className: 'xh-chat-scope-chip',

    render(props) {
        const {
                className,
                model,
                options = [],
                noun = 'item',
                icon = Icon.filter(),
                runOption,
                value,
                onChange,
                searchThreshold = 8,
                tooltip,
                popoverAlign
            } = props,
            isBound = value !== undefined || onChange != null;
        throwIf(
            !isBound && !(model && runOption),
            'ChatScopeChip requires a ChatModel with runOption, or the value and onChange props.'
        );

        const selectedIds: string[] = (isBound ? value : model.runOptions?.[runOption]) ?? [],
            selected = options.filter(it => selectedIds.includes(it.id)),
            // A checked id no longer in the list does not count - unless no list has loaded yet.
            count = isEmpty(options) ? selectedIds.length : selected.length,
            plural = pluralize(noun),
            words = chipWords(count, options.length, plural),
            setSelectedIds = (ids: string[]) => {
                if (isBound) {
                    onChange?.(ids);
                } else {
                    model.runOptions = {...model.runOptions, [runOption]: ids};
                }
            };

        return chatComposerPill({
            className,
            icon,
            text: words.text,
            count: words.count,
            tooltip: tooltip ?? scopeTooltip(selected, count, words),
            'aria-label': `${upperFirst(plural)}: ${words.spoken}`,
            popoverAlign,
            content: scopeList({
                options,
                selectedIds,
                count,
                plural,
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
    options: ChatScopeOption[];
    selectedIds: string[];
    count: number;
    plural: string;
    searchThreshold: number;
    onChange: (ids: string[]) => void;
}

/** The popover's content: search, the list of checkboxes, and a footer with Select All and Clear. */
const scopeList = hoistCmp.factory<HoistProps & ScopeListProps>({
    displayName: 'ChatScopeList',
    model: false,

    render({options, selectedIds, count, plural, searchThreshold, onChange}) {
        const [search, setSearch] = useState(''),
            query = search.trim().toLowerCase(),
            shown = query ? options.filter(it => it.name.toLowerCase().includes(query)) : options,
            isChecked = (item: ChatScopeOption) => selectedIds.includes(item.id),
            // Select All and Clear leave a locked item as it is.
            allIds = options.filter(it => !it.disabled || isChecked(it)).map(it => it.id),
            lockedIds = options.filter(it => it.disabled && isChecked(it)).map(it => it.id),
            toggle = (id: string, isOn: boolean) =>
                onChange(isOn ? [...without(selectedIds, id), id] : without(selectedIds, id));

        return div({
            className: 'xh-chat-scope-chip__popover',
            role: 'dialog',
            'aria-label': upperFirst(plural),
            items: [
                options.length > searchThreshold
                    ? div({
                          className: 'xh-chat-scope-chip__search',
                          item: textInput({
                              value: search,
                              onChange: v => setSearch(v ?? ''),
                              commitOnChange: true,
                              leftIcon: Icon.search(),
                              placeholder: `Search ${plural}`,
                              autoFocus: true,
                              enableClear: true,
                              width: null,
                              domAttrs: {'aria-label': `Search ${plural}`}
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
                                      ? `No ${plural} match '${search.trim()}'`
                                      : `No ${plural}`
                              })
                          ]
                        : shown.map(option =>
                              scopeRow({
                                  key: option.id,
                                  option,
                                  isChecked: isChecked(option),
                                  onToggle: isOn => toggle(option.id, isOn)
                              })
                          )
                }),
                div({
                    className: 'xh-chat-scope-chip__footer',
                    items: [
                        span({
                            className: 'xh-chat-scope-chip__summary',
                            item: `${count} of ${options.length}`
                        }),
                        span({
                            className: 'xh-chat-scope-chip__actions',
                            items: [
                                button({
                                    text: 'Select All',
                                    minimal: true,
                                    disabled: allIds.every(id => selectedIds.includes(id)),
                                    onClick: () => onChange(allIds)
                                }),
                                button({
                                    text: 'Clear',
                                    minimal: true,
                                    disabled: selectedIds.length === lockedIds.length,
                                    onClick: () => onChange(lockedIds)
                                })
                            ]
                        })
                    ]
                })
            ]
        });
    }
});

interface ScopeRowProps {
    option: ChatScopeOption;
    isChecked: boolean;
    onToggle: (isOn: boolean) => void;
}

/** One item: its checkbox, icon and name, then its secondary text and info icon. */
const scopeRow = hoistCmp.factory<HoistProps & ScopeRowProps>({
    displayName: 'ChatScopeRow',
    model: false,

    render({option, isChecked, onToggle}) {
        const {name, icon, secondaryText, info, disabled} = option;
        return div({
            className: 'xh-chat-scope-chip__option',
            items: [
                checkbox({
                    className: 'xh-chat-scope-chip__check',
                    value: isChecked,
                    disabled: !!disabled,
                    label: span({
                        className: 'xh-chat-scope-chip__option-label',
                        title: name,
                        items: [
                            icon ?? null,
                            span({className: 'xh-chat-scope-chip__option-name', item: name})
                        ]
                    }),
                    onChange: (isOn: boolean) => onToggle(isOn)
                }),
                secondaryText != null
                    ? span({className: 'xh-chat-scope-chip__option-secondary', item: secondaryText})
                    : null,
                info != null
                    ? tooltip({
                          className: 'xh-chat-scope-chip__option-info',
                          content: info as ReactElement,
                          position: 'right',
                          item: span({
                              tabIndex: 0,
                              role: 'img',
                              'aria-label': `About ${name}`,
                              item: Icon.questionCircle()
                          })
                      })
                    : null
            ]
        });
    }
});

interface ChipWords {
    /** The chip's words. */
    text: string;

    /** The count after the words, or null for none. */
    count: number;

    /** The selection in words, for the accessible name and the default tooltip. */
    spoken: string;
}

function chipWords(count: number, total: number, plural: string): ChipWords {
    if (!count) return {text: `No ${plural}`, count: null, spoken: `No ${plural}`};
    if (total && count === total) {
        return {text: `All ${plural}`, count: null, spoken: `All ${plural}`};
    }
    return {text: upperFirst(plural), count, spoken: total ? `${count} of ${total}` : `${count}`};
}

function scopeTooltip(selected: ChatScopeOption[], count: number, words: ChipWords): string {
    if (words.count == null) return words.spoken;
    const names = take(selected, MAX_TOOLTIP_NAMES).map(it => it.name),
        more = count - names.length;
    return more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ');
}

const MAX_TOOLTIP_NAMES = 5;
