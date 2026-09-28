# TSSE, PSKI, PSKP, MCOV, MOIN — Schema and Semantics

Five tables decoded in one pass. TSSE is the centrepiece: it is the first table
in the project that can be validated almost entirely from tables we already
trust, because every column is either a sum of per-player stat rows or a mirror
of the opponent's own column.

**Validator:** `src/validateTeamStatTables.ts` — 52/52.
**Dumper:** `src/dumpTeamStatTables.ts` → `out/TSSE.csv`, `out/PSKI.csv`, `out/PSKP.csv`.

---

## TSSE — team season statistics

109 rows, 35 fields, one row per team.

### Why 109

136 teams took part in the 68 completed week-0 games. 27 of those are FCS
schools, which have no `PLAY` roster and therefore no stat rows at all (see
PLGA: FCS squads are generated on demand, not stored). 136 − 27 = **109**, and
all 109 TSSE teams are confirmed week-0 participants. The row count is the
identification, the same move that identified AAPL.

### The mirror test — the load-bearing evidence

TSSE stores both what a team did and what it allowed. For every opponent pair,
one team's "allowed" column equals the other's "gained" column:

| test | result |
|---|---|
| true opponent pairs mirror | **41/41** games |
| **CONTROL** — every non-opponent pairing | **0 / 11,690** |

The control is what makes this evidence rather than a coincidence of shape
(Lesson 15). Zero false positives across 11,690 wrong pairings.

Seven mirror pairs are confirmed, each 82/82 on FBS-vs-FBS rows:

| gained / did | allowed / opponent did | meaning |
|---|---|---|
| `tsop` | `tsdp` | passing yards |
| `tsor` | `tsdy` | rushing yards |
| `tssa` | `tssk` | sacks taken / sacks made |
| `tspi` | `tsDi` | interceptions thrown / made |
| `tsfl` | `tsfr` | fumbles lost / recovered |
| `tsof` | `tsdf` | **unidentified** |
| `tsta` | `tsga` | **unidentified** |

### Cross-table sums (all 109/109)

Every one of these is an independent table agreeing with TSSE:

- `tsop` == Σ `PSOF.saya` (passing yards)
- `tsor` == Σ `PSOF.suya` (rushing yards)
- `tspi` == Σ `PSOF.sain` (interceptions thrown)
- `tssa` == Σ `PSOF.sasa` (sacks taken)
- `tsPt` == Σ `PSOF.satd` (passing touchdowns)
- `tsrt` == Σ `PSOF.sutd` (rushing touchdowns)
- `tssk` == Σ `PSDE.slsk` (sacks)
- `tsDi` == Σ `PSDE.ssin` (interceptions)
- `tsfr` == Σ `PSDE.slfr` (fumble recoveries)
- `tsty` == Σ `PSKP.srky` + `PSKP.srpy` (kick + punt return yards)

**Control:** shifting the team association by one drops `tsop` to 1/109.

### Internal arithmetic

- `tsor + tsop == tsoy` — total offense, **109/109**
- `tsoy + tsty == tsTy` — all-purpose yards, **109/109**
- `ts3c <= ts3d`, `ts4c <= ts4d`, `ts2c <= ts2a` — down conversions, 109/109
- `tsPy == 0` exactly when `tspe == 0`, and penalty yards fall in 4–15 per
  penalty — identifying `tspe` as the count and `tsPy` as the yardage

> **Yardage columns must be read SIGNED.** `tsor + tsop == tsoy` scores 108/109
> read unsigned. Idaho stores 65535 rushing yards, i.e. **−1**. This is the same
> quirk as `PSOF.suya`. Use `signed16()`.

### Points reconstruct exactly

Using only *other* tables — touchdowns from PSOF/PSDE/PSKP, PATs and field goals
from PSKI, two-point conversions from TSSE — the final score from SCHD is
reproduced on **105/109** teams. The remaining four are short by exactly **2**:

> Oklahoma State, Washington State, USC, Alabama

That is a **safety**, the one scoring play not represented in any of those
columns. An error would not land on exactly 2 four times.

### Confirmed field list

| field | meaning |
|---|---|
| `TGID` | team, primary key |
| `ts1d` | first downs |
| `tsop` / `tsor` / `tsoy` | pass / rush / total offensive yards |
| `tsdp` / `tsdy` | pass / rush yards allowed |
| `tsty` | return yards (kick + punt) |
| `tsTy` | all-purpose yards (`tsoy + tsty`) |
| `tspe` / `tsPy` | penalties / penalty yards |
| `ts3c` / `ts3d` | third-down conversions / attempts |
| `ts4c` / `ts4d` | fourth-down conversions / attempts |
| `ts2c` / `ts2a` | two-point conversions / attempts |
| `tsPt` / `tsrt` | passing / rushing touchdowns |
| `tssk` / `tssa` | sacks made / taken |
| `tsDi` / `tspi` | interceptions made / thrown |
| `tsfr` / `tsfl` | fumbles recovered / lost |

