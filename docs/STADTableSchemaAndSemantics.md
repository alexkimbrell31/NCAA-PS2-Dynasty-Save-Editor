# STAD Table — Schema and Semantics

The stadium reference table. One record per venue, including bowl and neutral
sites.

| Property | Value |
|---|---|
| Offset | `0x0016CFD8` |
| Data offset | `0x0016D378` |
| Records | 238 used of 250 allocated |
| Record length | 156 bytes (1248 bits) |
| Fields | 56 |
| Bit coverage | 0..1228, then 19 bits of padding |

STAD is the richest reference table in the file — five string columns plus
capacity, geography, weather, temperature and surface data. It is also the most
externally verifiable: stadiums are physical objects with published facts that
the save file knows nothing about, so agreement is genuine evidence.

## It corrected the TEAM table

**`TEAM.TMAA` is average attendance, not stadium capacity.** It was previously
documented as capacity on the strength of its real-world ordering (Michigan >
Penn State > Tennessee > Ohio State). That ordering was real, but it is what
*attendance* produces too, so it never discriminated between the two readings.

`STAD.SCAP` is the actual capacity, and the two disagree on **all 119** FBS
teams:

| School | `TEAM.TMAA` | `STAD.SCAP` | Fill |
|---|---|---|---|
| Michigan | 111,263 | 107,501 | 103% |
| Alabama | 93,970 | 92,128 | 102% |
| Akron | 13,812 | 31,000 | 45% |
| Florida Atlantic | 5,882 | 20,450 | 29% |

Three independent confirmations that `SCAP` is the capacity and `TMAA` the
attendance:

1. **`SCAP` matches published 2006 capacities exactly** — Michigan 107,501,
   Beaver 107,282, Neyland 104,079, Ohio Stadium 101,568, Ben Hill Griffin
   88,548, Jordan-Hare 87,451, Camp Randall 80,321. Seven for seven.
2. **Fill rate rises monotonically with program prestige**: 1-star 50%, 2-star
   62%, 3-star 84%, 4-star 93%, 5-star 94%, 6-star 99%. Attendance depends on
   how good a team is; the size of the building does not.
3. **Fill rate stays in a physically sensible band**, 29%–104%. The 24 teams
   above 100% are the traditional powers, where standing room exceeds listed
   capacity — exactly the real-world pattern.

The earlier note that "Florida Atlantic's 5,882 is a real capacity" was wrong in
detail: 5,882 was their *attendance*; Lockhart Stadium held about 20,450.

## The join key

Three fields have 238 distinct values across 238 rows — `SGID`, `SORD` and
`SRES` — so counting distinct values cannot identify the key. Joining and then
comparing school names settles it immediately:

| Join on | School names that agree |
|---|---|
| **`SGID`** | **119 / 119** |
| `SORD` | 3 / 117 |
| `SRES` | 2 / 117 |

`TEAM.SGID` → `STAD.SGID`. `SORD` and `SRES` are two different alphabetical
orderings of the same 238 rows (they agree with each other on only 4 rows) and
are presumably UI sort orders.

## Field map

### Identity and location

| Field | Bits | Meaning |
|---|---|---|
| `SGID` | 8 | Stadium id — primary key, joined from `TEAM.SGID` |
| `TDNA` | 176 | School the stadium belongs to |
| `SNAM` | 240 | Stadium name (211 distinct; "Memorial Stadium" appears 6 times) |
| `STNN` | 144 | Nickname — only 22 stadiums have one |
| `SCIT` | 168 | City |
| `SSTA` | 120 | Two-letter state code (47 states) |
| `STID` | 8 | State id — a clean bijection with `SSTA` |
| `SCAP` | 17 | Capacity |
| `SMLX` | 9 | Map x-coordinate |
| `SMLY` | 9 | Map y-coordinate |
| `SORD` | 8 | Sort order |
| `SRES` | 8 | Alternate sort order |
| `STDR` | 8 | Detail/asset index; 127 = none |

