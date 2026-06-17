import type { MapZone } from "./types/heroPosition.js"

interface ZoneRect {
  zone: MapZone
  minX: number
  maxX: number
  minY: number
  maxY: number
}

// Зоны проверяются в порядке объявления — более специфичные первыми.
// Координаты — сырые игровые единицы из GSI (примерные, требуют калибровки).
const ZONES: ZoneRect[] = [
  { zone: "radiant_base", minX: -9600, maxX: -3540, minY: -9314, maxY: -3131 },
  { zone: "roshpit_bot", minX: 2447, maxX: 3481, minY: -3131, maxY: -2248 },
  { zone: "roshpit_top", minX: -3688, maxX: -2653, minY: 2020, maxY: 2903 },
  { zone: "twingates_bot", minX: 5699, maxX: 7325, minY: -8283, maxY: -6664 },
  { zone: "twingates_top", minX: -7235, maxX: -5535, minY: 7025, maxY: 8423 },
  { zone: "tormentor_bot", minX: 7103, maxX: 8581, minY: -7032, maxY: -5560 },
  { zone: "tormentor_top", minX: -8344, maxX: -6940, minY: 5847, maxY: 7393 },
  { zone: "dire_safe_jungle_deep", minX: -1470, maxX: 3038, minY: 6731, maxY: 8497 },
  { zone: "dire_safe_jungle", minX: -5314, maxX: -1470, minY: 6731, maxY: 8570 },
  { zone: "dire_main_jungle", minX: -3244, maxX: -362, minY: 3492, maxY: 5479 },
  { zone: "dire_main_jungle_danger", minX: -5535, maxX: -3244, minY: 3492, maxY: 5479 },
  { zone: "dire_top_t2_zone", minX: -1397, maxX: 1190, minY: 5406, maxY: 6657 },
  { zone: "dire_top_t1_zone", minX: -6348, maxX: -4427, minY: 5479, maxY: 6951 },
  { zone: "dire_top_t1-t2", minX: -4501, maxX: -1470, minY: 5553, maxY: 6731 },
  { zone: "dire_top_t2-t3", minX: 1190, maxX: 3038, minY: 5406, maxY: 6731 },
  { zone: "dire_main_jungle_mid", minX: -288, maxX: 1338, minY: 2462, maxY: 5332 },
  { zone: "dire_base", minX: 3112, maxX: 8655, minY: 4523, maxY: 8570 },
  { zone: "dire_base", minX: 4960, maxX: 8655, minY: 2683, maxY: 4670 },
  { zone: "dire_mid_t2_zone", minX: 1486, maxX: 3629, minY: 1358, maxY: 3345 },
  { zone: "dire_mid_t1_zone", minX: -288, maxX: 1412, minY: -40, maxY: 1358 },
  { zone: "dire_triangle", minX: 2225, maxX: 5329, minY: -1439, maxY: 1358 },
  { zone: "dire_mid_bot_prebase", minX: 3703, maxX: 5403, minY: 1505, maxY: 2609 },
  { zone: "dire_main_jungle_mid", minX: 1338, maxX: 3038, minY: 3419, maxY: 5259 },
  { zone: "dire_base", minX: 3703, maxX: 4886, minY: 2756, maxY: 4670 },
  { zone: "dire_base", minX: 3038, maxX: 3629, minY: 3419, maxY: 4596 },
  { zone: "dire_bot_t2_zone", minX: 5403, maxX: 7177, minY: -188, maxY: 2609 },
  { zone: "dire_small_jungle", minX: 7251, maxX: 8655, minY: -556, maxY: 2683 },
  { zone: "dire_wisdom", minX: 7251, maxX: 8655, minY: -1807, maxY: -556 },
  { zone: "dire_bot_t1-t2", minX: 5477, maxX: 7251, minY: -1292, maxY: -188 },
  { zone: "dire_bot_t1_zone", minX: 5403, maxX: 7251, minY: -3131, maxY: -1292 },
  { zone: "dire_bot_t1_zone", minX: 7325, maxX: 8655, minY: -3279, maxY: -1807 },
  { zone: "bot_lotus_pull", minX: 7029, maxX: 8655, minY: -5487, maxY: -3352 },
  { zone: "bot_laning_zone", minX: 5403, maxX: 6955, minY: -5339, maxY: -3131 },
  { zone: "radiant_bot_t1_zone", minX: 3851, maxX: 6955, minY: -6517, maxY: -5413 },
  { zone: "radiant_bot_t1_zone", minX: 3851, maxX: 5625, minY: -7326, maxY: -6443 },
  { zone: "twingates_bot", minX: 7399, maxX: 8655, minY: -9387, maxY: -7106 },
  { zone: "twingates_bot", minX: 5699, maxX: 7325, minY: -9387, maxY: -8210 },
  { zone: "radiant_safe_jungle", minX: 1560, maxX: 5625, minY: -9387, maxY: -7400 },
  { zone: "radiant_safe_jungle_deep", minX: -3540, maxX: 1412, minY: -9314, maxY: -7400 },
  { zone: "radiant_bot_t1-t2", minX: 1042, maxX: 3777, minY: -7253, maxY: -5707 },
  { zone: "radiant_bot_t2_zone", minX: -1544, maxX: 895, minY: -7253, maxY: -5707 },
  { zone: "radiant_bot_prebase_zone", minX: -3466, maxX: -1618, minY: -7326, maxY: -5707 },
  { zone: "radiant_main_jungle", minX: -510, maxX: 2447, minY: -5634, maxY: -3647 },
  { zone: "radiant_main_jungle", minX: 2521, maxX: 3408, minY: -5560, maxY: -4235 },
  { zone: "radiant_main_jungle_danger", minX: 3555, maxX: 5329, minY: -5192, maxY: -3647 },
  { zone: "radiant_main_jungle", minX: 3408, maxX: 3777, minY: -5560, maxY: -5266 },
  { zone: "radiant_main_jungle_mid", minX: -1988, maxX: -657, minY: -5634, maxY: -2616 },
  { zone: "radiant_main_jungle_mid", minX: -2727, maxX: -2062, minY: -5560, maxY: -3794 },
  { zone: "radiant_mid_t2_zone", minX: -4279, maxX: -2136, minY: -3573, maxY: -1880 },
  { zone: "radiant_mid_t1_zone", minX: -2210, maxX: -731, minY: -1954, maxY: -482 },
  { zone: "top_active_rune", minX: -2579, maxX: -1027, minY: 475, maxY: 1800 },
  { zone: "bot_active_rune", minX: 82, maxX: 1929, minY: -1880, maxY: -335 },
  { zone: "dire_secret_shop", minX: 4073, maxX: 5329, minY: -2175, maxY: -1439 },
  { zone: "bot_pre_rosh", minX: 3555, maxX: 5329, minY: -3573, maxY: -2248 },
  { zone: "bot_pre_rosh", minX: 2521, maxX: 3481, minY: -4162, maxY: -3205 },
  { zone: "bot_pre_rosh", minX: 2373, maxX: 3999, minY: -2175, maxY: -1512 },
  { zone: "radiant_main_jungle", minX: -510, maxX: 2299, minY: -3647, maxY: -1954 },
  { zone: "dire_mid_t1_zone", minX: 1412, maxX: 2151, minY: -188, maxY: 1284 },
  { zone: "dire_mid_t1_zone", minX: -362, maxX: 1338, minY: 1358, maxY: 2388 },
  { zone: "mid_reaver", minX: -584, maxX: 8, minY: -850, maxY: -40 },
  { zone: "mid_reaver", minX: -1397, maxX: -657, minY: -261, maxY: 401 },
  { zone: "dire_mid_t1_zone", minX: -584, maxX: -362, minY: 107, maxY: 1211 },
  { zone: "top_pre_rosh", minX: -4279, maxX: -2062, minY: 2977, maxY: 3492 },
  { zone: "top_pre_rosh", minX: -2579, maxX: -2062, minY: 1873, maxY: 2977 },
  { zone: "top_pre_rosh", minX: -3614, maxX: -2727, minY: 1137, maxY: 1947 },
  { zone: "top_pre_rosh", minX: -4427, maxX: -3762, minY: 1873, maxY: 2903 },
  { zone: "top_lotus_pull", minX: -9600, maxX: -6940, minY: 3566, maxY: 5700 },
  { zone: "top_tormentor", minX: -9600, maxX: -8418, minY: 5847, maxY: 8497 },
  { zone: "radiant_small_jungle", minX: -9600, maxX: -7309, minY: -2984, maxY: 180 },
  { zone: "radiant_wisdom", minX: -9600, maxX: -7235, minY: 328, maxY: 2020 },
  { zone: "radiant_top_t1_zone", minX: -9600, maxX: -5535, minY: 2168, maxY: 3345 },
  { zone: "radiant_top_t1_zone", minX: -7161, maxX: -5609, minY: 769, maxY: 2168 },
  { zone: "radiant_top_t2_zone", minX: -7235, maxX: -5609, minY: -1660, maxY: 696 },
  { zone: "radiant_top_prebase", minX: -7235, maxX: -5166, minY: -3058, maxY: -1733 },
  { zone: "radiant_top-mid_prebase", minX: -5092, maxX: -4427, minY: -3058, maxY: -2175 },
  { zone: "radiant_top-mid_prebase", minX: -3466, maxX: -2801, minY: -5634, maxY: -3647 },
  { zone: "radiant_triangle", minX: -5609, maxX: -3096, minY: -1586, maxY: 843 },
  { zone: "radiant_triangle", minX: -5092, maxX: -4353, minY: -2028, maxY: -1586 },
  { zone: "radiant_mid_t1_zone", minX: -3023, maxX: -2283, minY: -1365, maxY: 475 },
  { zone: "radiant_mid_t1_zone", minX: -657, maxX: 8, minY: -1807, maxY: -924 },
  { zone: "radiant_mid_t1_zone", minX: -2210, maxX: -1470, minY: -482, maxY: 475 },
  { zone: "radiant_secret_shop", minX: -5609, maxX: -4501, minY: 916, maxY: 2315 },
  { zone: "top_laning", minX: -6866, maxX: -5609, minY: 3492, maxY: 5479 },
  { zone: "dire_top_t1_zone", minX: -6940, maxX: -6422, minY: 5627, maxY: 7025 },
  { zone: "dire_main_jungle", minX: -1988, maxX: -362, minY: 2903, maxY: 3566 },
  { zone: "top_pre_rosh", minX: -5535, maxX: -4427, minY: 2315, maxY: 3419 },
  { zone: "top_twingates", minX: -8344, maxX: -7235, minY: 7540, maxY: 8497 },
]

function distToRect(x: number, y: number, rect: ZoneRect): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX)
  const dy = Math.max(rect.minY - y, 0, y - rect.maxY)
  return dx * dx + dy * dy  // squared — достаточно для сравнения
}

export function getZone(x: number, y: number): MapZone {
  if (ZONES.length === 0) return "unknown"

  let best = ZONES[0]
  let bestDist = Infinity

  for (const rect of ZONES) {
    const d = distToRect(x, y, rect)
    if (d === 0) return rect.zone  // точное попадание
    if (d < bestDist) { bestDist = d; best = rect }
  }

  return best.zone
}
