import { RealtimeAgent } from "@openai/agents/realtime";
import { AGENT_INSTRUCTIONS } from "./consts/agentInstructions.js";
import {
  heroesTool,
  correctDraftTool,
  matchStateTool,
  matchupsTool,
  buildsTool,
  itemAdviceTool,
  guidesTool,
} from "./tools/index.js";

export const agent = new RealtimeAgent({
  name: "Тренер Миша",
  voice: "verse",
  instructions: AGENT_INSTRUCTIONS,
  tools: [
    heroesTool,
    matchStateTool,
    correctDraftTool,
    matchupsTool,
    buildsTool,
    itemAdviceTool,
    guidesTool,
  ],
});
