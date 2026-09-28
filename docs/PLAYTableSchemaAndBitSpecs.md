# PLAY Table — Schema & Bit Layout

Generated from the save file's own descriptor block. `play_schema.json` is a
build artifact of `src/dumpPlayTable.ts`; nothing here is hand-maintained.

| Property | Value |
| :--- | :--- |
| Table header | `0x000EEB78` |
| Descriptors | `0x000EEB9C` |
| Record data | `0x000EF1B8` |
| Record length | 56 bytes (447 = max bit index) |
| Records | 7,404 used / 8,470 allocated |
| Fields | 98 |
| Bits used | 0–443 (4 bits padding) |

> Supersedes an earlier revision that claimed 46-byte / 366-bit / 44-field
> records with `FSPN`/`LSPN` name **pointers**. All of that was wrong: records
> are 56 bytes with 98 fields, and names are stored inline as 6-bit characters.

---

## Field layout

All fields are unsigned (`type 3`) except `PLMG`, `PLSH`, `PRSH` (`type 2`,
signed). `PLSY` is the final descriptor, so its type is not stored and is
defaulted to unsigned.

| # | Bits | W | Field | Meaning | Confidence |
| ---: | :--- | ---: | :--- | :--- | :--- |
| 1 | 0–15 | 16 | `PGID` | **Player ID — primary key** (7404 distinct/7404) | Verified |
| 2 | 16–23 | 8 | `PWGT` | Weight, **stored as lb − 160** (160–386 lb). Offset confirmed against an in-game weight — see below | Verified |
| 3 | 24–29 | 6 | `PF10` | First name char 10 | Verified |
| 4 | 30–35 | 6 | `PL10` | Last name char 10 | Verified |
| 5 | 36–41 | 6 | `PF01` | First name char 1 | Verified |
| 6 | 42–47 | 6 | `PL01` | Last name char 1 | Verified |
| 7 | 48–53 | 6 | `PL11` | Last name char 11 | Verified |
| 8 | 54–56 | 3 | `PRG1` | Progression slot 1 | Guess |
| 9 | 57–62 | 6 | `PF02` | First name char 2 | Verified |
| 10 | 63–68 | 6 | `PL02` | Last name char 2 | Verified |
| 11 | 69–74 | 6 | `PL12` | Last name char 12 | Verified |
| 12 | 75–77 | 3 | `PRG2` | Progression slot 2 | Guess |
| 13 | 78–83 | 6 | `PF03` | First name char 3 | Verified |
| 14 | 84–89 | 6 | `PL03` | Last name char 3 | Verified |
| 15 | 90–95 | 6 | `PL13` | Last name char 13 | Verified |
| 16 | 96–101 | 6 | `PF04` | First name char 4 | Verified |
| 17 | 102–107 | 6 | `PL04` | Last name char 4 | Verified |
| 18 | 108–113 | 6 | `PF05` | First name char 5 | Verified |
| 19 | 114–119 | 6 | `PL05` | Last name char 5 | Verified |
| 20 | 120–125 | 6 | `PF06` | First name char 6 | Verified |
| 21 | 126–131 | 6 | `PL06` | Last name char 6 | Verified |
| 22 | 132–137 | 6 | `PF07` | First name char 7 | Verified |
| 23 | 138–143 | 6 | `PL07` | Last name char 7 | Verified |
| 24 | 144–149 | 6 | `PF08` | First name char 8 | Verified |
| 25 | 150–155 | 6 | `PL08` | Last name char 8 | Verified |
| 26 | 156–161 | 6 | `PF09` | First name char 9 | Verified |
| 27 | 162–167 | 6 | `PL09` | Last name char 9 | Verified |
| 28 | 168–170 | 3 | `PRGA` | Progression (awareness?) | Guess |
| 29 | 171–175 | 5 | `PTHA` | Throw Accuracy | Likely |
| 30 | 176–180 | 5 | `PSTA` | Stamina | Likely |
| 31 | 181–184 | 4 | `PLEB` | Left elbow accessory | Likely |
| 32 | 185–188 | 4 | `PREB` | Right elbow accessory | Likely |
| 33 | 189–193 | 5 | `PKAC` | Kick Accuracy | Likely |
| 34 | 194–198 | 5 | `PACC` | Acceleration | Likely |
| 35 | 199–201 | 3 | `PRGC` | Progression (catching?) | Guess |
| 36 | 202–205 | 4 | `PHED` | Head / face model | Likely |
| 37 | 206–219 | 14 | `RCHD` | Unknown 14-bit; recruit/roster link? | Unknown |
| 38 | 220 | 1 | `PHPD` | Hand preference flag | Guess |
| 39 | 221–225 | 5 | `PSPD` | Speed | Likely |
| 40 | 226–227 | 2 | `PRSD` | Redshirt status | Likely |
| 41 | 228–232 | 5 | `PPOE` | Potential | Likely |
| 42 | 233 | 1 | `PBRE` | Breathe-right strip | Likely |
| 43 | 234 | 1 | `PEYE` | Eye black | Likely |
| 44 | 235 | 1 | `PLMG` | Left-hand glove *(signed)* | Likely |
| 45 | 236–239 | 4 | `PFSH` | Face shield / visor | Likely |
| 46 | 240–241 | 2 | `PLSH` | Left shoe style *(signed)* | Likely |
| 47 | 242–245 | 4 | `PMSH` | Mouthpiece | Likely |
| 48 | 246–247 | 2 | `PRSH` | Right shoe style *(signed)* | Likely |
| 49 | 248–251 | 4 | `PSSH` | Sock style | Likely |
| 50 | 252–256 | 5 | `PCTH` | Catching | Likely |
| 51 | 257–261 | 5 | `PAGI` | Agility | Likely |
| 52 | 262–264 | 3 | `PSKI` | Skin tone | Likely |
| 53 | 265–269 | 5 | `PINJ` | Injury rating | Likely |
| 54 | 270–274 | 5 | `PTAK` | Tackle | Likely |
| 55 | 275–279 | 5 | `PPBK` | Pass Blocking | Likely |
| 56 | 280–285 | 6 | `PRBK` | Run Blocking | Likely |
| 57 | 286–288 | 3 | `PNEK` | Neck pad | Likely |
| 58 | 289–292 | 4 | `PFMK` | Facemask style | Likely |
| 59 | 293–297 | 5 | `PBTK` | Break Tackle | Likely |
| 60 | 298–300 | 3 | `PHCL` | Hair colour | Likely |
| 61 | 301–304 | 4 | `PFGM` | Forearm model | Guess |
| 62 | 305–307 | 3 | `PGGM` | Glove model | Guess |
| 63 | 308–309 | 2 | `HELM` | Helmet style | Likely |
| 64 | 310 | 1 | `PHAN` | Handedness (0 = R, 1 = L). Set on 0.7% of all players but **5.2% of QBs** (22/423), consistent with handedness only being modelled at QB. A generic rare flag would look identical, so this is suggestive, not proven | Likely |
| 65 | 311–317 | 7 | `PJEN` | **Jersey number** (0–99, verified) | Verified |
| 66 | 318–322 | 5 | `PTEN` | Tendency | Likely |
| 67 | 323–325 | 3 | `PLHN` | Left hand accessory | Likely |
| 68 | 326–328 | 3 | `PRHN` | Right hand accessory | Likely |
| 69 | 329–330 | 2 | `PSLO` | Sleeve option | Likely |
| 70 | 331–332 | 2 | `PTTO` | Tattoo | Guess |
| 71 | 333 | 1 | `PLFP` | Flak jacket / pad flag | Guess |
| 72 | 334–337 | 4 | `PRGP` | Progression | Guess |
| 73 | 338–342 | 5 | `PTHP` | Throw Power | Likely |
| 74 | 343–348 | 6 | `PFMP` | Unknown | Unknown |
| 75 | 349–353 | 5 | `PIMP` | Impact / importance | Guess |
| 76 | 354–358 | 5 | `PJMP` | Jumping | Likely |
| 77 | 359–360 | 2 | `PTYP` | Player type | Likely |
| 78 | 361–365 | 5 | `PCAR` | Carrying | Likely |
| 79 | 366–368 | 3 | `PYER` | **Class year** 0–3 = FR/SO/JR/SR (verified) | Verified |
| 80 | 369–372 | 4 | `PRGR` | Progression | Guess |
| 81 | 373–377 | 5 | `PKPR` | Kick Power | Likely |
| 82 | 378–382 | 5 | `PSTR` | Strength | Likely |
| 83 | 383–387 | 5 | `POVR` | Overall | Likely |
| 84 | 388–392 | 5 | `PAWR` | Awareness | Likely |
| 85 | 393–395 | 3 | `PRGS` | Progression | Guess |
| 86 | 396–398 | 3 | `PDIS` | Discipline | Guess |
| 87 | 399–400 | 2 | `PVIS` | Visor | Likely |
| 88 | 401–403 | 3 | `PFJS` | Flak jacket style | Guess |
| 89 | 404–408 | 5 | `PPOS` | **Position**, 0–20 — see [Position enum](#position-enum-ppos) | Verified |
| 90 | 409–412 | 4 | `PLWS` | Left wristband | Likely |
| 91 | 413–416 | 4 | `PRWS` | Right wristband | Likely |
| 92 | 417–423 | 7 | `PHGT` | **Height in inches, no offset** (63–82). Discriminating test: offset 0 reproduces published positional average heights to 0.31 in mean error; offsets of ±2 give ~2 in | Verified |
| 93 | 424–426 | 3 | `PRGT` | Progression | Guess |
| 94 | 427–428 | 2 | `PSLT` | Sleeve type | Guess |
| 95 | 429–431 | 3 | `PGRT` | Grit / growth | Guess |
| 96 | 432–437 | 6 | `PRST` | Unknown | Unknown |
| 97 | 438–440 | 3 | `PRGY` | Progression (year) | Guess |
| 98 | 441–443 | 3 | `PLSY` | Unknown (type not stored) | Unknown |

---

## Name encoding

First and last names are stored inline as 6-bit character codes across
`PF01`–`PF10` and `PL01`–`PL13`. There is no name lookup table.

| Code | Character |
| :--- | :--- |
| 0 | terminator |
| 1–26 | `a`–`z` |
| 27–52 | `A`–`Z` |
| 54 | `'` — O'Connor, O'Neal |
| 55 | `.` — T.J., A.J. |
| 56 | `-` — John-Paul, Saint-Preux |

Code 53 is unused in this save. Derived from record 0:
`PL01..PL08 = 49,9,12,12,9,1,13,19` → `Williams`;
`PF01..PF06 = 30,5,14,14,9,19` → `Dennis`.

---

## Validation

`src/validatePlayTable.ts` — all checks pass:

- 98 fields tile bits 0–443, no gaps or overlaps
- `PGID` is a primary key: 7,404 distinct across 7,404 records
- Names: 0 unknown character codes; 100% of last names start with a capital
- `PHGT` 100% within 63–82 in. `PWGT` raw spans 0–226 (spread 226 lb), which matches a real weight range under **any** offset — the validator tests the spread separately from the offset, so a wrong constant cannot be masked by a passing range check.

### The `PWGT` offset — resolved by ground truth

`PWGT` was obviously weight from the start: it correlates with position exactly as weight should (OL heaviest, WR/CB lightest) and its spread is right. What the file could **not** settle was the constant added to it.

- Raw range is `0..226`, and the floor is genuine: **25 players sit at raw 0**. So the offset is literally "what the lightest player in the game weighs".
- Against published 2006 positional averages, offset **165** fit better (3.9 lb mean error) than **160** (7.1 lb). At 160, nearly every position came out light — QB −8, TE −7, DT −10, LE −17, RE −22.
- **That was not decisive.** A uniform ~5 lb bias is equally well explained by the reference averages being ~5 lb heavy. This is precisely the non-discriminating-evidence trap that produced the `TEAM.TMAA` error (method lesson L5), so no winner was declared from it — and it is worth noting the better-fitting candidate turned out to be the wrong one.
- Body composition did not separate them either (OL mean BMI 36.0 at 160, 36.6 at 165; real FBS OL sit around 36–38).

**Settled by reading one weight out of the game:**

| Player | Team | Raw | @160 | @165 | In-game |
|---|---|---|---|---|---|
| Darius Whitaker #94 DT | Washington | 175 | **335 lb** | 340 lb | **335 lb** |

`175 + 160 = 335`, so the offset is **160**. The constant lives in one place — `PLAYER_WEIGHT_OFFSET` in `src/lib/eadb.ts` — and `validatePlayTable.ts` pins this anchor as a permanent check so it cannot drift back to a guess.
- `PJEN` ≤ 99; `PYER` ≤ 3; `PPOS` spans exactly 21 positions (0–20)
- `PGID` partitions into 119 team blocks of 70 slots; roster slots unique within
  each team; all 119 derived ids present in `TEAM.TGID`; all 119 rosters cover
  ≥ 18 of 21 positions
- All 7,313 `DCHT` rows join to `PLAY.PGID`, and `DCHT.PPOS` agrees with
  `PLAY.PPOS` on 99.6% of the 6,639 non-special-teams rows (674 rows carry
  special-teams roles with `PPOS > 20`, e.g. returner)

Sample: `Dennis Williams #25`, `Yusef Glover #52`, `T.J. Hoyte #55`.

---

## Team relationship

`PLAY` has **no `TGID` column**. A player's team is encoded *arithmetically*
inside `PGID`: each team owns a fixed block of **70 consecutive ids**.

```ts
TGID       = Math.floor(PGID / 70)
rosterSlot = PGID % 70
```

70 is not a power of two, which is precisely why every bit-shift hypothesis
(`PGID >> 6`, `>> 7`, `>> 8`) failed. The block size was recovered by gap
analysis of sorted `PGID`s: the 122 contiguous runs all begin at a multiple of
70 (70, 140, 210, 350, 420, 490, …), and `max(PGID) 16155 / 70 = 230`, matching
`TEAM.TGID`'s 1–231 range.

Verification (all pass, in `validatePlayTable.ts`):

- **119 teams** derived — exactly the FBS count for NCAA 07
- Roster sizes 53–69; no roster exceeds the 70-slot block
- Roster slots are unique within each team
- All 119 derived ids exist in `TEAM.TGID`; the remaining 84 `TEAM` rows carry
  no roster (FCS schools — Alabama A&M, Alcorn State, Brown, …)
- All 119 rosters field at least 18 of the 21 positions
- Spot check: TGID 3 → Alabama Crimson Tide (69 players), TGID 2 → Akron Zips (61)

Note that ~73 of 119 teams contain duplicate jersey numbers. That is normal in
college football (offense and defense share numbers), not a decode failure.

---

## Rating field names — position-profile audit

The rating field *names* were originally taken from their four-letter mnemonics,
which is suggestive but is not evidence. Each was re-tested with a
**discriminating** check: state in advance which positions a correctly-named
rating must top out and bottom out at, then see whether the data agrees. A
mislabelled field fails this; a merely plausible one does not survive it.

**15 of 15 testable ratings passed**, so for these the mnemonic is now confirmed
and they should be read as **Verified**, overriding the Likely in the table above:

| Field | Prediction | Observed | Result |
|---|---|---|---|
| `PSPD`, `PACC`, `PAGI` | high at CB/WR/HB, low at OL | top HB, CB, WR, FS; bottom OL | PASS |
| `PSTR` | highest at OL | top RG, LG, RT, LT | PASS |
| `PCTH` | highest at WR, then TE | WR 79, TE 70 | PASS |
| `PCAR` | highest at HB, then FB | HB 77, FB 65 | PASS |
| `PTHP`, `PTHA` | highest at QB by a wide margin | QB top on both | PASS |
| `PKPR`, `PKAC` | highest at K and P | K, P top on both | PASS |
| `PPBK`, `PRBK` | highest at OL | OL top on both | PASS |
| `PTAK` | highest at DT/MLB | DT, MLB top | PASS |

`PCTH` and `PCAR` deserve special note: they are the one genuinely swappable
pair (both are "ball-handling" ratings on skill players), and the test separates
them cleanly — catching peaks at WR, carrying peaks at HB. They are correctly
assigned.

**Untestable in this save (4):** `POVR`, `PAWR`, `PSTA`, `PINJ`. None of these
generates an independent positional prediction, and all four top out at K and P
because of the specialist rating inflation the engine applies. They remain
Likely on mnemonic evidence only.

---

## Position enum (`PPOS`)

Confirmed — not assumed — by cross-checking each value's physical profile and
per-team headcount against real football expectations.

| `PPOS` | Pos | count | per team | avg ht | avg wt | avg `PSPD` | avg `PSTR` |
|---|---|---|---|---|---|---|---|
| 0 | QB | 423 | 3.55 | 6'3" | 207 | 8.8 | 4.3 |
| 1 | HB | 507 | 4.26 | 5'11" | 201 | 20.7 | 7.6 |
| 2 | FB | 228 | 1.92 | 6'0" | 235 | 10.6 | 9.6 |
| 3 | WR | 869 | 7.30 | 6'1" | 191 | 20.5 | 3.5 |
| 4 | TE | 387 | 3.25 | 6'4" | 243 | 10.2 | 9.2 |
| 5 | LT | 269 | 2.26 | 6'5" | 297 | 3.3 | 18.7 |
| 6 | LG | 286 | 2.40 | 6'4" | 299 | 2.8 | 18.8 |
| 7 | C | 271 | 2.28 | 6'3" | 289 | 3.3 | 17.1 |
| 8 | RG | 278 | 2.34 | 6'4" | 301 | 2.7 | 19.1 |
| 9 | RT | 268 | 2.25 | 6'5" | 298 | 3.1 | 18.9 |
| 10 | LE | 310 | 2.61 | 6'3" | 253 | 10.7 | 10.6 |
| 11 | RE | 307 | 2.58 | 6'3" | 248 | 11.2 | 10.0 |
| 12 | DT | 564 | 4.74 | 6'3" | 285 | 5.7 | 15.8 |
| 13 | LOLB | 294 | 2.47 | 6'1" | 222 | 13.4 | 8.6 |
| 14 | MLB | 342 | 2.87 | 6'1" | 230 | 12.4 | 9.9 |
| 15 | ROLB | 292 | 2.45 | 6'1" | 220 | 13.8 | 8.4 |
| 16 | CB | 642 | 5.39 | 5'11" | 183 | 20.6 | 2.7 |
| 17 | FS | 297 | 2.50 | 6'0" | 196 | 17.8 | 5.8 |
| 18 | SS | 301 | 2.53 | 6'0" | 199 | 17.2 | 6.2 |
| 19 | K | 144 | 1.21 | 5'11" | 188 | 5.1 | 1.2 |
| 20 | P | 125 | 1.05 | 6'1" | 197 | 5.5 | 2.0 |

Every expectation holds: the five OL slots are the heaviest (289–301 lb),
slowest (2.7–3.3) and strongest (17.1–19.1); K and P sit at ~1 per team with the
lowest strength; CB is the fastest and lightest and the most numerous defensive
position (5.39/team); QB at 3.55/team is the tallest skill position.

`PYER` maps to `['FR', 'SO', 'JR', 'SR']` (1344 / 2044 / 2096 / 1920).

Both enums live in `src/lib/eadb.ts` as `PLAYER_POSITIONS` and `PLAYER_YEARS`,
alongside `playerTeam()` and `playerRosterSlot()`.

---

## Rating scale

Ratings are **not** stored as 0–99. Each is a 5-bit index (0–31) into a
**non-uniform quantisation of the displayed 40–99 range**, shared by every
rating field and every player.

$$
\text{display}(r) =
\begin{cases}
40 + 4r & 0 \le r \le 4 \\
56 + 3(r-4) & 4 \le r \le 8 \\
68 + 2(r-8) & 8 \le r \le 16 \\
84 + (r-16) & 16 \le r \le 31
\end{cases}
$$

Slopes run 4 → 3 → 2 → 1: the game spends its limited bit budget coarsely at
the bottom, where the difference between a 40 and a 44 is irrelevant, and
finely at the top, where one point of Speed decides a matchup. The endpoints
land exactly on **40** and **99**.

**The floor is 40, not 0.** A zero rating is not representable. Zach Morris'
Throw Power, Throw Accuracy, Pass Block, Run Block, Kick Power and Kick
Accuracy all store raw 0 and all display 40.

| raw | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **display** | 40 | 44 | 48 | 52 | 56 | 59 | 62 | 65 | 68 | 70 | 72 | 74 | 76 | 78 | 80 | 82 |

| raw | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **display** | 84 | 85 | 86 | 87 | 88 | 89 | 90 | 91 | 92 | 93 | 94 | 95 | 96 | 97 | 98 | 99 |

The table is **complete**. 30 of the 32 entries were observed directly in game;
the remaining two (raw 28 → 96, raw 31 → 99) are *forced* — strict monotonicity
between confirmed neighbours leaves exactly one integer for each. 99.91% of the
140,676 rating values in the save use a directly observed entry.

The model was fitted with **zero free parameters** and then validated
out-of-sample twice, predicting 11 values correctly before they were looked up,
including every three-way ambiguous entry. Sources (all identified
independently by team, position, jersey, height, weight and class before any
rating was read):

| Player | Team | Contribution |
|---|---|---|
| Nick Moore | Oklahoma HB #28 | initial anchors |
| Seth Harris | Georgia Tech WR #21 | anchors, then raw 10 and 12 (the last gaps) |
| Alan James | Notre Dame QB #10 | anchors |
| Zach Morris | San Diego State CB #3 | 18 ratings at once, 12 new entries |
| Johnny Harrison | Navy FB #34 | blind test — 19/19 exact, 9 out-of-sample |

`PRBK` is 6 bits wide but still stores a 0–31 value and uses the same table —
confirmed at raw 0 → 40, raw 4 → 56 and raw 5 → 59.

Implemented as `ratingToDisplay()` / `displayToRating()` in `src/lib/eadb.ts`.
The inverse is **lossy by design**: the coarse lower segments cannot express
every integer, so e.g. a requested 41 snaps to 40.

---

## Open questions

- `RCHD` (14 bits), `PFMP` (6), `PRST` (6), `PLSY` (3) are unidentified.
- The nine `PRG*` fields are assumed to be progression-related; unconfirmed.
