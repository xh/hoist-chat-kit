import {clamp, cloneDeep, isEqual, isNumber} from 'lodash';
import type {LoadSpec, PersistOptions, PlainObject} from '@xh/hoist/core';
import {HoistModel, managed, PersistableState, PersistenceProvider, XH} from '@xh/hoist/core';
import {PanelModel} from '@xh/hoist/desktop/cmp/panel';
import {action, bindable, computed, observable} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {type ChatDocumentRenderer, ChatSidePanelModel} from '../../../core';
import type {ChatThreadsModel} from '../../../threads';

/** Configuration for a {@link ChatWorkspaceModel}. */
export interface ChatWorkspaceConfig {
    /** The user's threads. The workspace lists them, and shows the selected thread's chat. */
    threadsModel: ChatThreadsModel;

    /**
     * Options to persist, per user, the sidebar's width and collapsed state, the side panel's
     * width, and the selected thread. The workspace adds `.sidebar`, `.sidePanel` and
     * `.selectedThreadId` to `path`, which defaults to 'chatWorkspace'.
     */
    persistWith?: PersistOptions;

    /** True to open the side panel at the start, for the app's own `sidePanel` content. */
    sidePanelOpen?: boolean;

    /**
     * The app's document viewer, for the side panel. With one, a click on a document's citation
     * or source row opens it beside the conversation - see {@link ChatSidePanelModel}. The kit
     * draws the panel's frame and status, but no document.
     */
    documentRenderer?: ChatDocumentRenderer;
}

/** How the workspace shows its sidebar - see {@link ChatWorkspaceModel.sidebarMode}. */
export type ChatWorkspaceSidebarMode = 'open' | 'rail' | 'hidden';

/**
 * Model for a {@link ChatWorkspace}: the threads it shows, the sidebar and side panel, and the
 * layout the workspace picks from its own measured width.
 *
 * The sidebar and the side panel are Hoist `PanelModel`s. Their widths, and the sidebar's
 * collapsed state, persist per user with `persistWith`. The layout picks the widths that show
 * from the workspace's width, and never changes the saved state:
 *
 * | Workspace width | Sidebar | Side panel | Conversation |
 * |---|---|---|---|
 * | 1,280 px and up | Open, 260 px | 520 px | The rest, at least 480 px |
 * | 1,000 to 1,279 px | Open, 240 px. The rail while the side panel shows | 460 px | At least 480 px |
 * | 788 to 999 px | The rail, unless the user expands it | 400 px | At least 380 px |
 * | Under 788 px | Hidden. The header offers the list in a popover | Not shown | All of it |
 *
 * A table or chart in the side panel takes 60% of the width it shares with the conversation, from
 * 480 to 900 px, in place of the side panel's width above.
 *
 * A width the user drags a panel to replaces the default in the band where they drag it, and in
 * every wider band. When the conversation would drop below its minimum, the sidebar gives way to
 * its rail first, and then the side panel narrows.
 *
 * At 380 px or less, the workspace shows the chat at compact density.
 */
export class ChatWorkspaceModel extends HoistModel {
    declare config: ChatWorkspaceConfig;

    //-----------------------
    // Immutable Properties
    //-----------------------
    /** The user's threads. */
    readonly threadsModel: ChatThreadsModel;

    /** The thread sidebar's panel: the user's width and collapsed state. */
    @managed readonly sidebarModel: PanelModel;

    /** The side panel's panel: the user's width. */
    @managed readonly sidePanelModel: PanelModel;

    /**
     * The side panel's request seam: the document, table or chart the panel shows. Components in
     * the conversation find it in model context, as a `ChatSidePanelHost`, and open their sources
     * in it. It has room only where the side panel shows - 788 px and up.
     */
    @managed readonly sidePanel: ChatSidePanelModel;

    //-----------------------
    // Observable State
    //-----------------------
    /** Width of the workspace, in pixels, as last measured, or null before it renders. */
    @observable accessor width: number = null;

    /**
     * True if the app wants the side panel open for its own `sidePanel` content. A request open in
     * `sidePanel` shows the panel too. It shows only where there is room. (bindable)
     */
    @bindable accessor isSidePanelOpen: boolean = false;

    /**
     * How the sidebar shows: `open`, as the 40 px `rail`, or `hidden` in a narrow workspace. The
     * user's collapsed state comes first, then the layout for the width.
     */
    @computed
    get sidebarMode(): ChatWorkspaceSidebarMode {
        return this.layout.sidebarMode;
    }

