import { RealtimeAgent } from "@openai/agents/realtime";
import { AGENT_INSTRUCTIONS } from "./consts/agentInstructions.js";
import {
  heroInfoTool,
  heroListTool,
  correctDraftTool,
  matchStateTool,
  matchupsTool,
  buildsTool,
  itemAdviceTool,
} from "./tools/index.js";

export const agent = new RealtimeAgent({
  name: "Тренер Миша",
  voice: "verse",
  instructions: AGENT_INSTRUCTIONS,
  tools: [
    heroInfoTool,
    heroListTool,
    matchStateTool,
    correctDraftTool,
    matchupsTool,
    buildsTool,
    itemAdviceTool,
  ],
});
