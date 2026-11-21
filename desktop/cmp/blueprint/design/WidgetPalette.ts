import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {action, observable} from '@xh/hoist/mobx';
import {groupBy, isString, upperFirst} from 'lodash';
import type {BlueprintDesignModel} from '../../../../blueprint';
import {getOwn} from '../../../../blueprint/impl/pointer';
import './WidgetPalette.scss';

export interface WidgetPaletteProps extends HoistProps {
    designModel: BlueprintDesignModel;
}

/**
 * The registry's widgets by category, for a designer to add one: into the selected container, or
 * beside the selected element, or into the root. The new element is then selected.
 */
export const [WidgetPalette, widgetPalette] = hoistCmp.withFactory<WidgetPaletteProps>({
    displayName: 'BlueprintWidgetPalette',
    className: 'xh-blueprint-widget-palette',
    model: false,
    render({designModel, className}) {
        const impl = useLocalModel(() => new WidgetPaletteModel(designModel));
        return div({
            className,
            children: [
                impl.target && !impl.readOnly
                    ? div({className: `${CLS}__target`, children: impl.target})
                    : null,
                ...impl.groups.map(({category, widgets}) =>
                    div({
                        key: category,
                        className: `${CLS}__group`,
                        children: [
                            div({className: `${CLS}__category`, children: upperFirst(category)}),
                            ...widgets.map(it =>
                                button({
                                    key: it.name,
                                    text: it.label,
                                    title: it.title,
                                    minimal: true,
                                    disabled: impl.readOnly,
                                    onClick: () => impl.add(it.name)
                                })
                            )
                        ]
                    })
                ),
                impl.message ? div({className: `${CLS}__message`, children: impl.message}) : null
            ]
        });
    }
});

/** @internal */
export class WidgetPaletteModel extends HoistModel {
    /** Why the last widget asked for was not added, until the next one is. */
    @observable accessor message: string = null;

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
    }

    /** The widgets a designer can add, by category, in registry order. */
    get groups(): {category: string; widgets: {name: string; label: string; title: string}[]}[] {
        const widgets = Object.values(this.designModel.blueprintModel.registry.widgets).filter(
                it => !it.reserved
            ),
            byCategory = groupBy(widgets, it => it.category ?? 'other');
        return Object.entries(byCategory).map(([category, specs]) => ({
            category,
            widgets: specs.map(it => ({
                name: it.name,
                label: it.label ?? it.name,
                title: it.guidance?.split('. ')[0] ?? null
            }))
        }));
    }

    /** Where a click adds a widget, as a designer reads it. */
    get target(): string {
        const {designModel} = this,
            target = designModel.addTarget,
            {blueprint} = designModel.blueprintModel;
        if (!target) return blueprint?.root ? null : 'Adds as the root';
        const nameOf = (id: string) => {
            const title = getOwn(blueprint.elements, id)?.config?.title;
            return isString(title) && title ? title : id;
        };
        return target.after
            ? `Adds after ${nameOf(target.after)}, in ${nameOf(target.parent)}`
            : `Adds into ${nameOf(target.parent)}`;
    }

    get readOnly(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode !== 'design' || access !== 'write';
    }

    @action
    add(component: string) {
        const {designModel} = this,
            {id, issues} = designModel.addWidget(component),
            error = issues.find(it => it.severity === 'error');
        this.message = error?.message ?? null;
        if (!error) designModel.select({kind: 'element', id});
    }
}

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-widget-palette';