    /**
     * Width of the open sidebar, in pixels, or null when it is not open: the user's width or the
     * default for the workspace's width, cut to leave the conversation its minimum.
     */
    @computed
    get sidebarWidth(): number {
        return this.layout.sidebarWidth;
    }

    /**
     * Width of the side panel, in pixels, or null when it does not show, cut to leave the
     * conversation its minimum. A table or chart takes 60% of the width it shares with the
     * conversation, from 480 to 900 px. A document, or the app's content, takes the user's width
     * or the default for the workspace's width.
     */
    @computed
    get sidePanelWidth(): number {
        return this.layout.sidePanelWidth;
    }

    /**
     * True if the side panel shows: it has a request open, or the app wants it open, and the
     * workspace has room.
     */
    @computed
    get isSidePanelShown(): boolean {
        return (this.isSidePanelOpen || this.sidePanel.request != null) && this.hasSidePanelRoom;
    }

    /** True if the workspace is wide enough for the side panel - 788 px and up. */
    @computed
    get hasSidePanelRoom(): boolean {
        const {width} = this;
        return width == null || width >= SIDE_PANEL_MIN_WORKSPACE_WIDTH;
    }

    /** True if the workspace is narrow enough for compact density - 380 px or less. */
    @computed
    get isCompact(): boolean {
        const {width} = this;
        return width != null && width <= COMPACT_MAX_WIDTH;
    }

    constructor(config: ChatWorkspaceConfig) {
        super();
        const {threadsModel, persistWith = null, sidePanelOpen = false, documentRenderer} = config;
        throwIf(!threadsModel, 'ChatWorkspaceModel requires a threadsModel.');

        this.threadsModel = threadsModel;
        this.isSidePanelOpen = sidePanelOpen;

        const path = persistWith?.path ?? 'chatWorkspace';
        this.sidebarModel = new PanelModel({
            side: 'left',
            defaultSize: SIDEBAR_WIDTHS[WIDE_BAND],
            minSize: SIDEBAR_MIN_WIDTH,
            maxSize: SIDEBAR_MAX_WIDTH,
            collapsible: true,
            resizable: true,
            showHeaderCollapseButton: false,
            persistWith: persistWith ? {...persistWith, path: `${path}.sidebar`} : null,
            xhName: 'sidebarModel'
        });
        this.sidePanelModel = new PanelModel({
            side: 'right',
            defaultSize: SIDE_PANEL_WIDTHS[WIDE_BAND],
            minSize: SIDE_PANEL_MIN_WIDTH,
            maxSize: SIDE_PANEL_MAX_WIDTH,
            collapsible: false,
            resizable: true,
            persistWith: persistWith ? {...persistWith, path: `${path}.sidePanel`} : null,
            xhName: 'sidePanelModel'
        });
        this.sidePanel = new ChatSidePanelModel({
            documentRenderer,
            hasRoom: () => this.hasSidePanelRoom
        });

        // A saved width holds in the band where the workspace first shows it.
        if (this.sidebarModel.size !== SIDEBAR_WIDTHS[WIDE_BAND]) {
            this.sidebarSizeBand = RESTORED_BAND;
        }
        if (this.sidePanelModel.size !== SIDE_PANEL_WIDTHS[WIDE_BAND]) {
            this.sidePanelSizeBand = RESTORED_BAND;
        }

        this.addReaction(
            {
                // A user's expand of the rail holds only at the width where they made it.
                track: () => this.widthBand,
                run: band => {
                    this.setSidebarExpanded(false);
                    this.resolveRestoredBands(band);
                }
            },
            {
                track: () => this.sidebarModel.collapsed,
                run: collapsed => {
                    if (collapsed) this.setSidebarExpanded(false);
                }
            },
            {
                // The side panel takes the room back from an expanded rail.
                track: () => this.isSidePanelShown,
                run: shown => {
                    if (shown) this.setSidebarExpanded(false);
                }
            },
            {
                // A drag of a splitter sets the user's width, for this band and wider ones.
                track: () => this.sidebarModel.size,
                run: () => this.noteUserSize('sidebar')
            },
            {
                track: () => this.sidePanelModel.size,
                run: () => this.noteUserSize('sidePanel')
            }
        );

        // A request belongs to a message of the thread shown, so it closes when the thread changes.
        this.addReaction({
            track: () => threadsModel.selectedThreadId,
            run: () => this.sidePanel.open(null)
        });

        // The conversation pane always shows a chat. The thread the user last had open returns
        // once the list shows that it still exists. A thread that a route selected comes first.
        if (threadsModel.selectedThreadId == null) {
            this.initialThreadId = threadsModel.newThread().threadId;
            this.initialRunOptions = cloneDeep(threadsModel.chatModel?.runOptions ?? null);
        }
        if (persistWith) {
            this.persistSelectedThread({...persistWith, path: `${path}.selectedThreadId`});
        }
    }

