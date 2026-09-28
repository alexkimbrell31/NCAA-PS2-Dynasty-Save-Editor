# WQTS — Quarter-by-Quarter Line Scores

`WQTS @ 0x000EACD4` — **272 / 3875 records, 5 fields, 4 bytes each.**

The smallest record in the file (4 bytes), and the source of the project's most
consequential correction: **week 0 has been played.**

## Schema

| Field  | Bit | Width | Type | Meaning |
|--------|-----|-------|------|---------|
| `GASC` | 0   | 8     | 3    | Points scored by the away team **in this quarter** |
| `GHSC` | 8   | 8     | 3    | Points scored by the home team in this quarter |
| `SGNM` | 16  | 7     | 3    | Game number — joins `SCHD` with `SEWN` |
| `SEWN` | 23  | 5     | 3    | Season week — 0 throughout |
| `GQTR` | 28  | 3     | 3    | Quarter, 1..4 |

272 rows = 68 games × 4 quarters, exactly.

## Findings

### Per-quarter points, not a running total

`GHSC`/`GASC` reuse the same tags as `SCHD`'s final score, so they could
plausibly have been a running total. Summing discriminates cleanly:

- Quarters **sum** to `SCHD`'s final score: **68/68**
- Treating Q4 as the final score: **0/68**

### `GQTR` has room for overtime but none occurred

The field is 3 bits, so it can express 5–7. Only 1..4 occur, and no game in the
set is tied — consistent, since college football has had overtime since 1996.

### Week 0 has been played — 68 of 71 games

This contradicts the "fresh, untouched preseason dynasty" assumption that
several earlier tables were read under. The three games without quarter data
are the three still to be played:

| Away | Home | Note |
|------|------|------|
| Kentucky | Louisville | real 2006 Sunday night game |
| Florida State | Miami | real 2006 Labor Day Monday game |
| E Washington | Washington | **the user's own game** |

Two independent confirmations that this is a mid-week state rather than a
preseason one:

1. The user's game is exactly the fixture `PLGA` caches rosters for.
2. The other two have a **later `GDAT`** than every played game — and they are
   precisely the two 2006 openers that really were held back to Sunday and
   Monday. `SCHD.GDAT`'s Monday-origin decoding predicts this independently.

A 0-0 final never occurs among the 68 played games, so `GHSC == 0 && GASC == 0`
in `SCHD` is a reliable "not played yet" signal.

### Correction to a recorded claim

Earlier notes recorded TEAM's season counters as all zero. They are not:

- `TSWI` reproduces each team's week-0 **wins**, 203/203
- `TSLO` reproduces each team's week-0 **losses**, 203/203
- `TSLW` also matches wins, 203/203 (distinct meaning not yet established)

Only 11 TEAM fields remain entirely zero: `LGID TBRK TBPR TOVR TSDS tscs tsns
TMGC SDUR SNCT tmsg`.

## Open questions

None for WQTS itself. `TSLW` duplicating `TSWI` needs a later season to separate.

## Validation

`src/validateQuarterTable.ts` — **12/12 checks pass.**
`src/dumpQuarterTable.ts` writes `out/WQTS.csv` and `analysis/quarter_schema.json`.
