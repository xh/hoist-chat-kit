import {hbox, vbox} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import classNames from 'classnames';
import {createElement} from 'react';
import type {ChatUiComponentSpec} from '../../../genui';
import {chatUiFrame} from './ChatUiFrame';
import {ChatUiStackDirection} from './impl/ChatUiStackDirection';
import type {ChatUiSpecOptions} from './Types';
import './ChatUiStack.scss';

/** Props of a {@link ChatUiStack}, as written by the model. */
export interface ChatUiStackSpecProps {
    /** Direction of the stack. Default `column`. */
    direction?: 'column' | 'row';

    /** Space between the children. Default `medium`. */
    gap?: 'none' | 'small' | 'medium' | 'large';

    /** Title of the stack, shown in a frame around it. Default none - no frame. */
    title?: string;
}

/**
 * A stack container for a {@link ChatUiCatalog}: lays its children out in a column or a row. It
 * is the root of a nested answer, such as a row of stat cards over a chart over some text. A `title`
 * draws a frame around the children.
 *
 * The model nests it in a document, with the `show_ui` tool. It has no tool or tag of its own.
 */
export function chatUiStackSpec(
    opts: ChatUiSpecOptions = {}
): ChatUiComponentSpec<ChatUiStackSpecProps> {
    const {name = 'stack', description = DESCRIPTION} = opts;

    return {
        name,
        kitComponent: 'stack',
        description,
        props: {
            type: 'object',
            additionalProperties: false,
            properties: {
                direction: {enum: ['column', 'row'], description: 'Default "column".'},
                gap: {
                    enum: ['none', 'small', 'medium', 'large'],
                    description: 'Space between children. Default "medium".'
                },
                title: {
                    type: 'string',
                    maxLength: 120,
                    description: 'Shows a frame with this title around the children.'
                }
            }
        },
        slots: ['default'],
        standalone: false,
        render: (props, {children}) => chatUiStack({...props, children}),
        result: ({title}) => title ?? '',
        example: {direction: 'column', gap: 'medium'}
    };
}

/** Props for {@link ChatUiStack}. */
export interface ChatUiStackProps extends HoistProps, ChatUiStackSpecProps {}

/**
 * A column or row of children - the component that {@link chatUiStackSpec} renders. A column
 * fills the width of the reply. A row shares the width among its children, and wraps where they
 * do not fit. A `title` puts the stack in a {@link ChatUiFrame}.
 */
export const [ChatUiStack, chatUiStack] = hoistCmp.withFactory<ChatUiStackProps>({
    displayName: 'ChatUiStack',
    model: false,
    className: 'xh-chat-ui-stack',

    render({className, direction = 'column', gap = 'medium', title, children}) {
        const layout = direction === 'row' ? hbox : vbox,
            stack = layout({
                className: classNames(className, `xh-chat-ui-stack--${gap}`),
                children
            });

        // A child that draws itself to suit its stack, such as a separator, reads the direction.
        return createElement(
            ChatUiStackDirection.Provider,
            {value: direction === 'row' ? 'row' : 'column'},
            title ? chatUiFrame({title, children: stack}) : stack
        );
    }
});

//------------------
// Implementation
//------------------
const DESCRIPTION =
    'A container that lays its children out in a column or a row. Use it as the root of an ' +
    'answer made of several components, such as headline stat cards over a chart over a short note.';
