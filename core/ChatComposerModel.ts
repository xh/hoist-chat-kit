import {HoistModel} from '@xh/hoist/core';
import {bindable, computed, observableRef} from '@xh/hoist/mobx';
import type {ChatModel} from './ChatModel';
import type {ChatFilePart} from './ChatPart';

// STUB - public API contract only. The core work stream implements the bodies.

/** Configuration for a {@link ChatComposerModel}, usually passed via `ChatModelConfig.composer`. */
export interface ChatComposerConfig {
    /** Prompt shown in the empty input. Default 'Send a message...'. */
    placeholder?: string;

    /** True to let the user attach files. Default false. */
    enableAttachments?: boolean;

    /**
     * File types to accept, as MIME types (`image/*`, `application/pdf`) or extensions (`.csv`).
     * Default any.
     */
    accept?: string[];

    /** Maximum files per message. Default 10. */
    maxFiles?: number;

    /** Maximum size per file, in bytes. Default 10 MB. */
    maxFileSize?: number;

    /** Rows the input grows to before it scrolls. Default 10. */
    maxRows?: number;

    /** @internal - set by the owning ChatModel. */
    chatModel?: ChatModel;
}

/**
 * Model for the message composer: the draft text and attachments of the next user message.
 * Created and managed by {@link ChatModel} as its `composerModel`.
 */
export class ChatComposerModel extends HoistModel {
    declare config: ChatComposerConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    readonly chatModel: ChatModel;
    readonly placeholder: string;
    readonly enableAttachments: boolean;
    readonly accept: string[];
    readonly maxFiles: number;
    readonly maxFileSize: number;
    readonly maxRows: number;

    //-----------------------
    // Observable State
    //-----------------------
    /** Draft message text. (observable) */
    @bindable accessor text: string = '';

    /** Files attached to the draft. (observable) */
    @observableRef accessor attachments: ChatFilePart[] = [];

    /** True if the draft has no text and no attachments. */
    @computed
    get isEmpty(): boolean {
        return !this.text.trim() && this.attachments.length === 0;
    }

    /** True if the draft can be sent now. */
    @computed
    get canSend(): boolean {
        return !this.isEmpty && !this.chatModel.isBusy;
    }

    constructor(config: ChatComposerConfig) {
        super();
        const {
            chatModel,
            placeholder = 'Send a message...',
            enableAttachments = false,
            accept = null,
            maxFiles = 10,
            maxFileSize = 10 * 1024 * 1024,
            maxRows = 10
        } = config;
        this.chatModel = chatModel;
        this.placeholder = placeholder;
        this.enableAttachments = enableAttachments;
        this.accept = accept;
        this.maxFiles = maxFiles;
        this.maxFileSize = maxFileSize;
        this.maxRows = maxRows;
    }

    //------------------
    // Actions
    //------------------
    /** Send the draft. Does nothing if it cannot be sent. */
    async submitAsync(): Promise<void> {}

    /**
     * Attach files to the draft. Files that break the `accept`, `maxFiles` or `maxFileSize` rules
     * are rejected with a warning toast.
     */
    async addFilesAsync(files: File[]): Promise<void> {}

    /** Remove an attachment from the draft. */
    removeAttachment(id: string) {}

    /** Clear the draft text and attachments. */
    clear() {}

    /** Put the text of the last user message into an empty draft, for re-use. */
    recallLastMessage() {}

    /** Move keyboard focus to the input. */
    focus() {}
}
