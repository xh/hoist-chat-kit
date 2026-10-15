import {HoistModel, managed, XH} from '@xh/hoist/core';
import {action, computed, observable, observableRef} from '@xh/hoist/mobx';
import {createObservableRef} from '@xh/hoist/utils/react';
import {compact, isEmpty, isFunction, uniq} from 'lodash';
import {
    type ChatChangeTarget,
    type ChatContextProvider,
    type ChatMessage,
    ChatModel,
    type ChatModelConfig,
    type ChatPartRenderContext,
    type ChatToolCallPart,
    type ChatToolDisplay,
    ChatToolResult,
    type ChatToolSpec,
    type ChatUndoGuard
} from '../core';
import {objectSchema} from '../impl/toolSchema';
import '../svc';
import type {ChatTransport} from '../transport';
import type {ChatDataBoundary, ChatDocLink, ChatToolGroup} from './ChatToolGroup';

/** Config for {@link ChatAssistantModel}. */
export interface ChatAssistantConfig {
    /** Tool groups for the component, such as `gridTools(gridModel)`. One is the usual case. */
    groups: ChatToolGroup | ChatToolGroup[];

    /** Name of the component, such as 'Positions grid'. Default the first group's `title`. */
    title?: string;

    /** The sentence of the empty state. Default the first group's `intro`. */
    intro?: string;

    /** Up to three prompts for the empty state. Default the groups' suggestions. */
    suggestions?: string[];

    /** Instructions of the app's own, added to the system prompt after the groups'. */
    prompt?: string;

    /** Tools of the app's own, added to the groups' tools. */
    tools?: ChatToolSpec[];

    /** Context providers of the app's own, added to the groups' providers. */
    contextProviders?: ChatContextProvider[];

    /**
     * The transport, or a function that builds it from the helper's system prompt. Default
     * `XH.chatService.createTransport({system})`. A transport passed as is must send the prompt
     * itself - read it from {@link ChatAssistantModel.systemPrompt}, or pass a function.
     */
    transport?: ChatTransport | ((systemPrompt: string) => ChatTransport);

    /**
     * Asks a question in the app's main chat - in a new thread of its dock or workspace. With it,
     * the helper offers "Ask in chat" for a question about anything other than its component.
     * The helper never opens the app's thread itself.
     */
    onAskInChat?: (question: string) => void;

    /**
     * The width, in pixels, at which the component docks the helper inside itself. Narrower, the
     * helper opens as a popover. Default 740: a 360 px helper beside 380 px of component.
     */
    dockMinWidth?: number;

    /** More config for the helper's `ChatModel`, such as `maxSteps`. Default `maxSteps` 8. */
    chatModelConfig?: Omit<Partial<ChatModelConfig>, 'transport' | 'tools' | 'contextProviders'>;
}

/**
 * What the button of a closed helper shows, by priority: the turn waits for the user, the last
 * request failed, a turn runs, or a reply came in.
 */
export type ChatAssistantBadge = 'attention' | 'error' | 'busy' | 'ready';

/** Draws a change line or an Ask in chat button - see {@link ChatAssistantModel.renderers}. */
export type ChatAssistantPartRenderer = ChatToolSpec['renderer'];

/**
 * A helper agent beside one Hoist component, such as a grid or a dashboard. It owns one
 * {@link ChatModel}, built from a transport and the component's tool groups - their tools,
 * context providers, prompts and suggestions - and the state of the helper's UI: open or closed,
 * docked or in a popover, and the badge of its button.
 *
 * The conversation lives in memory for the life of the model, and dies with it. Nothing is
 * persisted, and no thread list shows it. Create the model with the component's own model, and
 * mark it `@managed`, so that a dialog or widget that closes takes the conversation with it.
 *
 * Without a transport, the model asks `XH.chatService` for the app's default. With no backend
 * configured, `isEnabled` is false and the helper's button does not render.
 *
 * The model keeps each reply's Undo exact: once the component changes by other means - by hand,
 * say - it retires the Undo, through the groups' `isChangedSince` (see {@link ChatUndoGuard}).
 * It flashes what each tool call changed, through the groups' `highlight`.
 */
