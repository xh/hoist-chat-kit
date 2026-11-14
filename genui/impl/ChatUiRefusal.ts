/**
 * An error whose message says, in plain words for the user, why content cannot show. The
 * catalog shows the message as the caption of the fallback, in place of its general line. Throw
 * one only for a reason that the user can act on or pass on, such as a limit that the content is
 * past.
 * @internal
 */
export class ChatUiRefusal extends Error {}