    /** Load the thread list. */
    override async doLoadAsync(loadSpec: LoadSpec) {
        await this.threadsModel.loadAsync(loadSpec);
    }

    //------------------
    // Actions
    //------------------
    /**
     * Expand the sidebar from its rail. Where the layout shows the rail for lack of room, the
     * side panel closes first, so that the conversation keeps its width.
     */
    @action
    expandSidebar() {
        const {width} = this;
        this.sidebarModel.setCollapsed(false);
        if (width != null && width < WIDE_WIDTH) {
            this.isSidebarExpanded = true;
            if (this.isSidePanelShown) this.closeSidePanel();
        }
    }

    /** Collapse the sidebar to its rail. The user's choice persists. */
    collapseSidebar() {
        this.sidebarModel.setCollapsed(true);
    }

    /** Collapse the sidebar if it shows open, else expand it. */
    toggleSidebar() {
        this.sidebarMode === 'open' ? this.collapseSidebar() : this.expandSidebar();
    }

    openSidePanel() {
        this.isSidePanelOpen = true;
    }

    /** Close the side panel - its request, and the app's own content. */
    @action
    closeSidePanel() {
        this.isSidePanelOpen = false;
        if (this.sidePanel.request) this.sidePanel.close();
    }

    toggleSidePanel() {
        this.isSidePanelOpen || this.sidePanel.request
            ? this.closeSidePanel()
            : this.openSidePanel();
    }

    /** Record the workspace's measured width. Called by the component as it resizes. */
    @action
    setWidth(width: number) {
        this.width = width == null ? null : Math.round(width);
    }

    /**
     * Record the rail's width, read from `--xh-chat-sidebar-rail-width` as the workspace mounts.
     * @internal
     */
    @action
    setRailWidth(width: number) {
        if (width > 0) this.railWidth = width;
    }

    //------------------
    // Implementation
    //------------------
    // True while the user has expanded the rail at a width that would otherwise show it.
    @observable private accessor isSidebarExpanded = false;

    // The band where the user set each panel's width, or null for the default width.
    @observable private accessor sidebarSizeBand: number = null;
    @observable private accessor sidePanelSizeBand: number = null;

    // The band where the user dragged the side panel while a table or chart showed, or null.
    @observable private accessor dataSizeBand: number = null;

    // The saved thread to select once the list shows it, while the new chat is untouched.
    @observable private accessor restoreThreadId: string = null;

    // Width of the sidebar's rail, from its CSS variable once mounted.
    @observable private accessor railWidth: number = null;

    // The new thread the workspace started with, and its run options at the start.
    private initialThreadId: string = null;
    private initialRunOptions: PlainObject = null;

    @computed
    private get widthBand(): number {
        const {width} = this;
        if (width == null) return null;
        return BANDS.findIndex(it => width < it);
    }

    @computed
    private get layout(): Layout {
        const {width} = this,
            band = this.widthBand ?? WIDE_BAND;
        if (band === HIDDEN_BAND) {
            return {sidebarMode: 'hidden', sidebarWidth: null, sidePanelWidth: null};
        }

        const isPanelShown = this.isSidePanelShown;
        let sidebarMode = this.getSidebarMode(band, isPanelShown),
            sidebarWidth = sidebarMode === 'open' ? this.getPreferredWidth('sidebar', band) : null;
        const getSidebarSpace = () =>
                sidebarMode === 'open'
                    ? sidebarWidth + SPLITTER_WIDTH
                    : (this.railWidth ?? RAIL_WIDTH),
            getSidePanelWidth = () =>
                isPanelShown
                    ? this.getSidePanelWidth(band, width == null ? null : width - getSidebarSpace())
                    : null;
        let sidePanelWidth = getSidePanelWidth();
        if (width == null) return {sidebarMode, sidebarWidth, sidePanelWidth};

        // When the conversation would drop below its minimum, the sidebar gives way to its rail
        // first, and then the side panel narrows.
        const minConversation =
                band === NARROW_BAND ? NARROW_MIN_CONVERSATION_WIDTH : MIN_CONVERSATION_WIDTH,
            getSpare = () =>
                width -
                minConversation -
                getSidebarSpace() -
                (isPanelShown ? sidePanelWidth + SPLITTER_WIDTH : 0);

        if (isPanelShown && sidebarMode === 'open' && getSpare() < 0) {
            sidebarMode = 'rail';
            sidebarWidth = null;
            // A table or chart widens into the room the sidebar gave up.
            sidePanelWidth = getSidePanelWidth();
        }
        if (isPanelShown && getSpare() < 0) {
            sidePanelWidth = Math.max(0, sidePanelWidth + getSpare());
        }
        if (sidebarMode === 'open' && getSpare() < 0) {
            sidebarWidth = Math.max(0, sidebarWidth + getSpare());
        }
        return {sidebarMode, sidebarWidth, sidePanelWidth};
    }