export class ChatAssistantModel extends HoistModel implements ChatUndoGuard {
    /** The chat, or null if no backend is configured. */
    @managed readonly chatModel: ChatModel;

    /** The tool groups the helper acts through. */
    readonly groups: ChatToolGroup[];

    /** Name of the component, such as 'Positions grid'. */
    readonly title: string;

    /** The kind of component, such as 'grid'. Helpers of one kind share their docked width. */
    readonly kind: string;

    /** The sentence of the empty state. */
    readonly intro: string;

    /** Up to three prompts for the empty state. */
    readonly suggestions: string[];

    /** The pages an answer may cite - the groups' `docs`. */
    readonly docs: ChatDocLink[];

    /** The system prompt: the helper's rules, the groups' prompts, then the app's. */
    readonly systemPrompt: string;

    /** The width at which the component docks the helper - see `dockMinWidth`. */
    readonly dockMinWidth: number;

    /** True if the helper is open. (observable) */
    @observable accessor isOpen = false;

    /** The measured width of the component, or null before it is measured. (observable) */
    @observable accessor componentWidth: number = null;

    /** True if a reply came in while the helper was closed, until it opens. (observable) */
    @observable accessor hasUnseenReply = false;

    /**
     * Renderers that the platform's helper components supply - the change line of each tool
     * call, and the Ask in chat button. Without them, calls show as the chat's default cards.
     * @internal
     */
    renderers: {changeLine?: ChatAssistantPartRenderer; askInChat?: ChatAssistantPartRenderer} = {};

    /**
     * The helper's button, where focus returns when the helper closes, and the anchor of its
     * popover.
     * @internal
     */
    readonly buttonRef = createObservableRef<HTMLElement>();

    readonly isChatUndoGuard = true;

    constructor(config: ChatAssistantConfig) {
        super();
        const groups = compact([config.groups].flat()),
            [first] = groups;
        this.groups = groups;
        this.title = config.title ?? first?.title ?? 'Component';
        this.kind = first?.kind ?? 'component';
        this.intro = config.intro ?? first?.intro ?? `Ask about ${this.title}, or what to change.`;
        this.suggestions = (config.suggestions ?? uniq(groups.flatMap(it => it.suggestions))).slice(
            0,
            3
        );
        this.docs = groups.flatMap(it => it.docs ?? []);
        this.dockMinWidth = config.dockMinWidth ?? 740;
        this.onAskInChat = config.onAskInChat ?? null;
        this.systemPrompt = this.createSystemPrompt(config.prompt);

        const transport = this.createTransport(config.transport);
        if (!transport) {
            this.chatModel = null;
            return;
        }

        const {chatModelConfig = {}} = config,
            tools = [
                ...groups.flatMap(group => group.tools.map(it => this.wrapTool(it, group))),
                ...(config.tools ?? []),
                ...(this.onAskInChat ? [this.askInChatTool()] : [])
            ];
        this.chatModel = new ChatModel({
            maxSteps: 8,
            ...chatModelConfig,
            transport,
            tools,
            contextProviders: [
                ...groups.map(it => it.contextProvider),
                ...(config.contextProviders ?? [])
            ],
            onTurnComplete: (message: ChatMessage) => {
                if (!this.isOpen) this.setHasUnseenReply(true);
                chatModelConfig.onTurnComplete?.(message);
            }
        });

        // A reply's changes become undoable once its turn ends. Snapshot the component then, so
        // that a later change by other means retires the Undo.
        this.addReaction({
            track: () => this.chatModel.undoableMessageId,
            run: id => this.takeSnapshot(id),
            fireImmediately: true
        });

        // One popover helper per page: a second closes the first, and keeps its conversation.
        this.addReaction({
            track: () => this.isPopoverOpen,
            run: isOpen => {
                const owner = ChatAssistantModel.popoverOwner;
                if (isOpen) {
                    if (owner && owner !== this) owner.close();
                    ChatAssistantModel.popoverOwner = this;
                } else if (owner === this) {
                    ChatAssistantModel.popoverOwner = null;
                }
            }
        });
    }

    /** True if a backend is configured, so the helper can run. Its button renders only then. */
    get isEnabled(): boolean {
        return this.chatModel != null;
    }

