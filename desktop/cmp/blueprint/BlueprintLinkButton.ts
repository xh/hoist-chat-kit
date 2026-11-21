import {hoistCmp} from '@xh/hoist/core';
import type {ButtonProps} from '@xh/hoist/desktop/cmp/button';
import {clipboardButton} from '@xh/hoist/desktop/cmp/clipboard';
import {Icon} from '@xh/hoist/icon';
import {blueprintLinkUrl, type BlueprintDocumentModel} from '../../../blueprint';

export interface BlueprintLinkButtonProps extends Omit<ButtonProps, 'model'> {
    /** The blueprint open, whose version, presets and values the link holds. */
    documentModel: BlueprintDocumentModel;
    /** The app's route for a blueprint, with an `id` path param, such as `default.blueprint`. */
    route: string;
}

/**
 * A button that copies a link to the blueprint open, as it is now. Renders nothing while no
 * blueprint is open, or where the app has no route of that name. See `blueprintLinkUrl()`.
 */
export const [BlueprintLinkButton, blueprintLinkButton] =
    hoistCmp.withFactory<BlueprintLinkButtonProps>({
        displayName: 'BlueprintLinkButton',
        model: false,
        render({documentModel, route, ...rest}) {
            if (!documentModel?.document || !blueprintLinkUrl(documentModel, route)) return null;
            return clipboardButton({
                text: 'Copy link',
                icon: Icon.link(),
                getCopyText: () => blueprintLinkUrl(documentModel, route),
                successMessage: 'Link copied.',
                ...rest
            });
        }
    });
