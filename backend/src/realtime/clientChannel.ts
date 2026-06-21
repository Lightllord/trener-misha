import { WebSocket } from "ws";
import type { ClientInboundMessage, ControlMessage } from "./types/protocol.js";

// Transport to the browser over the raw `ws` socket. Outgoing: JSON control
// frames + binary PCM16 audio. Incoming: binary audio frames vs JSON control,
// split apart so callers don't deal with framing.
export class ClientChannel {
  constructor(private readonly ws: WebSocket) {}

  send(msg: ControlMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendAudio(data: ArrayBuffer): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(Buffer.from(data));
    }
  }

  onAudioFrame(cb: (frame: ArrayBuffer) => void): void {
    this.ws.on("message", (data, isBinary) => {
      if (!isBinary || !Buffer.isBuffer(data)) return;
      cb(
        data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer,
      );
    });
  }

  onControl(cb: (msg: ClientInboundMessage) => void): void {
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null) return;
      if ((parsed as { type?: unknown }).type === "mic_close") {
        cb({ type: "mic_close" });
      }
    });
  }

  onClose(cb: () => void): void {
    this.ws.on("close", cb);
  }

  onError(cb: (err: Error) => void): void {
    this.ws.on("error", cb);
  }
}
