import type {HoistInputModel} from '@xh/hoist/cmp/input';
import {HoistModel} from '@xh/hoist/core';
import {action, bindable, bindableRef, computed, observableRef} from '@xh/hoist/mobx';
import {pluralize, throwIf} from '@xh/hoist/utils/js';
import {createObservableRef} from '@xh/hoist/utils/react';
import {findLast, isEmpty, round, take} from 'lodash';
import type {ChatModel} from './ChatModel';
import type {ChatFilePart} from './ChatPart';
import {genChatId} from '../impl/ids';

/** Configuration for a {@link ChatComposerModel}, usually passed via `ChatModelConfig.composer`. */
export interface ChatComposerConfig {
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

    /** @internal - set by the owning ChatModel. */
    chatModel?: ChatModel;
}

/**
 * Model for the message composer: the draft text and attachments of the next user message.
 * Created and managed by {@link ChatModel} as its `composerModel`.
 *
 * The attachment settings are bindable, so an app can change them after construction - for
 * example to allow files only for an agent that reads them.
 */
export class ChatComposerModel extends HoistModel {
    declare config: ChatComposerConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    readonly chatModel: ChatModel;

    /**
     * Ref to the Hoist input that edits the draft. A composer component sets it as the input's
     * `ref`, which enables {@link focus}.
     */
    readonly inputRef = createObservableRef<HoistInputModel>();

    //-----------------------
    // Observable State
    //-----------------------
    /**
     * True to let the user attach files. Turning it off hides the attach button and refuses new
     * files, and leaves any files already attached in the draft. (bindable)
     */
    @bindable accessor enableAttachments: boolean;

    /** File types to accept, as MIME types or extensions, or null for any. (bindable) */
    @bindableRef accessor accept: string[];

    /** Maximum files per message. (bindable) */
    @bindable accessor maxFiles: number;

    /** Maximum size per file, in bytes. (bindable) */
    @bindable accessor maxFileSize: number;

    /** Draft message text. (observable) */
    @bindable accessor text: string = '';

    /** Files attached to the draft. (observable) */
    @observableRef accessor attachments: ChatFilePart[] = [];

    /**
     * Why files from the last attempt to attach were left out, one message per problem - shown
     * in the composer, under the attachments. Empty if all were attached. (observable)
     */
    @observableRef accessor attachmentErrors: string[] = [];

    /** True if the draft has no text and no attachments. */
    @computed
    get isEmpty(): boolean {
        return !this.text.trim() && isEmpty(this.attachments);
    }

    /**
     * True if the draft can be sent now: it has content, no reply is in progress, and the chat's
     * `sendBlocker` gives no reason to wait.
     */
    @computed
    get canSend(): boolean {
        const {chatModel} = this;
        return !this.isEmpty && !chatModel.isBusy && !chatModel.sendBlockedReason;
    }

    constructor(config: ChatComposerConfig) {
        super();
        const {
            chatModel,
            enableAttachments = false,
            accept = null,
            maxFiles = 10,
            maxFileSize = 10 * MB
        } = config;
        this.chatModel = chatModel;
        this.enableAttachments = enableAttachments;
        this.accept = accept;
        this.maxFiles = maxFiles;
        this.maxFileSize = maxFileSize;
    }

    //------------------
    // Actions
    //------------------
    /** Send the draft. Does nothing if it cannot be sent. */
    async submitAsync(): Promise<void> {
        if (!this.canSend) return;
        await this.chatModel.sendAsync();
    }

    /**
     * Attach files to the draft, read into memory as base64. Files that break the `accept`,
     * `maxFiles` or `maxFileSize` rules are left out, and `attachmentErrors` names them.
     */
    async addFilesAsync(files: File[]): Promise<void> {
        throwIf(!this.enableAttachments, 'Attachments are not enabled for this composer.');

        const {maxFiles} = this,
            problems: string[] = [],
            valid: File[] = [];
        files.forEach(file => {
            const problem = this.validateFile(file);
            if (problem) {
                problems.push(problem);
            } else {
                valid.push(file);
            }
        });

        const accepted = take(valid, Math.max(maxFiles - this.attachments.length, 0)),
            surplus = valid.length - accepted.length;
        if (surplus) {
            problems.push(
                `File limit of ${maxFiles} reached - ${surplus} ${pluralize('file', surplus)} not added.`
            );
        }
        this.setAttachmentErrors(problems);
        if (isEmpty(accepted)) return;

        const parts = await Promise.all(accepted.map(toFilePartAsync));
        this.appendAttachments(parts);
    }

    /** Remove an attachment from the draft. */
    @action
    removeAttachment(id: string) {
        this.attachments = this.attachments.filter(it => it.id !== id);
    }

    /** Clear the draft text and attachments. */
    @action
    clear() {
        this.text = '';
        this.attachments = [];
        this.attachmentErrors = [];
    }

    /** Dismiss the messages about files left out of the draft. */
    @action
    clearAttachmentErrors() {
        this.attachmentErrors = [];
    }

    /** Put the text of the last user message into an empty draft, for re-use. */
    @action
    recallLastMessage() {
        if (this.text.trim()) return;
        const message = findLast(this.chatModel.messages, it => it.isUser);
        if (message) this.text = message.text;
    }

    /** Move keyboard focus to the input. */
    focus() {
        this.inputRef.current?.focus();
    }

    //------------------
    // Implementation
    //------------------
    @action
    private setAttachmentErrors(errors: string[]) {
        this.attachmentErrors = errors;
    }

    @action
    private appendAttachments(parts: ChatFilePart[]) {
        // Re-applies the limit, in case another add completed while these files were read.
        this.attachments = take([...this.attachments, ...parts], this.maxFiles);
    }

    /** @returns why the file cannot be attached, or null if it can. */
    private validateFile(file: File): string {
        if (!isAccepted(file, this.accept)) {
            return `'${file.name}' is not an accepted file type.`;
        }
        if (file.size > this.maxFileSize) {
            return `'${file.name}' is larger than ${fmtFileSize(this.maxFileSize)}.`;
        }
        return null;
    }
}

//------------------
// Implementation
//------------------
const MB = 1024 * 1024;

function isAccepted(file: File, accept: string[]): boolean {
    if (isEmpty(accept)) return true;

    const name = file.name.toLowerCase(),
        type = file.type.toLowerCase();
    return accept.some(it => {
        const rule = it.trim().toLowerCase();
        if (rule.startsWith('.')) return name.endsWith(rule);
        if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
        return type === rule;
    });
}

async function toFilePartAsync(file: File): Promise<ChatFilePart> {
    return {
        type: 'file',
        id: genChatId(),
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        size: file.size,
        data: await readBase64Async(file)
    };
}

function readBase64Async(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // The result is a data URL - `data:<type>;base64,<data>`.
            const url = reader.result as string;
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function fmtFileSize(bytes: number): string {
    return bytes >= MB ? `${round(bytes / MB, 1)} MB` : `${round(bytes / 1024)} KB`;
}
