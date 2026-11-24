import {chatToolResult, type ChatToolSpec} from '../../core';
import {keepArtifactRows} from '../../impl/ArtifactRows';
import {
    type ArchitectArtifact,
    type ArchitectTarget,
    availableArchitectTools,
    normalizeToolInput
} from '../../blueprint';
import type {ChatUiCatalog} from '../ChatUiCatalog';
import {readAnswerTool} from './readAnswer';
import {type DesignModeTarget, requestDesignModeTool} from './requestDesignMode';
import {type FeatureRequestSink, requestFeatureTool} from './requestFeature';

/**
 * The Architect's tools for a target, as chat kit client tools, with the registry's client tools. The edit tools enforce the mode
 * and access the target holds when each call runs. With the chat's `catalog`, the Architect also
 * learns where each widget is allowed, and can read the chat's answers to add them to the target.
 * With `featureRequests`, it can send the app a request for a capability the registry lacks, once
 * the user approves it. Pass `withFeatureRequests` to `architectPrompt()` with it.
 */
export function architectChatTools(
    target: ArchitectTarget,
    opts: {catalog?: ChatUiCatalog; featureRequests?: FeatureRequestSink} = {}
): ChatToolSpec[] {
    const {catalog, featureRequests} = opts,
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
    const chatOnly = [
        ...(target.setMode ? [requestDesignModeTool(target as DesignModeTarget)] : []),
        ...(catalog ? [readAnswerTool(catalog, target)] : []),
        ...(featureRequests ? [requestFeatureTool(featureRequests)] : [])
    ].map(it => ({
        ...it,
        execute: (input, ctx) => it.execute(normalizeToolInput(it.parameters, input), ctx)
    }));
    return [...tools, ...chatOnly, ...appTools(target)];
}

//------------------
// Implementation
//------------------
// A model API takes no dot in a tool name, and the registry refuses '__' in one.
function appTools(target: ArchitectTarget): ChatToolSpec[] {
    return Object.values(target.registry.tools ?? {})
        .filter(it => it.runsOn === 'client')
        .map(({name, summary, guidance, parameters, needsApproval, execute}) => ({
            name: name.replaceAll('.', '__'),
            description: [summary, guidance].filter(Boolean).join(' '),
            parameters,
            needsApproval,
            execute: input => execute(normalizeToolInput(parameters, input), {target})
        }));
}
