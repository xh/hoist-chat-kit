import {VALUE_TOKEN} from '../../../../blueprint/impl/template';

/**
 * A rehype plugin that puts each value of a markdown template in place of its token, in text and
 * in attributes such as a link's `href`, as plain text - see `markdownTemplate()`.
 */
export function rehypeTemplateValues({values}: {values: string[]}) {
    const fill = (text: string) => text.replace(VALUE_TOKEN, (_, i) => values[Number(i)] ?? '');
    return (tree: HastNode) => {
        const visit = (node: HastNode) => {
            if (node.type === 'text') node.value = fill(node.value);
            Object.entries(node.properties ?? {}).forEach(([key, value]) => {
                if (typeof value === 'string') node.properties[key] = fill(value);
            });
            node.children?.forEach(visit);
        };
        visit(tree);
    };
}

interface HastNode {
    type: string;
    value?: string;
    properties?: Record<string, unknown>;
    children?: HastNode[];
}