The nicknames are a nice sanity check on the string decoding, since they are
unmistakable: Death Valley (Clemson *and* LSU), The Big House (Michigan), The
Horseshoe (Ohio State), The Swamp (Florida), Between the Hedges (Georgia), The
12th Man (Texas A&M), Happy Valley (Penn State), The Farm (Stanford).

### Map coordinates

`SMLX`/`SMLY` place each stadium on a US map: x rises west → east (west coast
mean 153, north east mean 455) and y rises north → south (northern mean 68,
southern mean 222). Stadiums in the same state cluster within ~23 units against
a full range of 352. Hawaii sits at (217, 282) rather than far west, which is
how US maps conventionally draw it — in an inset box.

### Roof and surface

| Field | Meaning |
|---|---|
| `STYP` | −1 = indoor, 0 = outdoor |

`STYP` is a **1-bit signed** field, so the set value reads as −1 rather than 1.
All 16 rows carrying it are genuine domes — Carrier Dome, Louisiana Superdome,
UNI Dome, Walkup Skydome, Kibbie Dome, Holt Arena, Georgia Dome, Reliant
Stadium, Alamodome, Ford Field, Metrodome — and 15 of the 16 have every weather
probability pinned to zero. (The exception is an EA "Practice Field" test
asset.) All 222 outdoor stadiums have non-zero weather.

`SFTY` is the playing surface. **0 is natural grass** and **4 is artificial
turf**, each confirmed against every canonical stadium tested. Codes 1, 2, 3 and
5 also occur and are *not* resolved — the Rose Bowl is real natural grass but
reads 1, so these are probably visual/field-art variants rather than a clean
grass-versus-turf split. No dome has `SFTY=0`, which is correct: you cannot grow
grass indoors.

| `SFTY` | Rows |
|---|---|
| 0 (grass) | 98 |
| 1 | 36 |
| 2 | 13 |
| 3 | 2 |
| 4 (turf) | 83 |
| 5 | 6 |

### Weather and temperature

| Field | Range | Meaning |
|---|---|---|
| `SWSP` | 0–30 | Snow chance, % |
| `SWRP` | 0–25 | Rain chance, % |
| `SWWP` | 0–34 | Wind chance, % |
| `SWFP` | 0–85 | **Unidentified** — previously guessed as fog chance, see below |
| `STts` | 65–99 | High temperature, °F |
| `STjt` | 0–80 | Low temperature, °F — confirmed by the dome test below |

Weather tracks real geography, which the save file has no way to fake:

- Mean snow chance is **8.3% in northern states versus 0.9% in the south**.
- The snowiest venues are in Amherst MA, Boston, Kingston RI, Durham NH, Denver,
  Orono ME, Missoula MT and Bozeman MT — all genuinely snowy places.
- **The rainiest stadium in the file is Autzen Stadium, Eugene, Oregon** at 25%,
  which is the correct answer for college football.

Temperature likewise: the hottest venues are Tempe AZ (99°F), Phoenix (98) and
Las Vegas (94); the coldest are Missoula and Bozeman MT (65). `STts ≥ STjt` on
all 238 rows, consistent with a high/low pair. Note that domes carry neutral
mid-range temperatures regardless of city, which is why New Orleans and Atlanta
appear in the "coldest" list.

### `STjt` — confirmed by the dome test

The high/low reading was re-tested against the one group where a temperature
*range* must behave differently: indoor stadiums. If `STts`/`STjt` really are a
high/low pair, domes must show a near-zero gap because they are climate
controlled, while outdoor venues must show a large one. That is exactly what
appears:

| Venues | Mean `STts` | Mean `STjt` | Gap |
|---|---|---|---|
| Indoor (`STYP = −1`) | 70°F | 69°F | **1.2°** |
| Outdoor | 81°F | 35°F | **46.5°** |

This is a genuinely discriminating result — no alternative reading of the pair
produces a 1.2° spread indoors and a 46.5° spread outdoors. Overall correlation
between the two fields is 0.519 with a mean gap of 43.4°.