    private getSidebarMode(band: number, isPanelShown: boolean): ChatWorkspaceSidebarMode {
        if (this.sidebarModel.collapsed) return 'rail';
        if (this.isSidebarExpanded) return 'open';
        if (band === NARROW_BAND) return 'rail';
        if (band === MEDIUM_BAND && isPanelShown) return 'rail';
        return 'open';
    }

    // The user's width holds in the band where they set it, and in wider ones. Elsewhere, the
    // band's default - never wider than the user's width.
    private getPreferredWidth(panel: PanelName, band: number): number {
        const {panelModel, sizeBand, widths} = this.getPanelSpec(panel),
            size = isNumber(panelModel.size) ? panelModel.size : widths[WIDE_BAND];
        if (sizeBand === RESTORED_BAND || (sizeBand != null && band >= sizeBand)) return size;
        return Math.min(size, widths[band]);
    }

    // A table or chart takes its share of the width that the side panel shares with the
    // conversation, unless the user dragged the panel while one showed. Then the user's width
    // holds as above. Everything else takes the side panel's preferred width.
    private getSidePanelWidth(band: number, sharedWidth: number): number {
        if (!this.isDataRequestOpen || sharedWidth == null) {
            return this.getPreferredWidth('sidePanel', band);
        }
        const {dataSizeBand} = this,
            {size} = this.sidePanelModel,
            dataWidth = clamp(
                Math.round(sharedWidth * DATA_PANEL_SHARE),
                DATA_PANEL_MIN_WIDTH,
                DATA_PANEL_MAX_WIDTH
            );
        if (dataSizeBand == null || !isNumber(size)) return dataWidth;
        return band >= dataSizeBand ? size : Math.min(size, dataWidth);
    }

    // True if the side panel's request is a table or a chart.
    private get isDataRequestOpen(): boolean {
        const type = this.sidePanel.request?.type;
        return type === 'table' || type === 'chart';
    }

    private getPanelSpec(panel: PanelName) {
        return panel === 'sidebar'
            ? {
                  panelModel: this.sidebarModel,
                  sizeBand: this.sidebarSizeBand,
                  widths: SIDEBAR_WIDTHS
              }
            : {
                  panelModel: this.sidePanelModel,
                  sizeBand: this.sidePanelSizeBand,
                  widths: SIDE_PANEL_WIDTHS
              };
    }

    @action
    private noteUserSize(panel: PanelName) {
        const {panelModel, widths} = this.getPanelSpec(panel),
            band = panelModel.size === widths[WIDE_BAND] ? null : (this.widthBand ?? WIDE_BAND);
        if (panel === 'sidebar') {
            this.sidebarSizeBand = band;
        } else {
            this.sidePanelSizeBand = band;
            if (this.isDataRequestOpen) this.dataSizeBand = this.widthBand ?? WIDE_BAND;
        }
    }

    @action
    private resolveRestoredBands(band: number) {
        if (band == null) return;
        if (this.sidebarSizeBand === RESTORED_BAND) this.sidebarSizeBand = band;
        if (this.sidePanelSizeBand === RESTORED_BAND) this.sidePanelSizeBand = band;
    }

    @action
    private setSidebarExpanded(expanded: boolean) {
        this.isSidebarExpanded = expanded;
    }

