import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IMPORTANCE_PATH = join(ROOT, 'TEMP', 'items-importance', 'items-importance.json');
const NOTES_PATH      = join(ROOT, 'item-notes.json');
const NOTES_BACKUP    = join(ROOT, 'item-notes.backup.json');
const TAGS_PATH       = join(ROOT, 'mecanics_list.md');
const HTML_PATH       = join(__dirname, 'index.html');
const PORT = 7071;

function toDisplayName(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

void copyFile(NOTES_PATH, NOTES_BACKUP)
  .then(() => console.log('Backup saved → item-notes.backup.json'))
  .catch(() => {});

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  try {
    if (url === '/' && method === 'GET') {
      const html = await readFile(HTML_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url === '/api/items' && method === 'GET') {
      const raw = await readFile(IMPORTANCE_PATH, 'utf-8');
      const importance = JSON.parse(raw) as Record<string, number>;
      const items = Object.entries(importance)
        .filter(([, v]) => v === 1)
        .map(([key]) => ({ key, displayName: toDisplayName(key) }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      json(res, items);
      return;
    }

    if (url === '/api/tags' && method === 'GET') {
      const raw = await readFile(TAGS_PATH, 'utf-8');
      const tags = raw
        .split('\n')
        .map(line => line.split('\t')[0].trim())
        .filter(Boolean);
      json(res, tags);
      return;
    }

    if (url === '/api/notes' && method === 'GET') {
      try {
        const raw = await readFile(NOTES_PATH, 'utf-8');
        json(res, JSON.parse(raw));
      } catch {
        json(res, {});
      }
      return;
    }

    if (url === '/api/notes' && method === 'POST') {
      const body = await readBody(req);
      const notes: unknown = JSON.parse(body);
      await writeFile(NOTES_PATH, JSON.stringify(notes, null, 2), 'utf-8');
      json(res, { ok: true });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error(err);
    json(res, { error: String(err) }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Item editor: http://localhost:${PORT}`);
});
