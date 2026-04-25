export type ConversationRole = "user" | "assistant";

export interface ConversationEntry {
  role: ConversationRole;
  text: string;
  at: number;
}
