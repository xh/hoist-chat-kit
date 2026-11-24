import {XH} from '@xh/hoist/core';
import type {useHotkeys} from '@xh/hoist/desktop/hooks';
import type {BlueprintDesignModel, BlueprintIssue} from '../../../../../blueprint';
import {childIds} from '../../../../../blueprint/impl/elements';
import {duplicateElement, removeSelectionAsync} from './designActions';

type HotkeyConfig = Parameters<typeof useHotkeys>[1][number];

interface DesignKey {
    combo: string;
    label: string;
    run: (designModel: BlueprintDesignModel, id: string) => void;
    /** True to run with nothing selected. */
    always?: boolean;
    /** True to run with focus in a widget's own control too, as the mode keys do. */
    anywhere?: boolean;
    /** True to run in run mode too, as Preview's key does from the reader's view. */
    anyMode?: boolean;
    /** True to bind only while the design model has a Preview toggle. */
    needsPreview?: boolean;
}

/**
 * The design keys, for a dashboard or Structure to bind with a panel's `hotkeys`. They act on the
 * selected element in design mode only, and never while focus is in an input, which keeps its own
 * keys.
 */
export function designHotkeys(
    designModel: BlueprintDesignModel,
    opts: {
        /** False to leave the arrows to a host that moves with them, such as a grid. */
        arrows?: boolean;
        /**
         * True for a surface that draws live widgets, such as the dashboard, whose own controls keep
         * their keys: a key pressed in a grid, a button or a slider never reaches the design.
         */
        fromWidgets?: boolean;
    } = {}
): HotkeyConfig[] {
    const {arrows = true, fromWidgets = false} = opts;
    return DESIGN_KEYS.filter(it => arrows || !ARROW_RE.test(it.combo))
        .filter(it => !it.needsPreview || designModel.onPreview)
        .map(({combo, label, run, always, anywhere, anyMode}) => ({
            combo,
            label,
            group: 'Design',
            onKeyDown: (e: KeyboardEvent) => {
                if (!anyMode && designModel.blueprintModel.mode !== 'design') return;
                if (fromWidgets && !anywhere && (e.target as Element)?.closest?.(INTERACTIVE)) {
                    return;
                }
                // A selected view's keys act on the element in it, but for Esc and Enter.
                const id = designModel.selectedElementId ?? designModel.selectedViewId;
                if (!id && !always) return;
                e.preventDefault();
                run(designModel, id);
            }
        }));
}

/**
 * The keys that switch between Edit and Interact, and to Preview, and Ctrl+D to duplicate, for
 * the Inspector, which binds no other design keys, as Delete resets a setting there. Never bind
 * them inside a part that binds the design keys, or each runs twice.
 */
export function inspectorHotkeys(designModel: BlueprintDesignModel): HotkeyConfig[] {
    return designHotkeys(designModel, {arrows: false}).filter(it =>
        INSPECTOR_COMBOS.includes(it.combo)
    );
}

const INSPECTOR_COMBOS = ['e', 'i', '`', 'p', 'mod+d'];

//------------------
// Implementation
//------------------
const isWriter = (designModel: BlueprintDesignModel) => {
    const {mode, access} = designModel.blueprintModel;
    return mode === 'design' && access === 'write';
};

const refuse = (designModel: BlueprintDesignModel, issues: BlueprintIssue[]) => {
    const error = issues.find(it => it.severity === 'error');
    if (error) designModel.blueprintModel.showRefusal(error);
};

const selectElement = (designModel: BlueprintDesignModel, id: string) => {
    if (id) designModel.select({kind: 'element', id});
};

const inDashboardCell = (designModel: BlueprintDesignModel, id: string) => {
    const elements = designModel.blueprintModel.blueprint?.elements ?? {},
        parent = designModel.pathTo(id).at(-1);
    return elements[parent]?.component === 'dashboard';
};

// An arrow nudges or resizes a dashboard cell, and moves to a sibling elsewhere.
const arrow =
    (dx: number, dy: number, resize: boolean) => (dm: BlueprintDesignModel, id: string) => {
        if (inDashboardCell(dm, id)) {
            if (isWriter(dm)) {
                refuse(dm, dm.nudgeChild(id, resize ? {dw: dx, dh: dy} : {dx, dy}).issues);
            }
        } else if (!resize) {
            selectElement(dm, dm.siblingOf(id, (dx || dy) > 0 ? 1 : -1));
        }
    };

// A widget's controls that take keys of their own. Blueprint's hotkeys already skip inputs.
const INTERACTIVE = [
    'button',
    'a[href]',
    '[role=gridcell]',
    '[role=slider]',
    '[role=listbox]',
    '[role=tab]',
    '[role=menuitem]',
    '.xh-grid',
    '.ag-root-wrapper'
].join(',');

const ARROW_RE = /^(shift\+)?(left|right|up|down)$/;

