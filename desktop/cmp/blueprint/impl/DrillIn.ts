import {box, placeholder} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, managed, useLocalModel, XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {dialog} from '@xh/hoist/kit/blueprint';
import {observable, runInAction} from '@xh/hoist/mobx';
import {BlueprintDocumentModel, type BlueprintDrillIn, BlueprintModel} from '../../../../blueprint';
import {blueprintView} from '../BlueprintView';

/**
 * The blueprint an `openBlueprint` action opened: a model of its own over the host's catalog,
 * registry and data, opened through the host's repository as a link to it opens, in run mode and
 * read only. A target the user may not open shows the refusal, and closes.
 */
export class DrillInModel extends HoistModel {
    @managed readonly blueprintModel: BlueprintModel;
    @managed readonly documentModel: BlueprintDocumentModel;
    @observable accessor isOpen = false;

    constructor(host: BlueprintModel, drillIn: BlueprintDrillIn) {
        super();
        this.blueprintModel = new BlueprintModel({
            catalog: host.catalog,
            registry: host.registry,
            dataProvider: host.dataProvider,
            urlAllowList: host.urlAllowList,
            isDrillIn: true
        });
        this.documentModel = new BlueprintDocumentModel({
            blueprintModel: this.blueprintModel,
            repository: host.drillInRepository
        });
        this.openAsync(host, drillIn);
    }

    /** The title to show: the action's, else the target's name. */
    titleFor(drillIn: BlueprintDrillIn): string {
        return drillIn.title ?? this.documentModel.document?.name ?? drillIn.id;
    }

    //------------------
    // Implementation
    //------------------
    private async openAsync(host: BlueprintModel, drillIn: BlueprintDrillIn) {
        const {issues} = await this.documentModel.openLinkAsync(drillIn.params),
            refused = issues.find(it => it.severity === 'error');
        if (refused) {
            XH.dangerToast(refused.message);
            host.closeDrillIn();
            return;
        }
        this.blueprintModel.setAccess('read');
        if (drillIn.dropped?.length) {
            XH.warningToast(`Some values could not be passed on: ${drillIn.dropped.join(', ')}.`);
        }
        runInAction(() => (this.isOpen = true));
    }
}

interface DrillInProps extends HoistProps {
    host: BlueprintModel;
    drillIn: BlueprintDrillIn;
}

/** A drill-in in a dialog over the host, sized within the viewport. */
export const drillInDialog = hoistCmp.factory<DrillInProps>({
    displayName: 'BlueprintDrillInDialog',
    model: false,
    render({host, drillIn}) {
        const impl = useLocalModel(() => new DrillInModel(host, drillIn));
        const width = Math.min(1100, window.innerWidth * 0.9);
        return dialog({
            className: 'xh-blueprint-drill-in-dialog',
            // Blueprint's dialog is 500px wide unless told otherwise.
            style: {width},
            title: impl.titleFor(drillIn),
            icon: Icon.openExternal(),
            isOpen: true,
            canOutsideClickClose: true,
            onClose: () => host.closeDrillIn(),
            children: drillInBody({
                impl,
                width: '100%',
                height: Math.min(800, window.innerHeight * 0.8)
            })
        });
    }
});

/** A drill-in in a popover, anchored to the button that opened it: for a small target. */
export const drillInPopoverContent = hoistCmp.factory<DrillInProps>({
    displayName: 'BlueprintDrillInPopover',
    model: false,
    render({host, drillIn}) {
        const impl = useLocalModel(() => new DrillInModel(host, drillIn));
        return drillInBody({impl, width: 480, height: 360});
    }
});

//------------------
// Implementation
//------------------
const drillInBody = hoistCmp.factory<
    HoistProps & {impl: DrillInModel; width: number | string; height: number}
>({
    displayName: 'BlueprintDrillInBody',
    model: false,
    render({impl, width, height}) {
        return box({
            className: 'xh-blueprint-drill-in',
            width,
            height,
            children: impl.isOpen
                ? blueprintView({model: impl.blueprintModel})
                : placeholder(Icon.spinner({className: 'fa-spin'}))
        });
    }
});
