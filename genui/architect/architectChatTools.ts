import {chatToolResult, type ChatToolSpec} from '../../core';
import {keepArtifactRows} from '../../impl/ArtifactRows';
import {
    type ArchitectArtifact,
    type ArchitectTarget,
    availableArchitectTools
} from '../../blueprint';
import type {ChatUiCatalog} from '../ChatUiCatalog';
import {readAnswerTool} from './readAnswer';
import {type DesignModeTarget, requestDesignModeTool} from './requestDesignMode';

/**
 * The Architect's tools for a target, as chat kit client tools. The edit tools enforce the mode
 * and access the target holds when each call runs. With the chat's `catalog`, the Architect also
 * learns where each widget is allowed, and can read the chat's answers to add them to the target.
 */
export function architectChatTools(
    target: ArchitectTarget,
    opts: {catalog?: ChatUiCatalog} = {}
): ChatToolSpec[] {
    const {catalog} = opts,
        tools = availableArchitectTools(target).map(({name, description, parameters, run}) => ({
            name,
            description,
            parameters,
            // A query's result becomes an artifact of the reply, which the chat records and keeps.
            execute: async (input, ctx) => {
                const artifacts: ArchitectArtifact[] = [],
                    output = await run(input, target, {
                        answerRegistry: catalog?.registry,
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
    return [
        ...tools,
        ...(target.setMode ? [requestDesignModeTool(target as DesignModeTarget)] : []),
        ...(catalog ? [readAnswerTool(catalog, target)] : [])
    ];
}
