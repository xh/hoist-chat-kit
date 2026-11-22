import {table, tbody, td, th, tr} from '@xh/hoist/cmp/layout';
import {XH} from '@xh/hoist/core';
import type {useHotkeys} from '@xh/hoist/desktop/hooks';
import type {BlueprintDesignModel, BlueprintIssue} from '../../../../../blueprint';
import {childIds} from '../../../../../blueprint/impl/elements';
import {duplicateElement, removeElementAsync} from './designActions';

type HotkeyConfig = Parameters<typeof useHotkeys>[1][number];

interface DesignKey {
    combo: string;
    label: string;
    /** The keys as the shortcut list shows them, when they differ from the combo. */
    keys?: string;
    run: (designModel: BlueprintDesignModel, id: string) => void;
    /** True to run with nothing selected. */
    always?: boolean;
}

/**
 * The design keys, for a canvas or Structure to bind with a panel's `hotkeys`. They act on the
 * selected element, and never while focus is in an input, which keeps its own keys.
 */
export function designHotkeys(
    designModel: BlueprintDesignModel,
    opts: {
        /** False to leave the arrows to a host that moves with them, such as a grid. */
        arrows?: boolean;
        /**
         * True for a surface that draws live widgets, such as the canvas, whose own controls keep
         * their keys: a key pressed in a grid, a button or a slider never reaches the design.
         */
        fromWidgets?: boolean;
    } = {}
): HotkeyConfig[] {
    const {arrows = true, fromWidgets = false} = opts;
    return DESIGN_KEYS.filter(it => arrows || !ARROW_RE.test(it.combo)).map(
        ({combo, label, run, always}) => ({
            combo,
            label,
            group: 'Design',
            onKeyDown: (e: KeyboardEvent) => {
                if (fromWidgets && (e.target as Element)?.closest?.(INTERACTIVE)) return;
                const id = designModel.selectedElementId;
                if (!id && !always) return;
                e.preventDefault();
                run(designModel, id);
            }
        })
    );
}

/** Show the design keys in a dialog. */
export function showDesignKeys() {
    XH.alert({
        title: 'Keyboard shortcuts',
        message: table({
            className: 'xh-blueprint-design-keys',
            children: tbody(
                DESIGN_KEYS.map(it =>
                    tr({
                        key: it.combo,
                        children: [th({scope: 'row', children: it.keys ?? it.combo}), td(it.label)]
                    })
                )
            )
        })
    });
}

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

const inCanvasCell = (designModel: BlueprintDesignModel, id: string) => {
    const elements = designModel.blueprintModel.blueprint?.elements ?? {},
        parent = designModel.pathTo(id).at(-1);
    return elements[parent]?.component === 'dashCanvas';
};

// An arrow nudges or resizes a canvas cell, and moves to a sibling elsewhere.
const arrow =
    (dx: number, dy: number, resize: boolean) => (dm: BlueprintDesignModel, id: string) => {
        if (inCanvasCell(dm, id)) {
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
        combo: 'esc',
        keys: 'Esc',
        label: 'Select the parent, else clear',
        run: (dm, id) => {
            const parent = dm.pathTo(id).at(-1);
            dm.select(parent ? {kind: 'element', id: parent} : null);
        }
    },
    {
        combo: 'enter',
        keys: 'Enter',
        label: 'Select the first child',
        run: (dm, id) => {
            const el = dm.blueprintModel.blueprint?.elements?.[id];
            if (el) selectElement(dm, childIds(el)[0]);
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
        keys: 'F2',
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
        keys: 'Del',
        label: 'Delete',
        run: (dm, id) => {
            if (isWriter(dm)) removeElementAsync(dm, id).then(it => refuse(dm, it));
        }
    },
    {
        combo: 'backspace',
        keys: 'Backspace',
        label: 'Delete',
        run: (dm, id) => {
            if (isWriter(dm)) removeElementAsync(dm, id).then(it => refuse(dm, it));
        }
    },
    {
        combo: 'mod+d',
        keys: 'Ctrl+D',
        label: 'Duplicate',
        run: (dm, id) => {
            if (isWriter(dm)) duplicateElement(dm, id);
        }
    },
    {
        combo: 'left',
        keys: '←',
        label: 'Nudge a cell, or previous sibling',
        run: arrow(-1, 0, false)
    },
    {combo: 'right', keys: '→', label: 'Nudge a cell, or next sibling', run: arrow(1, 0, false)},
    {combo: 'up', keys: '↑', label: 'Nudge a cell, or previous sibling', run: arrow(0, -1, false)},
    {combo: 'down', keys: '↓', label: 'Nudge a cell, or next sibling', run: arrow(0, 1, false)},
    {combo: 'shift+left', keys: 'Shift+←', label: 'Narrow a cell', run: arrow(-1, 0, true)},
    {combo: 'shift+right', keys: 'Shift+→', label: 'Widen a cell', run: arrow(1, 0, true)},
    {combo: 'shift+up', keys: 'Shift+↑', label: 'Shorten a cell', run: arrow(0, -1, true)},
    {combo: 'shift+down', keys: 'Shift+↓', label: 'Lengthen a cell', run: arrow(0, 1, true)},
    {
        combo: 'alt+up',
        keys: 'Alt+↑',
        label: 'Move earlier in its slot',
        run: (dm, id) => isWriter(dm) && refuse(dm, dm.reorder(id, -1).issues)
    },
    {
        combo: 'alt+down',
        keys: 'Alt+↓',
        label: 'Move later in its slot',
        run: (dm, id) => isWriter(dm) && refuse(dm, dm.reorder(id, 1).issues)
    },
    {
        combo: 'mod+z',
        keys: 'Ctrl+Z',
        label: 'Undo',
        always: true,
        run: dm => dm.blueprintModel.canUndo && refuse(dm, dm.blueprintModel.undo().issues)
    },
    {
        combo: 'mod+shift+z',
        keys: 'Ctrl+Shift+Z',
        label: 'Redo',
        always: true,
        run: dm => dm.blueprintModel.canRedo && refuse(dm, dm.blueprintModel.redo().issues)
    },
    {
        combo: '/',
        keys: '/',
        label: "Search Add's widgets",
        always: true,
        run: dm => isWriter(dm) && dm.requestAdd()
    },
    {combo: 'shift+/', keys: '?', label: 'This list', always: true, run: () => showDesignKeys()}
];
