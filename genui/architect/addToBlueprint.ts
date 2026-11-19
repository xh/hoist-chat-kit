import type {ChatModel} from '../../core';
import type {ChatUiAddToHost} from '../ChatUiCatalog';
import type {DesignModeTarget} from './requestDesignMode';

/**
 * Adds a chat answer to a blueprint through the Architect, for `ChatUiAnswersConfig.addToHost`.
 * The button shows only with write access. Its click is the user's consent to design mode: it
 * switches the blueprint to design mode and asks the Architect to add the answer. Design mode ends
 * with that turn, unless the user had it on.
 */
export function addToBlueprint(
    target: DesignModeTarget,
    opts: {label?: string; message?: (answerId: string) => string} = {}
): ChatUiAddToHost {
    const {label, message = (id: string) => `Add answer ${id} to my dashboard.`} = opts;
    return {
        label,
        isAvailable: () => target.access === 'write',
        add: async (answerId: string, chatModel: ChatModel) => {
            if (chatModel.isBusy || target.access !== 'write') return;
            const wasRun = target.mode === 'run';
            target.setMode('design');
            try {
                await chatModel.sendAsync(message(answerId));
            } finally {
                if (wasRun) target.setMode('run');
            }
        }
    };
}
