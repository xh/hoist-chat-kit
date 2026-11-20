import type {BlueprintElement} from '../Blueprint';

/** The ID of the container that holds an element, or null for the root or an unplaced element. */
export function parentOf(elements: Record<string, BlueprintElement>, id: string): string {
    return (
        Object.entries(elements ?? {}).find(([, el]) => el.children?.some(c => c.id === id))?.[0] ??
        null
    );
}
