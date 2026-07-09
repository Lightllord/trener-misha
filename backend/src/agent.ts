import { RealtimeAgent } from "@openai/agents/realtime";
import { AGENT_INSTRUCTIONS } from "./consts/agentInstructions.js";
import {
  heroesTool,
  heroAbilitiesTool,
  aghanimInfoTool,
  correctDraftTool,
  setPlayerPositionTool,
  matchStateTool,
  matchupsTool,
  buildsTool,
  skillBuildTool,
  buildPlanTool,
  getBuildPlanTool,
  editBuildPlanTool,
  guidesTool,
  neutralItemsTool,
} from "./tools/index.js";

export const agent = new RealtimeAgent({
  name: "Тренер Миша",
  voice: "verse",
  instructions: AGENT_INSTRUCTIONS,
  tools: [
    heroesTool,
    heroAbilitiesTool,
    aghanimInfoTool,
    matchStateTool,
    correctDraftTool,
    setPlayerPositionTool,
    matchupsTool,
    buildsTool,
    skillBuildTool,
    buildPlanTool,
    getBuildPlanTool,
    editBuildPlanTool,
    guidesTool,
    neutralItemsTool,
  ],
});
