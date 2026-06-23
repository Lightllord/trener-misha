import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITEMS_JSON = join(__dirname, '../../backend/data/stratz/items.json');
const OUT_FILE = join(__dirname, '../../backend/data/items-enriched.json');
const OPENDOTA_URL = 'https://api.opendota.com/api/constants/items';

function formatDisplay(display, value) {
  return display.replace('{value}', value);
}

function extractBonuses(attrib) {
  return attrib
    .filter(a => a.display)
    .map(a => ({ key: a.key, display: formatDisplay(a.display, a.value), value: a.value }));
}

function extractAbilities(abilities, cd, mc) {
  if (!abilities || abilities.length === 0) return undefined;

  let activeSeen = false;
  return abilities.map(a => {
    const ability = { type: a.type, title: a.title, description: a.description };
    if (a.type === 'active' && !activeSeen) {
      activeSeen = true;
      if (cd !== false && cd != null) ability.cooldown = cd;
      if (mc !== false && mc != null) ability.manaCost = mc;
    }
    return ability;
  });
}

async function main() {
  console.log('Fetching OpenDota item constants...');
  const res = await fetch(OPENDOTA_URL, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenDota API returned HTTP ${res.status}`);
  const odItems = await res.json();

  // Build id → OpenDota item map
  const byId = new Map();
  for (const item of Object.values(odItems)) {
    if (item.id != null) byId.set(item.id, item);
  }
  console.log(`Loaded ${byId.size} items from OpenDota.`);

  const stratzItems = JSON.parse(await readFile(ITEMS_JSON, 'utf8'));

  let found = 0, missing = 0;
  const results = stratzItems.map(({ id, displayName }) => {
    const od = byId.get(id);
    if (!od) {
      missing++;
      return { id, displayName, notFound: true };
    }
    found++;
    const bonuses = extractBonuses(od.attrib ?? []);
    const abilities = extractAbilities(od.abilities, od.cd, od.mc);
    const result = { id, displayName, cost: od.cost };
    if (bonuses.length > 0) result.bonuses = bonuses;
    if (abilities) result.abilities = abilities;
    if (od.hint?.length > 0) result.hint = od.hint;
    if (od.notes) result.notes = od.notes;
    return result;
  });

  await writeFile(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Done: ${found} enriched, ${missing} not found → ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
