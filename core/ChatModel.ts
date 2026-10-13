import type {PlainObject} from '@xh/hoist/core';
import {HoistModel, managed} from '@xh/hoist/core';
import {computed, observable, observableRef} from '@xh/hoist/mobx';
import type {ReactNode} from 'react';
import type {ChatTransport} from '../transport';
import {ChatComposerModel, type ChatComposerConfig} from './ChatComposerModel';
import {ChatMessage, type ChatMessageSpec} from './ChatMessage';
import type {ChatDataPart, ChatFilePart, ChatToolCallPart} from './ChatPart';
import type {ChatToolSpec} from './ChatToolSpec';
import {genChatId} from './impl/ids';

// STUB - public API contract only. The core work stream implements the bodies.

/** Configuration for a {@link ChatModel}. */
export interface ChatModelConfig {
    /** Connection to the backend that runs the model or agent. */
    transport: ChatTransport;

    /** Tools the model may call, and display config for tools the backend runs. */
    tools?: ChatToolSpec[];

    /**
     * Maximum model calls in one assistant turn. Each round of client tool calls takes one more.
     * Default 10.
     */
    maxSteps?: number;

    /** Messages to start with, such as a greeting or restored history. */
    initialMessages?: ChatMessageSpec[];

    /** Identifies the conversation to the backend. Default a new UUID. */
    threadId?: string;

    /** Config for the managed {@link ChatComposerModel}. */
    composer?: ChatComposerConfig;

    /**
     * Renderers for data parts, keyed by `dataType`. Data parts carry app- and protocol-defined
     * content, such as generative UI. Parts without a renderer display as JSON.
     */
    dataRenderers?: Record<string, ChatDataRenderer>;

    /** Called when an assistant turn ends - complete, failed, or stopped. */
    onTurnComplete?: (message: ChatMessage) => void;
}

/** Renders a {@link ChatDataPart}. */
export type ChatDataRenderer = (part: ChatDataPart, message: ChatMessage) => ReactNode;

/**
 * State of the conversation.
 *
 *  - `ready` - idle, and ready for the user's next message.
 *  - `submitted` - a turn has started and no content has arrived yet.
 *  - `streaming` - content is arriving.
 *  - `error` - the last turn failed. See `lastError`.
 */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

/** A user message to send - see {@link ChatModel.sendAsync}. */
export interface ChatSendSpec {
    text?: string;
    files?: ChatFilePart[];
    metadata?: PlainObject;
}

/**
 * Model for one conversation with an LLM or agent: the message history, the status of the
 * current turn, and the run loop that streams responses and executes client tools.
 *
 * Render it with a desktop {@link ChatPanel}, or with the lower-level message list and composer
 * components. Connect it to a backend with a {@link ChatTransport}.
 */
export class ChatModel extends HoistModel {
    declare config: ChatModelConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    readonly transport: ChatTransport;
    readonly tools: ChatToolSpec[];
    readonly maxSteps: number;
    readonly threadId: string;
    readonly dataRenderers: Record<string, ChatDataRenderer>;

    /** Draft text and attachments for the next message. */
    @managed readonly composerModel: ChatComposerModel;

    //-----------------------
    // Observable State
    //-----------------------
    /** Conversation history, oldest first. (observable) */
    @observableRef accessor messages: ChatMessage[] = [];

    /** State of the conversation. (observable) */
    @observable accessor status: ChatStatus = 'ready';

    /** Error from the last turn, or null. (observable) */
    @observableRef accessor lastError: Error = null;

    /** True while a turn is in progress. */
    @computed
    get isBusy(): boolean {
        return this.status === 'submitted' || this.status === 'streaming';
    }

    /** True if the conversation has no messages. */
    @computed
    get isEmpty(): boolean {
        return this.messages.length === 0;
    }

    /** The most recent message, or null. */
    @computed
    get lastMessage(): ChatMessage {
        return this.messages[this.messages.length - 1] ?? null;
    }

    /** Tool calls waiting for the user to approve or deny them. */
    @computed
    get pendingApprovals(): ChatToolCallPart[] {
        return [];
    }

    constructor(config: ChatModelConfig) {
        super();
        const {
            transport,
            tools = [],
            maxSteps = 10,
            threadId,
            composer,
            dataRenderers = {}
        } = config;
        this.transport = transport;
        this.tools = tools;
        this.maxSteps = maxSteps;
        this.threadId = threadId ?? genChatId();
        this.dataRenderers = dataRenderers;
        this.composerModel = new ChatComposerModel({...composer, chatModel: this});
    }

    //------------------
    // Actions
    //------------------
    /**
     * Send a user message and stream the reply, running any client tools the model calls.
     * Defaults to the composer's draft, which is then cleared. Does nothing while busy.
     *
     * @returns a promise that resolves when the turn ends, however it ends.
     */
    async sendAsync(input?: string | ChatSendSpec): Promise<void> {}

    /** Stop the current turn. Content received so far is kept, with status 'aborted'. */
    stop() {}

    /** Re-run the last user turn after an error, replacing the failed reply. */
    async retryAsync(): Promise<void> {}

    /**
     * Replace an assistant reply with a new one, discarding any later messages.
     * @param messageId - default the last assistant message.
     */
    async regenerateAsync(messageId?: string): Promise<void> {}

    /** Change the text of a user message and re-run from it, discarding later messages. */
    async editMessageAsync(messageId: string, text: string): Promise<void> {}

    /** Approve a tool call that is waiting for approval, and continue the turn. */
    async approveToolCallAsync(toolCallId: string): Promise<void> {}

    /** Deny a tool call that is waiting for approval, and continue the turn. */
    async denyToolCallAsync(toolCallId: string, reason?: string): Promise<void> {}

    /**
     * Provide the result of a tool call the user answers interactively - for tools rendered as a
     * form or a choice - and continue the turn.
     */
    async addToolOutputAsync(toolCallId: string, output: any): Promise<void> {}

    /** Remove all messages. Stops any turn in progress. */
    clear() {}

    /** Replace the conversation with the given messages. Stops any turn in progress. */
    loadMessages(specs: ChatMessageSpec[]) {}

    /** The conversation as plain objects, for storage. */
    getMessageSpecs(): ChatMessageSpec[] {
        return this.messages.map(it => it.toSpec());
    }

    /** The spec for a tool, by name, or null. */
    getToolSpec(name: string): ChatToolSpec {
        return this.tools.find(it => it.name === name) ?? null;
    }
}
