import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { setPending } from "./pendingInsights.js";
import { findHero } from "./heroes.js";

const INSIGHT_APP_URL = "http://localhost:6074";

let analyzed = false;

interface DraftResponse {
  radiant: string[];
  dire: string[];
  confidence: number[];
  detectedAt: string;
}

interface StateResponse {
  player: { team: string };
  hero: { name: string };
}

const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_hero_info",
      description:
        "Get detailed information about a Dota 2 hero: strengths, weaknesses, and core mechanics.",
      parameters: {
        type: "object",
        properties: {
          hero_name: {
            type: "string",
            description: "Hero name in English",
          },
        },
        required: ["hero_name"],
      },
    },
  },
];

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "get_hero_info") {
    const hero = await findHero(args.hero_name as string);
    if (!hero) return `Hero "${args.hero_name}" not found.`;
    return `${hero.displayName} (${hero.shortName}):\n${hero.notes}`;
  }
  return "Unknown tool.";
}

/**
 * Lazy check: called on every turn_done.
 * If draft is complete (10 heroes) and not yet analyzed — kicks off background analysis.
 */
export async function checkAndAnalyzeDraft(): Promise<void> {
  if (analyzed) return;

  try {
    const draftRes = await fetch(`${INSIGHT_APP_URL}/draft`);
    if (!draftRes.ok) return;

    const draft = (await draftRes.json()) as DraftResponse | null;
    if (!draft?.radiant?.length || !draft?.dire?.length) return;
    if (draft.radiant.length + draft.dire.length < 10) return;

    let state: StateResponse | null = null;
    try {
      const stateRes = await fetch(`${INSIGHT_APP_URL}/state`);
      if (stateRes.ok) {
        state = (await stateRes.json()) as StateResponse | null;
      }
    } catch {
      // state is optional
    }

    analyzed = true;
    console.log("[draftAnalysis] Draft complete, starting background analysis");

    analyzeInBackground(draft, state).catch((err) => {
      console.error("[draftAnalysis] Background analysis failed:", err);
    });
  } catch {
    // insight-app unavailable, will retry on next turn_done
  }
}

async function analyzeInBackground(
  draft: DraftResponse,
  state: StateResponse | null,
): Promise<void> {
  const playerContext = state
    ? `Игрок на стороне ${state.player.team}, герой: ${state.hero.name}.`
    : "";

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `Ты — аналитик-тренер по Dota 2. Тебе доступен инструмент get_hero_info для получения детальной информации о героях (сильные/слабые стороны, механики). Используй его чтобы изучить ключевых героев драфта, затем дай краткий анализ матчапа.`,
    },
    {
      role: "user",
      content: `Драфт завершён.
Radiant: ${draft.radiant.join(", ")}
Dire: ${draft.dire.join(", ")}
${playerContext}

Изучи героев через get_hero_info и дай краткий анализ (3-5 предложений): какие трудности ожидают игрока и на что обращать пристальное внимание в этом матче.`,
    },
  ];

  const openai = new OpenAI();

  // Tool-use loop: let the model call get_hero_info as needed
  for (;;) {
    const res = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      reasoning_effort: "medium",
      messages,
      tools,
    });

    const choice = res.choices[0];
    if (!choice) break;

    const msg = choice.message;
    messages.push(msg);

    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        const args = JSON.parse(call.function.arguments) as Record<
          string,
          unknown
        >;
        console.log(`[draftAnalysis] tool call: ${call.function.name}(${call.function.arguments})`);
        const result = await handleToolCall(call.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
      continue;
    }

    // No more tool calls — final answer
    if (msg.content) {
      console.log("[draftAnalysis] Analysis ready, queued for delivery");
      setPending(msg.content);
    }
    break;
  }
}

export function resetDraftAnalysis(): void {
  analyzed = false;
}
