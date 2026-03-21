import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = 6074;

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST") {
    try {
      const raw = await parseBody(req);
      const data: unknown = JSON.parse(raw);
      console.log("[GSI]", JSON.stringify(data, null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } catch (err) {
      console.error("[ERROR] Failed to parse body:", err);
      res.writeHead(400);
      res.end("Bad Request");
    }
    return;
  }

  res.writeHead(200);
  res.end("insight-app is running");
});

server.listen(PORT, () => {
  console.log(`[insight-app] GSI listener on http://localhost:${PORT}`);
});