const DESIGN_KEYS: DesignKey[] = [
    {
        combo: 'e',
        label: 'Edit: clicks select',
        always: true,
        anywhere: true,
        run: dm => dm.setInteraction('edit')
    },
    {
        combo: 'i',
        label: 'Interact: clicks reach the widgets',
        always: true,
        anywhere: true,
        run: dm => dm.setInteraction('interact')
    },
    {
        combo: '`',
        label: 'Switch between Edit and Interact',
        always: true,
        anywhere: true,
        run: dm => dm.setInteraction(dm.interaction === 'edit' ? 'interact' : 'edit')
    },
    {
        combo: 'p',
        label: "Preview: the reader's view",
        always: true,
        anywhere: true,
        anyMode: true,
        needsPreview: true,
        run: dm => dm.onPreview?.()
    },
    {
        combo: 'esc',
        label: 'Select the parent, else clear',
        run: (dm, id) => {
            // During a cell drag, Escape cancels the drag instead.
            if (document.querySelector('.react-draggable-dragging')) return;
            // A widget climbs to its view, and a view to its container.
            const view = dm.selectedElementId ? dm.viewOf(id) : null,
                parent = dm.pathTo(id).at(-1);
            if (view) dm.select({kind: 'view', ...view});
            else dm.select(parent ? {kind: 'element', id: parent} : null);
        }
    },
    {
        combo: 'enter',
        label: 'Select the first child',
        run: (dm, id) => {
            if (dm.selectedViewId) return selectElement(dm, id);
            const el = dm.blueprintModel.blueprint?.elements?.[id],
                child = el ? childIds(el)[0] : null,
                view = child ? dm.viewOf(child) : null;
            // A dashboard goes to its first view, and a view to the widget in it.
            if (view) dm.select({kind: 'view', ...view});
            else selectElement(dm, child);
        }
    },
    {
        combo: '[',
        label: 'Previous sibling',
        run: (dm, id) => selectElement(dm, dm.siblingOf(id, -1))
    },
    {combo: ']', label: 'Next sibling', run: (dm, id) => selectElement(dm, dm.siblingOf(id, 1))},
    {
        combo: 'f2',
        label: "Rename the selection's id",
        run: async (dm, id) => {
            if (!isWriter(dm)) return;
            const to = await XH.prompt<string>({
                title: 'Rename',
                message: `New id for ${id}`,
                input: {initialValue: id}
            });
            if (to && to !== id) refuse(dm, dm.renameId('element', id, to).issues);
        }
    },
    {
        combo: 'del',
        label: 'Delete',
        always: true,
        run: dm => {
            if (isWriter(dm)) removeSelectionAsync(dm).then(it => refuse(dm, it));
        }
    },
    {
        combo: 'backspace',
        label: 'Delete',
        always: true,
        run: dm => {
            if (isWriter(dm)) removeSelectionAsync(dm).then(it => refuse(dm, it));
        }
    },
    {
        combo: 'mod+d',
        label: 'Duplicate',
        run: (dm, id) => {
            if (isWriter(dm)) duplicateElement(dm, id);
        }
    },
    {
        combo: 'left',
        label: 'Nudge a cell, or previous sibling',
        run: arrow(-1, 0, false)
    },
    {combo: 'right', label: 'Nudge a cell, or next sibling', run: arrow(1, 0, false)},
    {combo: 'up', label: 'Nudge a cell, or previous sibling', run: arrow(0, -1, false)},
    {combo: 'down', label: 'Nudge a cell, or next sibling', run: arrow(0, 1, false)},
    {combo: 'shift+left', label: 'Narrow a cell', run: arrow(-1, 0, true)},
    {combo: 'shift+right', label: 'Widen a cell', run: arrow(1, 0, true)},
    {combo: 'shift+up', label: 'Shorten a cell', run: arrow(0, -1, true)},
    {combo: 'shift+down', label: 'Lengthen a cell', run: arrow(0, 1, true)},
    {
        combo: 'alt+up',
        label: 'Move earlier in its slot',
        run: (dm, id) => isWriter(dm) && refuse(dm, dm.reorder(id, -1).issues)
    },
    {
        combo: 'alt+down',
        label: 'Move later in its slot',
        run: (dm, id) => isWriter(dm) && refuse(dm, dm.reorder(id, 1).issues)
    },
    {
        combo: 'mod+z',
        label: 'Undo',
        always: true,
        run: dm => dm.blueprintModel.canUndo && refuse(dm, dm.blueprintModel.undo().issues)
    },
    {
        combo: 'mod+shift+z',
        label: 'Redo',
        always: true,
        run: dm => dm.blueprintModel.canRedo && refuse(dm, dm.blueprintModel.redo().issues)
    },
    {
        combo: '/',
        label: "Search Add's widgets",
        always: true,
        run: dm => isWriter(dm) && dm.requestAdd()
    }
];
