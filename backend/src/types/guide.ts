export interface GuideEntry {
  /** Stable slug used to fetch the entry via the guides tool's get command. */
  id: string;
  /** Short human title (Пункт). */
  name: string;
  /** Contextual summary the agent matches a player's question against (Описание для выбора). */
  description: string;
  /** Ready-to-speak text the agent voices roughly verbatim (Текст озвучки). */
  voiceText: string;
  /** Optional extra algorithm for the agent — not voiced (Комментарий для агента). */
  agentComment: string | null;
}

export type GuideData = readonly GuideEntry[];
