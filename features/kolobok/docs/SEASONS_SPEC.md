# SEASONS_SPEC.md — seasons and holiday moments (Phase 10)

The island follows the calendar. Seasons re-tint and re-populate existing
systems (cheap); holidays add a few toggled props (charming). All date
logic in `src/config/seasons.js`; hemisphere configurable
(`hemisphere: 'north' | 'south'`, default north — south shifts seasons 6
months). Dev override `seasons.force` required.

## 1. Seasons (applied at scene mount; no runtime lerp needed)

| | spring (Mar–May) | summer (Jun–Aug) | autumn (Sep–Nov) | winter (Dec–Feb) |
|---|---|---|---|---|
| birch canopy | `#a8d078` | `#9fc46a` (base) | `#d9a441` with 30% of canopy spheres `#c0452e` | bare: canopies hidden, add 6 thin branch cones `#8a7862` per tree |
| grass/ground tint | +8% lightness, hue toward fresh green | base | mix 25% toward `#b3914f` | mix 35% toward `#e8ecf0`; grass tufts hidden |
| flowers | ×1.5 count | base | ×0.4, colors `#d9a441`/`#c0452e` | hidden |
| falling leaves | off | bear arc only (base) | island-wide, 5 concurrent, birch-gold colors | off (snow does the falling) |
| butterflies | base | ×1.5 | ×0.5 | off (a single `#8a94a2` winter bird hops near the izba instead) |
| snow caps | weather-driven | weather-driven | weather-driven | ALWAYS on |
| pond | base | base + more ambient splashes | base, 2 floating gold leaves | ICE: disc `#cfe4ee`, roughness 0.15, opacity 0.9 over darker water; ripples off; Grandpa gets an ice-hole (dark circle r=0.09 beside the stump) and fishes through it — same catches |
| Kolobok on the pond arc | — | — | — | crossing the ice arc (±20° of the pond angle): FOLLOW_LAG × 0.5 and +30% overshoot on stops — he slides, with a little arms-out wobble (body tilt ±7°, 2 Hz, while on ice) |
| mist bias | morning ×1.3 | base | morning ×1.5 | ×0.7 (crisp air) |

Weather still stacks on top (live snow in October just works).

## 2. Holidays (`config/holidays.js` — editable date ranges)

Props are pre-built, hidden, toggled by date; all reuse existing builders.

- **New Year / Новый год** (Dec 20 – Jan 10):
  - Izba garland: 12 mini spheres r=0.03 strung under the roof edge,
    emissive cycling `#c0452e`→`#e8c04a`→`#6fa8c8` (each sphere phase-offset,
    2 s cycle, intensity 0.9 at night / 0.4 by day).
  - The spruce nearest the izba becomes THE tree: 8 colored balls
    (spheres r=0.045, same palette) + a `#ffd27a` emissive star (two
    crossed flattened cones) on top.
  - Kolobok wears a tiny Santa hat (cone `#c0452e` + brim torus + pompom
    sphere `#efeeea`) mounted on the face group (never spins).
  - Narration variant: `story.rebirth.ny` — EN "…and baked another. Happy
    New Year!" / RU «…и испекла нового. С Новым годом!» (add to STRINGS.md).
- **Maslenitsa / Масленица** (config range, default Feb 24 – Mar 2; movable
  feast — the range is a config value the host updates yearly):
  - Grandma's window shows a pancake stack (5 squashed cylinders
    `#e8b84a`, slightly irregular scales) on the sill; chimney smoke ×1.5.
  - Grandpa's tap line becomes `egg.fish.maslenitsa`: EN "Fish today,
    pancakes tonight!" / RU «Рыбка к блинам — самое то!».
- **User's local spring day** (optional, Mar 1): butterflies ×2 for the
  day. Trivial, skippable.

## 3. Acceptance
- Forcing each season shows every row of the §1 table; winter ice changes
  Kolobok's handling on the pond arc and Grandpa fishes through the hole.
- Forcing each holiday toggles exactly its props and strings, in both
  locales; outside the ranges nothing holiday-related renders.
- Season + weather + time-of-day compose without conflicts (winter night
  snowstorm with NY garland glowing = the money screenshot).
- Added props stay within +5k tris total; all hidden props cost no draw
  calls when off (visible=false at the group level).
