import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HEROES_PATH      = join(ROOT, 'heroes_extend.json');
const NOTES_PATH       = join(ROOT, 'hero-notes.json');
const NOTES_BACKUP     = join(ROOT, 'hero-notes.backup.json');
const TAGS_PATH        = join(ROOT, 'mecanics_list.md');
const HTML_PATH        = join(__dirname, 'index.html');
const PORT = 7070;

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
  .then(() => console.log('Backup saved → hero-notes.backup.json'))
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

    if (url === '/api/heroes' && method === 'GET') {
      const raw = await readFile(HEROES_PATH, 'utf-8');
      const heroes: { id: number; displayName: string; shortName: string }[] =
        (JSON.parse(raw) as { id: number; displayName: string; shortName: string }[])
          .map(({ id, displayName, shortName }) => ({ id, displayName, shortName }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
      json(res, heroes);
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
  console.log(`Hero editor: http://localhost:${PORT}`);
});