    /**
     * Where the helper shows: docked inside the component at `dockMinWidth` or wider, else in a
     * popover. Docked until the component is measured.
     */
    @computed
    get mode(): 'dock' | 'popover' {
        const {componentWidth} = this;
        return componentWidth == null || componentWidth >= this.dockMinWidth ? 'dock' : 'popover';
    }

    /** True if the helper is open, docked. */
    get isDockOpen(): boolean {
        return this.isOpen && this.mode === 'dock';
    }

    /** True if the helper is open, in a popover. */
    get isPopoverOpen(): boolean {
        return this.isOpen && this.mode === 'popover';
    }

    /** What the button shows while the helper is closed, or null. */
    @computed
    get badge(): ChatAssistantBadge {
        const {chatModel, isOpen, hasUnseenReply} = this;
        if (!chatModel || isOpen) return null;
        if (chatModel.isAwaitingUser) return 'attention';
        if (hasUnseenReply && chatModel.lastMessage?.status === 'error') return 'error';
        if (chatModel.isBusy) return 'busy';
        return hasUnseenReply ? 'ready' : null;
    }

    /**
     * What the model sees of the component, for the data boundary line - the groups' declarations,
     * joined. Null if no group declares one.
     */
    get boundary(): ChatDataBoundary {
        const all = compact(this.groups.map(it => it.boundary?.()));
        if (all.length <= 1) return all[0] ?? null;
        return {
            text: all.map(it => it.text).join('; '),
            shared: all.flatMap(it => it.shared ?? []),
            notShared: all.flatMap(it => it.notShared ?? []),
            isLimitedByAdmin: all.some(it => it.isLimitedByAdmin)
        };
    }

    /** True if the helper offers Ask in chat - see `onAskInChat`. */
    get canAskInChat(): boolean {
        return this.onAskInChat != null;
    }

    @action
    open() {
        this.isOpen = true;
        this.hasUnseenReply = false;
    }

