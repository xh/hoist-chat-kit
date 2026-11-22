import type {PlainObject} from '@xh/hoist/core';
import type {BlueprintElement} from '../Blueprint';

/**
 * Drop a child's view from a dash container's layout, and any stack, row or column that leaves
 * empty, removing the layout when nothing is left of it, so the container takes its default.
 */
export function dropDockView(container: BlueprintElement, id: string) {
    const layout = container?.config?.layout;
    if (container?.component !== 'dashContainer' || !Array.isArray(layout)) return;
    const prune = (items: PlainObject[]): PlainObject[] =>
            items.flatMap(it => {
                if (it?.type === 'view') return it.id === id ? [] : [it];
                if (!Array.isArray(it?.content)) return [it];
                const content = prune(it.content);
                return content.length ? [{...it, content}] : [];
            }),
        ret = prune(layout);
    if (ret.length) {
        container.config.layout = ret;
    } else {
        delete container.config.layout;
    }
}
