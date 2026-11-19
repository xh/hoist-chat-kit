import {GroupingChooserModel} from '@xh/hoist/cmp/grouping';
import {hoistCmp, managed, uses} from '@xh/hoist/core';
import {groupingChooser} from '@xh/hoist/desktop/cmp/grouping';
import {castArray, isEqual} from 'lodash';
import {
    BlueprintWidgetModel,
    type BlueprintWidgetConfig,
    type GroupingChooserWidgetConfig
} from '../../../blueprint';

/**
 * The `groupingChooser` widget: a Hoist `GroupingChooser` over the dimensions its config lists. It
 * shows the value of the `string[]` variable its element sets, and sets it as the user chooses.
 */
export class GroupingChooserWidgetModel extends BlueprintWidgetModel<GroupingChooserWidgetConfig> {
    @managed readonly chooserModel = new GroupingChooserModel({
        dimensions: [],
        initialValue: [],
        allowEmpty: true,
        commitOnChange: true
    });

    constructor(config: BlueprintWidgetConfig) {
        super(config);
        this.addReaction(
            {
                track: () => castArray(this.resolvedConfig.dimensions ?? []),
                run: dims =>
                    this.chooserModel.setDimensions(
                        dims.map(name => ({name, displayName: this.labelOf(name)}))
                    ),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => (this.value as string[]) ?? [],
                run: value => this.chooserModel.setValue(value),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => this.chooserModel.value,
                run: value => {
                    if (this.valueVariable && !isEqual(value, this.value ?? [])) {
                        this.setValue(value);
                    }
                }
            }
        );
    }

    //------------------
    // Implementation
    //------------------
    /** A dimension's label, from the first dataset in the catalog that has it. */
    private labelOf(name: string): string {
        for (const cat of this.blueprintModel.catalogs) {
            const field = Object.values(cat.datasets).find(it => it.fields[name])?.fields[name];
            if (field) return field.label ?? name;
        }
        return name;
    }
}

export const [GroupingChooserWidget, groupingChooserWidget] = hoistCmp.withFactory({
    displayName: 'GroupingChooserWidget',
    className: 'xh-blueprint-grouping-chooser',
    model: uses(GroupingChooserWidgetModel),
    render({model, className}) {
        return groupingChooser({model: model.chooserModel, className, flex: 1});
    }
});
