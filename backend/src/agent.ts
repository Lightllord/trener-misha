import { RealtimeAgent } from "@openai/agents/realtime";
import { AGENT_INSTRUCTIONS } from "./consts/agentInstructions.js";
import {
  heroInfoTool,
  heroAbilitiesTool,
  heroListTool,
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
} from "./tools/index.js";

export const agent = new RealtimeAgent({
  name: "Тренер Миша",
  voice: "verse",
  instructions: AGENT_INSTRUCTIONS,
  tools: [
    heroInfoTool,
    heroAbilitiesTool,
    heroListTool,
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
  ],
});
