import {chatToolResult, type ChatToolSpec} from '../../core';
import {
    type ArchitectArtifact,
    type ArchitectTarget,
    availableArchitectTools
} from './ArchitectTools';

/**
 * The Architect's tools for a target, as chat kit client tools. The edit tools enforce the mode
 * and access the target holds when each call runs.
 */
export function architectChatTools(target: ArchitectTarget): ChatToolSpec[] {
    return availableArchitectTools(target).map(({name, description, parameters, run}) => ({
        name,
        description,
        parameters,
        // A query's result becomes an artifact of the reply, which the chat records and keeps.
        execute: async input => {
            const artifacts: ArchitectArtifact[] = [],
                output = await run(input, target, {addArtifact: it => artifacts.push(it)});
            return artifacts.length
                ? chatToolResult(output, {artifacts: artifacts as any})
                : output;
        }
    }));
}
