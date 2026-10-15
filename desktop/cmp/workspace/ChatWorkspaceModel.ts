import type {LoadSpec, PersistOptions} from '@xh/hoist/core';
import {HoistModel, managed} from '@xh/hoist/core';
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
     * Options to persist the sidebar's width and collapsed state, and the side panel's width, per
     * user. The workspace adds `.sidebar` and `.sidePanel` to `path`, which defaults to
     * 'chatWorkspace'.
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
 * The sidebar is a Hoist `PanelModel` - resizable from 200 to 400 px, and collapsible to a 40 px
 * rail - whose width and collapsed state persist per user with `persistWith`. The layout narrows
 * the sidebar as the workspace narrows, without changing the user's saved state:
 *
 * | Workspace width | Sidebar | Side panel |
 * |---|---|---|
 * | 1,280 px and up | Open | Beside the conversation |
 * | 1,000 to 1,279 px | Open, or the rail while the side panel is open | Beside the conversation |
 * | 788 to 999 px | The rail, unless the user expands it | Beside the conversation |
 * | Under 788 px | Hidden - the header offers the list in a popover | Not shown |
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

    /** The thread sidebar's panel: its width and collapsed state. */
    @managed readonly sidebarModel: PanelModel;

    /** The side panel's panel: its width. */
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
        const {width} = this;
        if (width != null && width < SIDE_PANEL_MIN_WORKSPACE_WIDTH) return 'hidden';
        if (this.sidebarModel.collapsed) return 'rail';
        if (width == null || this.isSidebarExpanded) return 'open';
        if (width < RAIL_BELOW_WIDTH) return 'rail';
        if (width < WIDE_WIDTH && this.isSidePanelShown) return 'rail';
        return 'open';
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
            defaultSize: SIDEBAR_DEFAULT_WIDTH,
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
            defaultSize: SIDE_PANEL_DEFAULT_WIDTH,
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

        // A user's expand of the rail holds only at the width where they made it.
        this.addReaction(
            {
                track: () => this.widthBand,
                run: () => this.setSidebarExpanded(false)
            },
            {
                track: () => this.sidebarModel.collapsed,
                run: collapsed => {
                    if (collapsed) this.setSidebarExpanded(false);
                }
            }
        );

        // A request belongs to a message of the thread shown, so it closes when the thread changes.
        this.addReaction({
            track: () => threadsModel.selectedThreadId,
            run: () => this.sidePanel.open(null)
        });

        // The conversation pane always shows a chat.
        if (threadsModel.selectedThreadId == null) threadsModel.newThread();
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
            if (width < RAIL_BELOW_WIDTH) this.closeSidePanel();
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

    //------------------
    // Implementation
    //------------------
    // True while the user has expanded the rail at a width that would otherwise show it.
    @observable private accessor isSidebarExpanded = false;

    @computed
    private get widthBand(): number {
        const {width} = this;
        if (width == null) return null;
        return BANDS.findIndex(it => width < it);
    }

    @action
    private setSidebarExpanded(expanded: boolean) {
        this.isSidebarExpanded = expanded;
    }
}

//------------------
// Layout constants
//------------------
const SIDEBAR_DEFAULT_WIDTH = 260,
    SIDEBAR_MIN_WIDTH = 200,
    SIDEBAR_MAX_WIDTH = 400,
    SIDE_PANEL_DEFAULT_WIDTH = 520,
    SIDE_PANEL_MIN_WIDTH = 400,
    SIDE_PANEL_MAX_WIDTH = 900,
    // 380 for the conversation, 8 for the splitter and 400 for the side panel.
    SIDE_PANEL_MIN_WORKSPACE_WIDTH = 788,
    RAIL_BELOW_WIDTH = 1000,
    WIDE_WIDTH = 1280,
    COMPACT_MAX_WIDTH = 380,
    BANDS = [SIDE_PANEL_MIN_WORKSPACE_WIDTH, RAIL_BELOW_WIDTH, WIDE_WIDTH, Infinity];