The 46.5° outdoor spread is far too wide for a single day's high and low, so the
pair most likely describes the **seasonal** range across a season that runs from
early September into December, rather than a daily one. That also explains the
0–80 range flagged as an open question previously.

### `SWFP` — label withdrawn

"Fog chance" was a guess from the mnemonic on only **4 non-zero rows**, and the
data contradicts it:

| Stadium | City | `SWFP` |
|---|---|---|
| Autzen Stadium | Eugene, OR | 60 |
| Dolphin Stadium | Miami, FL | 85 |
| Miami Stadium | Miami, FL | 85 |
| INVESCO Field | Denver, CO | 45 |

**Miami at 85% does not fit fog** — Miami is not a foggy city, and an 85% figure
would be extraordinary anywhere. Eugene and Denver are plausible but Miami is
not, so the label is withdrawn and the field is recorded as unidentified. Four
data points and a mnemonic are not enough to name a field.

### `STDR`

Exactly the **119 FBS home stadiums** have `STDR < 127`; the other 119 rows all
sit at the 127 sentinel. So the field marks "this venue has dedicated detail
assets", which only the FBS home grounds got. The non-sentinel values are *not*
team ids — read as a `TGID` they match the school name only 2/119 times — so
whatever they index is unidentified.

## Venue population

| Kind | Count |
|---|---|
| FBS home grounds | 119 |
| FCS home grounds | 79 |
| Neutral / bowl sites | 40 |

The 40 neutral sites are the bowl venues and NFL stadiums: Rose Bowl, Cotton
Bowl, Alamodome, Georgia Dome, Ford Field, Sun Bowl, Liberty Bowl, Superdome,
and so on. Several appear more than once (ALLTEL Stadium 3×, Superdome 3×) —
the same physical building hosting multiple bowl games gets one row per bowl.
Two rows are EA's own test assets in Maitland, Florida (their studio location):
"Practice Field" and "Practice Drill Field", both capacity 0. There is also an
"EA SPORTS Stadium" in Redwood City.

Some names carry trailing digits (`Georgia Dome1`, `Sun Devil0 Stadium`,
`ALLTEL Stadium0`), an artifact of EA's asset naming rather than a decode error.

## Open questions

- `SFTY` codes 1, 2, 3 and 5.
- What `STDR` indexes.
- What `SWFP` actually means (the fog reading is withdrawn — see above).
- `STwp` and `STfw` are near-duplicates (equal on 205/238 rows, correlation
  0.839); both span roughly 0–35 and neither tracks capacity or climate.
- 8 single-bit flags (`STCA`, `MPTH`, `SORI`, `SUTf`, `SIOT`, `STHS`, `SGPT`,
  `SBST`) are set on varying subsets and none aligns with domes, capacity or
  conference. They are most likely art/presentation switches.
- 12 fields are entirely constant (`STfc`, `STlc`, `STll`, `stcr`, `STrr`,
  `STFA`, `SFBB`, `SCRE`, `SFbb`, `STxt` and others), and several 16-bit fields
  (`Stlc`, `STrf`, `STri`, `STcl`, `STRr`, `STlr`) hold a handful of very large
  values that look like packed colours.

## Validation

`src/validateStadiumTable.ts` asserts 26 properties, all passing: bit tiling,
`SGID` as primary key, string completeness, the FBS join and its school-name
agreement, capacity plausibility, exact agreement with seven published 2006
capacities, Michigan Stadium as the largest, the `TMAA`/`SCAP` distinction,
attendance bounded by capacity, state codes, the `STID`↔`SSTA` bijection, map
coordinate orientation on both axes, dome identification, domes having no
weather, no dome having grass, snow following latitude, the rainiest stadium
being in the Pacific Northwest, weather values as percentages, temperature
tracking climate, the high/low relationship, both confirmed surface codes, the
`STDR` sentinel matching the FBS set, and the existence of neutral bowl sites.
