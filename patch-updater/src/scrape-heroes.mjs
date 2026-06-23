import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, '../../backend/data/heroes-stats.json');
const OPENDOTA_URL = 'https://api.opendota.com/api/constants/heroes';

async function main() {
  console.log('Fetching OpenDota hero constants...');
  const res = await fetch(OPENDOTA_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenDota API returned HTTP ${res.status}`);

  const raw = await res.json();
  const heroes = Object.values(raw);
  console.log(`Received ${heroes.length} heroes.`);

  const results = heroes
    .sort((a, b) => a.id - b.id)
    .map((h) => ({
      id: h.id,
      name: h.localized_name,
      primary_attr: h.primary_attr,
      attack_type: h.attack_type,
      base_attack_min: h.base_attack_min,
      base_attack_max: h.base_attack_max,
      base_str: h.base_str,
      str_gain: h.str_gain,
      base_agi: h.base_agi,
      agi_gain: h.agi_gain,
      base_int: h.base_int,
      int_gain: h.int_gain,
      base_health: h.base_health,
      base_mana: h.base_mana,
      base_armor: h.base_armor,
      move_speed: h.move_speed,
      attack_range: h.attack_range,
    }));

  await writeFile(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Done: ${results.length} heroes → ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
