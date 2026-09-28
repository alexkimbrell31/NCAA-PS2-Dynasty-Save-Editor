# PLGA Table — Schema and Semantics

The roster cache for the next game on the schedule. One record per player on
either participating squad.

| Property | Value |
|---|---|
| Offset | `0x00169988` |
| Data offset | `0x00169E28` |
| Records | 119 of 140 allocated |
| Record length | 68 bytes (544 bits) |
| Fields | 72 |
| Bit coverage | 0..530, then 13 bits of padding |

PLGA is small, but it is the most *leveraged* table decoded so far. It is the
only place in the file that stores player names as **plain text**, and it
contains players who exist nowhere else. 28 semantic checks pass.

## What the table is

PLGA holds two squads and nothing else: 67 Washington players and 52 East
Washington players. `SCHD` independently says the user's earliest unplayed
fixture is **E Washington @ Washington** in week 0 — exactly these two teams.
This is the game's cache of the next matchup.

## Field map

62 of the 72 fields are shared with `PLAY` and carry identical meanings
(ratings, position, class, height, weight, jersey, and the large block of
appearance fields). The 10 fields unique to PLGA are:

| Field | Bits | Meaning |
|---|---|---|
| `PFNA` | 80 | First name, plain text |
| `PLNA` | 104 | Last name, plain text |
| `PGCI` | 16 | Constant 65535 — no information in this save |
| `PGYI` | 16 | Constant 65535 — no information in this save |
| `PGPI` | 16 | Per-player index — **unidentified** |
| `PGSI` | 16 | Per-player index — **unidentified** |
| `PSBD` | 1 | Constant 0 — **unidentified** |
| `SNPD` | 9 | Lineup flag; set on a complete 11-on-11 personnel package |
| `SNPO` | 9 | Lineup flag; set on a different 11-on-11 personnel package |
| `PSNP` | 9 | 0..3, correlates with the lineup flags — **unidentified** |

## The name Rosetta stone

`PLAY` packs names into 23 separate 6-bit character fields (`PF01`..`PF10`,
`PL01`..`PL13`). PLGA stores the same players' names as ordinary text. The two
agree on **67 of 67** players.

That matters because it turns the name encoder from an assumption into a
measured fact. Encoding PLGA's plaintext reproduces the character codes `PLAY`
actually holds across all 904 character slots. PLGA was written by the game, so
it cannot inherit a mistake from our decoder — a self-consistency check between
our own encoder and our own decoder would have proved nothing.

`encodeName` is now in `eadb.ts` and `editSave.ts` accepts virtual `firstName` /
`lastName` fields:

```
node src/editSave.ts --table PLAY --where PGID=7712 --set lastName=Whittaker
```

### Why the encoder does not pad

The first version of the encoder zeroed every unused character slot, and the
round-trip test failed on 18,460 slots. The cause was not a bug in the encoder:
**6774 of the 7404 players carry non-zero codes after their terminator.**

`PLAY` stores "Jones" as `J,o,n,e,s,0,m,s`. The `ms` is the tail of
**"Willia*ms*"** — the row previously held a longer name and only the first five
slots were rewritten. The game stops at the terminator and never sees the
residue.

So the encoder writes characters plus one terminator and touches nothing else.
Clearing the tail would be semantically harmless but would change bytes the game
never asked us to change, which the byte-attribution guard in `editSave.ts`
would correctly refuse. This is the same rule already established for the wide
string fields during the write round-trip.

## The position enum, confirmed by the game itself

The 52 East Washington players are **generated**, not stored. They have an empty
`PFNA` and a `PLNA` of the form `"<position> #<jersey>"` — `MLB #52`, `CB #24`,
`RT #78`.

That is the game writing the position abbreviation as text, right next to the
numeric `PPOS`. `PLAYER_POSITIONS` was originally inferred from body types —
linemen are heavy and slow, corners fast and light, kickers scarce. Good
evidence, but circumstantial. The generated roster covers **all 21 positions**
and agrees on **21 of 21**:

| `PPOS` | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | QB | HB | FB | WR | TE | LT | LG | C | RG | RT | LE |

| `PPOS` | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| | RE | DT | LOLB | MLB | ROLB | CB | FS | SS | K | P |

