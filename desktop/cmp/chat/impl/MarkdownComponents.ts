import {
    Children,
    cloneElement,
    isValidElement,
    type ReactElement,
    type ReactNode,
    useMemo
} from 'react';
import {div, span, table} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {fmtNumber} from '@xh/hoist/format';
import {action, observable} from '@xh/hoist/mobx';
import {type ChatMarkdownComponents, useChatMarkdownStreaming} from '../../../../cmp/markdown';
import {ChatKit} from '../../../../core';
import {chatUiFrame} from '../../genui/ChatUiFrame';
import {chatCodeBlock} from '../ChatCodeBlock';

// Markdown renders a fenced code block as `pre > code.language-xyz`. Swap the `pre` for a
// ChatCodeBlock, reading the code and its language from the inner `code` element. A block that
// still streams shows in full, so that it does not collapse while the user reads it.
const MarkdownPre = hoistCmp<HoistProps>({
    displayName: 'ChatMarkdownPre',
    model: false,
    observer: false,

    render({children}) {
        const codeEl = isValidElement(children)
                ? (children as ReactElement<{className?: string; children?: unknown}>)
                : null,
            {className, children: text} = codeEl?.props ?? {},
            language = /language-(\S+)/.exec(className ?? '')?.[1] ?? null,
            isStreaming = useChatMarkdownStreaming();

        return chatCodeBlock({
            content: String(text ?? '').replace(/\n$/, ''),
            language,
            isStreaming
        });
    }
});

interface HastElement {
    type: string;
    tagName?: string;
    children?: HastElement[];
}

// A markdown table of up to `ChatKit.defaults.markdownTableMaxRows` body rows renders plain, in a
// frame that fits its content, on Hoist's compact grid tokens. A longer one renders as a card: its
// first rows up to that limit, and a footer that says how many rows it holds, with Show All. A
// markdown table carries no artifact, so it has no side panel view.
// TODO(design-open B1) - the long table's card follows P4's preview, without View Full Table.
const MarkdownTable = hoistCmp<HoistProps & {node?: HastElement}>({
    displayName: 'ChatMarkdownTable',
    model: false,
    observer: false,

    render({node, children}) {
        const rowCount = countBodyRows(node),
            maxRows = ChatKit.defaults.markdownTableMaxRows;
        return rowCount > maxRows
            ? markdownTableCard({rowCount, maxRows, item: children})
            : table({items: children});
    }
});

const markdownTableCard = hoistCmp.factory<HoistProps & {rowCount: number; maxRows: number}>({
    displayName: 'ChatMarkdownTableCard',

    render({rowCount, maxRows, children}) {
        const impl = useLocalModel(MarkdownTableLocalModel),
            {isExpanded} = impl,
            rows = `${fmtNumber(rowCount, {precision: 0, asHtml: true})} rows`;

        return chatUiFrame({
            className: 'xh-chat-markdown__table-card',
            item: table({items: isExpanded ? children : capBodyRows(children, maxRows)}),
            footer: [
                span({
                    key: 'counts',
                    item: isExpanded ? rows : `Showing ${maxRows} of ${rows}`
                }),
                div({key: 'fill', className: 'xh-chat-ui-frame__fill'}),
                button({
                    key: 'toggle',
                    text: isExpanded ? 'Show Less' : 'Show All',
                    'aria-expanded': isExpanded,
                    onClick: () => impl.setExpanded(!isExpanded)
                })
            ]
        });
    }
});

class MarkdownTableLocalModel extends HoistModel {
    override xhImpl = true;

    @observable accessor isExpanded = false;

    @action
    setExpanded(isExpanded: boolean) {
        this.isExpanded = isExpanded;
    }
}

function countBodyRows(node: HastElement): number {
    const body = node?.children?.find(it => it.tagName === 'tbody');
    return body?.children?.filter(it => it.tagName === 'tr').length ?? 0;
}

// The table's head, and the first rows of its body.
function capBodyRows(children: ReactNode, maxRows: number): ReactNode {
    return Children.map(children, child => {
        if (!isValidElement<{children?: ReactNode}>(child) || child.type !== 'tbody') return child;
        const rows = Children.toArray(child.props.children).filter(isValidElement);
        return cloneElement(child, null, rows.slice(0, maxRows));
    });
}

/**
 * Markdown element overrides used by the desktop chat components. A module-level constant, so
 * that memoized markdown blocks see the same object on every render.
 * @internal
 */
export const CHAT_MARKDOWN_COMPONENTS: ChatMarkdownComponents = {
    pre: MarkdownPre,
    table: MarkdownTable
};

/**
 * The kit's markdown components, with an app's overrides merged over them. Memoized, so that
 * markdown blocks see a stable object while the overrides stay the same.
 * @internal
 */
export function useChatMarkdownComponents(
    overrides: ChatMarkdownComponents
): ChatMarkdownComponents {
    return useMemo(
        () => (overrides ? {...CHAT_MARKDOWN_COMPONENTS, ...overrides} : CHAT_MARKDOWN_COMPONENTS),
        [overrides]
    );
}