### Left unidentified (honestly)

`tsga`, `tsta`, `tsdf`, `tsof`, `tsdr`, `tsdt`, `tsot`, `tsoz`.

Four of them form two confirmed mirror pairs (`tsof`↔`tsdf`, `tsta`↔`tsga`), so
we know their *structure* — a team stat and its allowed counterpart — without
knowing which stat. No candidate exceeded 84/109 against any derived quantity,
and best-fit is not proof (Lesson 11). `tsoz` is plausibly red-zone trips
(`tsoz >= tsot` 109/109) but nothing discriminates it.

`tspd` and `tsPi` are **constant zero** across all 109 rows and carry no
information in this save.

---

## PSKI — kicking and punting

221 per-game rows (`sgmp == 1`).

### Field goals by distance

Five attempt/made pairs. The ranges were **derived, not assumed**: for kickers
with exactly one make in exactly one bucket, the long-FG column always lands
inside that bucket's range.

| bucket | attempts / makes | range | league |
|---|---|---|---|
| a | `skaa` / `skma` | under 20 | 3/3 — 100% |
| b | `skab` / `skmb` | 20–29 | 33/40 — 83% |
| c | `skac` / `skmc` | 30–39 | 50/61 — 82% |
| d | `skad` / `skmd` | 40–49 | 12/42 — 29% |
| e | `skae` / `skme` | 50+ | 2/26 — 8% |

- `skfa` == Σ bucket attempts, `skfm` == Σ bucket makes — **221/221**
- longest FG lands in the top bucket with a make — **70/70**
- accuracy falls monotonically with distance, which is what real kicking does

### Other fields

| field | meaning |
|---|---|
| `skfa` / `skfm` / `skfL` | FG attempted / made / longest |
| `skea` / `skem` | extra points attempted / made |
| `sknk` / `sktb` | kickoffs / kickoff touchbacks |
| `spat` / `spya` / `spny` | punts / gross yards / net yards |
| `splN` / `sptb` / `sppt` | longest punt / touchbacks / inside the 20 |
| `spbl` | blocked |

`spya >= spny` 221/221 (gross never below net). Field goals are attempted by
`K` on 90/91 rows; punts by `P` on 103/108, the remainder being kickers
doubling up — normal roster behaviour, not a decoding error.

---

## PSKP — kick and punt returns

259 per-game rows. `srk**` = kick returns, `srp**` = punt returns — the same
`s` + category + stat model proven for PSOF/PSDE.

| field | meaning |
|---|---|
| `srka` / `srky` / `srkL` / `srkt` | kick returns / yards / longest / TDs |
| `srpa` / `srpy` / `srpL` / `srpt` | punt returns / yards / longest / TDs |

All bounds hold 259/259, and **every** returner is a skill-position player
(WR 112, CB 74, HB 48, SS 13, FS 8, FB 3, TE 1). No linemen return kicks.

---

## MCOV — magazine cover

One row, and like DIVI it is **self-labelling** — the text names its own
numeric fields:

> **"Who's the Man?"** — *"QB #10 leads a great Ohio State team into 2006."*

`PGID 4936` resolves to **Shelton Williams, QB #10, Ohio State**, and
`TGID 70` is Ohio State. Position, jersey number and school all agree with the
prose. `SEWN = 0` is the current week. (Williams is also HEIS rank 2.)

### `CAN0` is NOT a team id — hypothesis refuted

HEIS left `CAN0` unlabelled because it resolved 10/10 as a `TGID`, which is the
`UTID` trap (dense id space, so resolution is free). MCOV settles it:

- MCOV's cover subject is **Ohio State**, but `CAN0 = 131` → **Jackson State**
- across HEIS, no player's `CAN0` matches his own team

Two independent tables now agree the TGID reading is wrong. `CAN0` remains
unidentified, but it is no longer *ambiguous* — it has been ruled out.

---

## MOIN — mode info

One row. `MNAM = "DYNASTY MODE"`, `MTYP = 1`, `MSTY = 10`, `MCST`/`MPST` = 255
(sentinel, all-ones in 8 bits). A save-slot descriptor. Nothing further is
determinable from a single row.

---

## Round trip

`verifyRoundTrip.ts` re-encodes 928,176 field values across 22,870 records in
all 82 tables and reports **IDENTICAL: all 2,161,664 bytes match** after the
`eadb.ts` additions. All 12 validators report zero failures.
