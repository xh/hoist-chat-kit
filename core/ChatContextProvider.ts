import type {Awaitable, PlainObject} from '@xh/hoist/core';
import type {ChatRunRequest} from '../transport';

/**
 * Supplies live context to the model at every step - such as the current state of a grid or a
 * dashboard - so that the model sees changes made since the last step, including those its own
 * tools made. See {@link ChatModelConfig.contextProviders}.
 *
 * Describe structure by default - columns, sorts, groups, widgets - rather than row values. Context
 * leaves the browser on every step, so data stays in the app unless the provider chooses to send
 * it. Keep it small, as it counts toward the token budget of every step.
 */
export interface ChatContextProvider {
    /** Short name for the context, such as 'grid' or 'dashboard'. */
    name: string;

    /** What the context is, for the model - such as 'Current state of the Positions grid.' */
    description?: string;

    /**
     * Build the context for one step - text, or an object that codecs send as JSON. May be async.
     * Return null to send nothing for the step. A provider that throws fails the turn.
     *
     * @param request - the step being sent. Its `context` is not yet set.
     */
    getContext: (request: ChatRunRequest) => Awaitable<string | PlainObject>;
}