    //------------------------
    // Selected thread
    //------------------------
    private persistSelectedThread(persistOptions: PersistOptions) {
        PersistenceProvider.create({
            persistOptions,
            owner: this,
            target: {
                getPersistableState: () => new PersistableState(this.threadIdToPersist),
                setPersistableState: ({value}) => this.setRestoreThreadId(value ?? null)
            }
        });

        const {threadsModel} = this;
        this.addReaction({
            track: () => [threadsModel.threads, threadsModel.lastLoadCompleted],
            run: () => this.restoreThread(),
            fireImmediately: true
        });
    }

    // The selected thread, once the store lists it - a new chat has nothing to return to. The
    // saved thread, while it waits for the list.
    @computed
    private get threadIdToPersist(): string {
        const {threadsModel, restoreThreadId} = this;
        if (restoreThreadId != null && this.isUntouched) return restoreThreadId;
        return threadsModel.selectedSummary ? threadsModel.selectedThreadId : null;
    }

    // True while the new chat the workspace started with is selected, and the user has not used
    // it: no messages, nothing in the composer, and its run options as they started.
    private get isUntouched(): boolean {
        const {threadsModel, initialThreadId} = this,
            {chatModel} = threadsModel;
        return (
            initialThreadId != null &&
            threadsModel.selectedThreadId === initialThreadId &&
            !!chatModel?.isEmpty &&
            !!chatModel.composerModel?.isEmpty &&
            isEqual(chatModel.runOptions ?? null, this.initialRunOptions)
        );
    }

    private restoreThread() {
        const {threadsModel, restoreThreadId: threadId} = this;
        if (threadId == null) return;

        // The user, or a route, chose a thread first.
        if (!this.isUntouched || this.isRouteSelected) {
            this.setRestoreThreadId(null);
            return;
        }

        if (threadsModel.threads.some(it => it.id === threadId)) {
            this.setRestoreThreadId(null);
            threadsModel.selectThreadAsync(threadId).catchDefault();
        } else if (threadsModel.lastLoadCompleted && !threadsModel.listError) {
            // Listed, and gone: the new chat stays.
            this.setRestoreThreadId(null);
        }
    }

    // True if the threads model's route names a thread.
    private get isRouteSelected(): boolean {
        const {route} = this.threadsModel,
            state = XH.routerState;
        if (!route || !state) return false;
        const isOnRoute = state.name === route.name || state.name?.startsWith(route.name + '.');
        return isOnRoute && state.params?.[route.param] != null;
    }

    @action
    private setRestoreThreadId(threadId: string) {
        this.restoreThreadId = threadId;
    }
}

//------------------
// Layout constants
//------------------
type PanelName = 'sidebar' | 'sidePanel';

interface Layout {
    sidebarMode: ChatWorkspaceSidebarMode;
    sidebarWidth: number;
    sidePanelWidth: number;
}

const SIDEBAR_MIN_WIDTH = 200,
    SIDEBAR_MAX_WIDTH = 400,
    SIDE_PANEL_MIN_WIDTH = 400,
    SIDE_PANEL_MAX_WIDTH = 900,
    // A table or chart's share of the width beside the sidebar, and its bounds.
    DATA_PANEL_SHARE = 0.6,
    DATA_PANEL_MIN_WIDTH = 480,
    DATA_PANEL_MAX_WIDTH = 900,
    // Hoist's splitter beside a resizable panel, and the default of the sidebar's rail.
    SPLITTER_WIDTH = 8,
    RAIL_WIDTH = 40,
    // 380 for the conversation, 8 for the splitter and 400 for the side panel.
    SIDE_PANEL_MIN_WORKSPACE_WIDTH = 788,
    RAIL_BELOW_WIDTH = 1000,
    WIDE_WIDTH = 1280,
    COMPACT_MAX_WIDTH = 380,
    MIN_CONVERSATION_WIDTH = 480,
    NARROW_MIN_CONVERSATION_WIDTH = 380,
    // The bands of width, by index - each up to the next breakpoint.
    BANDS = [SIDE_PANEL_MIN_WORKSPACE_WIDTH, RAIL_BELOW_WIDTH, WIDE_WIDTH, Infinity],
    HIDDEN_BAND = 0,
    NARROW_BAND = 1,
    MEDIUM_BAND = 2,
    WIDE_BAND = 3,
    // A saved width, before the workspace measures the band it first shows in.
    RESTORED_BAND = -1,
    // Default widths by band. The widest band's are the panels' default sizes.
    SIDEBAR_WIDTHS = [null, 240, 240, 260],
    SIDE_PANEL_WIDTHS = [null, 400, 460, 520];