    @action
    close() {
        this.isOpen = false;
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /** Report the component's width, which decides between dock and popover. */
    @action
    setComponentWidth(width: number) {
        this.componentWidth = width;
    }

    /** Ask a question in the app's main chat - see `onAskInChat`. */
    askInChat(question: string) {
        this.onAskInChat?.(question);
    }

    /** Start the conversation over. The component keeps its changes. */
    @action
    startOver() {
        this.chatModel?.clear();
        this.snapshots = {};
        this.changes = {};
    }

    /** What a tool call changed, or null - for Show on its change line. */
    getChangeTargets(toolCallId: string): ChatChangeTarget[] {
        return this.changes[toolCallId]?.targets ?? null;
    }

    /** True if a tool call's change can show on the component - see {@link showChange}. */
    canShowChange(toolCallId: string): boolean {
        return !!this.changes[toolCallId]?.group.highlight;
    }

    /** Flash what a tool call changed again, and scroll it into view. */
    showChange(toolCallId: string) {
        const change = this.changes[toolCallId];
        change?.group.highlight?.(change.targets, {scroll: true});
    }

    getUndoRetiredReason(messageId: string): string {
        const snapshots = this.snapshots[messageId];
        if (!snapshots) return null;
        const isChanged = this.groups.some(
            (group, idx) =>
                group.isChangedSince &&
                snapshots[idx] !== undefined &&
                group.isChangedSince(snapshots[idx])
        );
        return isChanged
            ? `${this.title} has changed since, so these changes can't be undone.`
            : null;
    }

    override destroy() {
        if (ChatAssistantModel.popoverOwner === this) ChatAssistantModel.popoverOwner = null;
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    private static popoverOwner: ChatAssistantModel = null;

    private readonly onAskInChat: (question: string) => void;

    // Each undoable reply's snapshot of the component, one entry per group, by message id.
    @observableRef private accessor snapshots: Record<string, unknown[]> = {};

    // What each tool call changed, by tool call id.
    @observableRef private accessor changes: Record<
        string,
        {group: ChatToolGroup; targets: ChatChangeTarget[]}
    > = {};

    private createTransport(transport: ChatAssistantConfig['transport']): ChatTransport {
        if (isFunction(transport)) return transport(this.systemPrompt);
        if (transport) return transport;
        return XH.chatService?.isEnabled
            ? XH.chatService.createTransport({system: this.systemPrompt})
            : null;
    }

    private createSystemPrompt(appPrompt: string): string {
        const {title, docs} = this,
            rules = [
                `You are the helper for one component of the app: ${title}. You see it and ` +
                    'change it only through your tools, and you cannot change anything else.',
                'Change it when the user asks. Never save a view, submit a form or press a ' +
                    'button in the app - the user commits.',
                'Answer questions about how to use it in plain prose, briefly.',
                isEmpty(docs)
                    ? 'You have no documentation pages. Never write a link - say an answer is ' +
                      'general guidance.'
                    : 'Cite at most one page per answer, only from this list, as a markdown link ' +
                      "on the answer's last line. Never write any other link:\n" +
                      docs
                          .map(
                              it =>
                                  `- [${it.title}](${it.url})` +
                                  (it.description ? `: ${it.description}` : '')
                          )
                          .join('\n'),
                this.onAskInChat
                    ? 'For a question about anything other than this component, say that you ' +
                      'cannot help with it here, and call ask_in_chat with the question.'
                    : 'For a question about anything other than this component, say that you ' +
                      'cannot help with it here, and that the app has other places to ask.'
            ];
        return compact([rules.join('\n'), ...this.groups.map(it => it.prompt), appPrompt]).join(
            '\n\n'
        );
    }

    /**
     * Wrap a group's tool, to record and flash what each call changed, and to show its calls as
     * change lines. A tool that sets a display other than `card` keeps it, with its own renderer.
     * The wrapper inherits the spec, so that its schema getters stay live.
     */
    private wrapTool(spec: ChatToolSpec, group: ChatToolGroup): ChatToolSpec {
        if (!spec.execute) return spec;
        const model = this,
            ret = Object.create(spec) as ChatToolSpec,
            showsChangeLine = () =>
                !!model.renderers.changeLine && (spec.display ?? 'card') === 'card';
        Object.defineProperties(ret, {
            execute: {
                enumerable: true,
                value: async (input, context) => {
                    const result = await spec.execute(input, context);
                    if (result instanceof ChatToolResult && !isEmpty(result.targets)) {
                        model.recordChange(context.toolCallId, group, result.targets);
                    }
                    return result;
                }
            },
            display: {
                enumerable: true,
                get: (): ChatToolDisplay => (showsChangeLine() ? 'inline' : spec.display)
            },
            renderer: {
                enumerable: true,
                get: () => (showsChangeLine() ? model.renderers.changeLine : spec.renderer)
            }
        });
        return ret;
    }

    private askInChatTool(): ChatToolSpec {
        const model = this;
        return {
            name: 'ask_in_chat',
            description:
                "Offer to ask a question in the app's main chat, for a question about anything " +
                'other than this component. The user sees a button that asks it there.',
            parameters: objectSchema(
                {
                    question: {
                        type: 'string',
                        description: 'The question, as the user would ask it in the main chat.'
                    }
                },
                ['question']
            ),
            displayName: 'Ask in chat',
            summary: (part: ChatToolCallPart) => part.input?.question ?? null,
            get display(): ChatToolDisplay {
                return model.renderers.askInChat ? 'inline' : 'card';
            },
            get renderer(): (part: ChatToolCallPart, context: ChatPartRenderContext) => any {
                return model.renderers.askInChat;
            },
            execute: () => 'The user now sees a button that asks the question in the main chat.'
        };
    }

    @action
    private recordChange(toolCallId: string, group: ChatToolGroup, targets: ChatChangeTarget[]) {
        this.changes = {...this.changes, [toolCallId]: {group, targets}};
        group.highlight?.(targets);
    }

    @action
    private takeSnapshot(messageId: string) {
        if (!messageId || messageId in this.snapshots) return;
        this.snapshots = {
            ...this.snapshots,
            [messageId]: this.groups.map(it => it.snapshot?.())
        };
    }

    @action
    private setHasUnseenReply(value: boolean) {
        this.hasUnseenReply = value;
    }
}
