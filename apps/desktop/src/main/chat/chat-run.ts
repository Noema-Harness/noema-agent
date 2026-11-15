/**
 * In-flight chat run owned by SocialChatService. Its shape is still defined by
 * untyped JavaScript; give it a precise type when that service is converted
 * to TypeScript (D-028). Until then this alias marks every dependent site.
 */
export type ChatRun = Record<string, any>;
