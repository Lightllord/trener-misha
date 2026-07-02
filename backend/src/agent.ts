import { RealtimeAgent } from "@openai/agents/realtime";
import { AGENT_INSTRUCTIONS } from "./consts/agentInstructions.js";
import {
  heroesTool,
  heroAbilitiesTool,
  correctDraftTool,
  setPlayerPositionTool,
  matchStateTool,
  matchupsTool,
  buildsTool,
  skillBuildTool,
  itemAdviceTool,
  buildPlanTool,
  getBuildPlanTool,
  editBuildPlanTool,
  guidesTool,
} from "./tools/index.js";

export const agent = new RealtimeAgent({
  name: "Тренер Миша",
  voice: "verse",
  instructions: AGENT_INSTRUCTIONS,
  tools: [
    heroesTool,
    heroAbilitiesTool,
    matchStateTool,
    correctDraftTool,
    setPlayerPositionTool,
    matchupsTool,
    buildsTool,
    skillBuildTool,
    itemAdviceTool,
    buildPlanTool,
    getBuildPlanTool,
    editBuildPlanTool,
    guidesTool,
  ],
});
