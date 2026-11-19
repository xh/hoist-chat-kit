import {chatToolResult, type ChatToolSpec} from '../../core';
import {keepArtifactRows} from '../../impl/ArtifactRows';
import {
    type ArchitectArtifact,
    type ArchitectTarget,
    type ArchitectToolContext,
    availableArchitectTools
} from '../../blueprint';

/**
 * The Architect's tools for a target, as chat kit client tools. The edit tools enforce the mode
 * and access the target holds when each call runs.
 */
export function architectChatTools(
    target: ArchitectTarget,
    opts: Pick<ArchitectToolContext, 'answerRegistry'> = {}
): ChatToolSpec[] {
    return availableArchitectTools(target).map(({name, description, parameters, run}) => ({
        name,
        description,
        parameters,
        // A query's result becomes an artifact of the reply, which the chat records and keeps.
        execute: async (input, ctx) => {
            const artifacts: ArchitectArtifact[] = [],
                output = await run(input, target, {
                    answerRegistry: opts.answerRegistry,
                    addArtifact: (artifact, rows) => {
                        artifacts.push(artifact);
                        // The thread keeps it without rows. An answer shows the rows the model saw.
                        if (ctx?.chatModel) keepArtifactRows(ctx.chatModel, artifact.id, rows);
                    }
                });
            return artifacts.length
                ? chatToolResult(output, {artifacts: artifacts as any})
                : output;
        }
    }));
}
