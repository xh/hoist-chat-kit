import type {ClipboardEvent} from 'react';
import {HoistModel, managed} from '@xh/hoist/core';
import {withDefault} from '@xh/hoist/utils/js';
import {createObservableRef} from '@xh/hoist/utils/react';
import {isEmpty} from 'lodash';
import {chatAnnouncer, ChatComposerModel} from '../../../../core';
import {fitTextAreaToContent, isImeComposing} from './AutoGrow';
import {FileDropModel} from './FileDrop';

/** Rows the composer's input grows to before it scrolls, unless its `maxRows` prop says. */
export const DEFAULT_MAX_ROWS = 8;

/**
 * Local model for a ChatComposer: key handling, file paste and drop, and input sizing. Reads the
 * composer model and `maxRows` from the component's current props, so that it never holds stale
 * values in a callback that a hook kept from an earlier render.
 *
 * @internal
 */
export class ChatComposerLocalModel extends HoistModel {
    override xhImpl = true;

    /** The composer as a drop zone for files, used when no zone around it takes them. */
    @managed readonly fileDrop = new FileDropModel(() => this.composerModel);

    readonly fileInputRef = createObservableRef<HTMLInputElement>();

    /** The composer model from props, or else that of a model in context, such as a ChatModel. */
    get composerModel(): ChatComposerModel {
        return (
            (this.componentProps.model as ChatComposerModel) ??
            this.lookupModel<ComposerOwner>(hasComposerModel)?.composerModel ??
            null
        );
    }

    get maxRows(): number {
        return withDefault(this.componentProps.maxRows, DEFAULT_MAX_ROWS);
    }

    override onLinked() {
        // Files left out are named under the chips, and read once through the announcer.
        this.addReaction({
            track: () => this.composerModel?.attachmentErrors,
            run: errors => {
                if (!isEmpty(errors)) chatAnnouncer.announce(errors.join(' '), 'assertive');
            }
        });
    }

    /** Size the input to its text, up to `maxRows`. */
    fitInput = () => {
        fitTextAreaToContent(this.composerModel?.inputRef.current?.inputEl, this.maxRows);
    };

    // Typed as Hoist's TextArea types its onKeyDown.
    onKeyDown = (e: KeyboardEvent) => {
        const {composerModel} = this;
        if (isImeComposing(e)) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (composerModel.canSend) composerModel.submitAsync().catchDefault();
        } else if (e.key === 'ArrowUp' && !composerModel.text) {
            e.preventDefault();
            composerModel.recallLastMessage();
        } else if (e.key === 'Escape' && composerModel.chatModel?.isBusy) {
            e.preventDefault();
            composerModel.chatModel.stop();
        }
    };

    // A paste with text goes to the input. Office apps add an image of a copied range alongside
    // its text, which must not turn a paste of cells into an attachment.
    onPaste = (e: ClipboardEvent) => {
        const data = e.clipboardData,
            files = Array.from(data?.files ?? []),
            hasText = Array.from(data?.types ?? []).some(
                it => it === 'text/plain' || it === 'text/html'
            );
        if (!files.length || hasText || !this.composerModel.enableAttachments) return;
        e.preventDefault();
        this.composerModel.addFilesAsync(files).catchDefault();
    };

    onFilesChosen = (fileInput: HTMLInputElement) => {
        const files = Array.from(fileInput.files ?? []);
        fileInput.value = ''; // Allow the same file to be chosen again.
        if (files.length) this.composerModel.addFilesAsync(files).catchDefault();
    };
}

//------------------
// Implementation
//------------------
/** A model in context that owns a composer - in the kit, a ChatModel. */
type ComposerOwner = HoistModel & {composerModel: ChatComposerModel};

function hasComposerModel(model: HoistModel): boolean {
    return (model as ComposerOwner).composerModel instanceof ChatComposerModel;
}
