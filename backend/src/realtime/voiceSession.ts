import type { WebSocket } from "ws";
import { PICKER_CONTEXT_WINDOW_MS } from "../conversation/consts/log.js";
import { clearConversation, getRecentConversation } from "../conversation/log.js";
import { log, logError } from "../observability/log.js";
import { ClientChannel } from "./clientChannel.js";
import { createRealtimeSession } from "./createSession.js";
import { InsightDelivery } from "./insightDelivery.js";
import { SessionConductor } from "./sessionConductor.js";
import { SessionEventBridge } from "./sessionBridge.js";
import { TurnController } from "./turnController.js";

// Orchestrates one browser connection: composes the layers, connects to OpenAI,
// wires the relay, and owns teardown. Transport-dependent layers are built after
// connect; dispose is idempotent (fires from close, error, or a failed connect).
export class VoiceSession {
  private readonly session = createRealtimeSession();
  private readonly channel: ClientChannel;
  private readonly bridge: SessionEventBridge;
  private readonly pickerAbort = new AbortController();
  private conductor: SessionConductor | null = null;
  private turn: TurnController | null = null;
  private disposed = false;

  constructor(ws: WebSocket) {
    this.channel = new ClientChannel(ws);
    this.bridge = new SessionEventBridge(this.session, this.channel);
  }

  async start(): Promise<void> {
    log("ws", "client connected");
    this.bridge.start();
    this.channel.onClose(() => {
      log("ws", "client disconnected");
      this.dispose();
    });
    this.channel.onError((err) => {
      logError("ws", "WebSocket error:", err);
      this.dispose();
    });

    try {
      await this.session.connect({ apiKey: process.env.OPENAI_API_KEY! });
    } catch (err) {
      logError("ws", "failed to connect to OpenAI:", err);
      this.dispose();
      return;
    }
    if (this.disposed) return;

    const conductor = new SessionConductor(this.session, () =>
      this.channel.send({ type: "interrupt" }),
    );
    this.conductor = conductor;
    this.turn = new TurnController(this.session, conductor);
    const insights = new InsightDelivery(
      conductor,
      this.pickerAbort.signal,
      () => getRecentConversation(PICKER_CONTEXT_WINDOW_MS),
    );

    this.channel.onAudioFrame((frame) => this.session.sendAudio(frame));
    this.channel.onControl((msg) => {
      if (msg.type === "mic_close") this.turn?.endUserTurn();
    });

    insights.start();
    log("ws", "session connected to OpenAI");
  }

  // Game/match state (gameData, gameEventQueue, insights, draft analysis) is
  // deliberately left alone here — it lives for as long as the match does,
  // not for as long as this WS connection does, so a reconnect after a brief
  // drop resumes the same match instead of losing position/build/draft
  // progress. It's reset in ingestApp.ts when a push reports a new matchId.
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pickerAbort.abort();
    this.conductor?.dispose();
    this.turn?.dispose();
    clearConversation();
    this.session.close();
  }
}