The embedded jersey number matches `PJEN` on 52 of 52.

## FCS rosters are generated, not stored

The 52 East Washington players have **no `PLAY` row anywhere in the file**.
Their PGIDs occupy a contiguous block, 13790..13841, above everything in `PLAY`.

This answers a question left open since the team link was solved: `PLAY` holds
only the 119 FBS rosters because FCS squads are manufactured on demand for the
one game they appear in. They are rated well below the FBS side — mean overall
53.3 against 78.0 — and, unlike the authored roster, the generator does **not**
enforce unique jersey numbers (50 distinct across 52 players, against 67 of 67
for Washington).

## `SNPD` and `SNPO` are personnel packages

Each flags exactly 22 players. Twenty-two is the number of players on the field,
but a count alone is coincidence-sized evidence. What makes these real is that
each set forms a **legal formation**:

| | Washington (offence) | E Washington (defence) |
|---|---|---|
| `SNPD` | QB, HB, WR×3, TE, LT, LG, C, RG, RT | LE, RE, DT, LOLB, MLB, ROLB, CB×2, FS, SS×2 |
| `SNPO` | QB, HB, WR×2, TE×2, LT, LG, C, RG, RT | LE, RE, DT, LOLB, MLB×2, ROLB, CB×2, FS, SS |

Eleven a side, one quarterback, exactly five offensive linemen, and the home
team always on offence. A random 22 would satisfy none of that.

The two packages also **answer each other**. `SNPD` is a three-receiver set, and
the defence opposite it drops a linebacker for a fifth defensive back — nickel.
`SNPO` is a two-tight-end set, and the defence adds the linebacker back. That
is how personnel matching actually works in football, and it is strong evidence
these are real formations rather than a decoding artefact.

**Which of the two is which is not established.** Both hold a complete legal
lineup, and nothing in this save distinguishes them. The `D`/`O` suffixes are
suggestive and nothing more.

`PSNP` (0..3) correlates with the two flags but is not their sum: 18 players
have `PSNP = 1` while appearing in neither lineup, which hints at further units
(special teams) that this table does not enumerate. Unidentified.

## Three disagreements with PLAY

Across 67 players and 62 shared fields — 4154 comparisons — PLGA and `PLAY`
disagree on exactly three values:

| Player | Field | `PLAY` | PLGA |
|---|---|---|---|
| Brian Dean (QB) | `PTHA` | 80 | 78 |
| Brian Dean (QB) | `POVR` | 86 | 84 |
| Paul Phillips (RT) | `PPBK` | 87 | 89 |

Three is the wrong order of magnitude for a decoding error — a wrong bit offset
breaks everything or nothing, not 0.07% of one table. The Brian Dean pair is
internally coherent: his throw accuracy and his overall move together and by the
same amount, which is what you would expect if one table holds a slightly older
snapshot of a player whose overall is derived from his ratings.

That is a hypothesis, not a finding. The validator asserts the *shape* of the
anomaly (at most three disagreements, named) rather than pretending it is
absent.

## Open questions

- `PGPI` and `PGSI`: 107 and 111 distinct values over 119 rows, equal on 104 of
  them. The 15 that differ are all Washington players. Neither resolves against
  any solved table.
- `PSNP`'s 0..3 scale, and the 18 players it flags who are in neither lineup.
- Which of `SNPD` / `SNPO` is which.
- The three `PLAY` disagreements.

## Validation

`src/validatePlgaTable.ts` asserts 28 properties, all passing: bit tiling,
`PGID` uniqueness, the two-squad structure, the `SCHD` cross-check identifying
the cached fixture, squad sizes, agreement with `PLAY` across all 62 shared
fields, exact identity-field agreement, the plaintext/6-bit name equality, the
ground-truthed encoder, name lengths, the generated-versus-stored split and its
contiguous id block, generated-name parsing, the embedded jersey number, all 21
position abbreviations, both lineups being 11-on-11 with a clean
offence/defence split and a legal formation, the two lineups differing, the
shared rating scale, FCS ratings sitting below FBS, physical plausibility,
jersey legality and the authored/generated uniqueness difference, and explicit
non-identification of `PGCI`, `PGYI`, `PGPI` and `PGSI`.
