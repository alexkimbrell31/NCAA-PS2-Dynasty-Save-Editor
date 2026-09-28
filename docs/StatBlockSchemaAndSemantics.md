# The Statistics Block — PSOF, PSDE, PLAC (and HEIS)

Four related tables. `PSOF` and `PSDE` are **fully decoded**; `PLAC` is decoded
structurally with its value columns explained but not individually named;
`HEIS` is **partially decoded** and one field is honestly left unidentified.

| Table | Offset | Records | Fields | Rec len | Status |
|-------|--------|---------|--------|---------|--------|
| `PSOF` | `0x0007E7AC` | 1076 / 9520 | 24 | 28 B | solved |
| `PSDE` | `0x000362E4` | 1698 / 11900 | 16 | 20 B | solved |
| `PLAC` | — | 490 / 3100 | 14 | 20 B | structure solved |
| `HEIS` | — | 10 / 10 | 11 | 20 B | partial |

## How the naming model was established

`PSOF`'s columns follow `s` + category + stat, with the category as the
**second** character: `sa**` passing, `sc**` receiving, `su**` rushing.

That is mnemonic-grade reasoning and was deliberately **not** trusted on its
own — it is exactly what Lesson 8 warns about. Three tiers of evidence were
applied instead, in increasing strength.

**1. Position gating.** All seven `sa**` columns are 100% quarterbacks on every
nonzero row. `sc**` belongs to WR/TE/HB/FB, `su**` to HB/QB/FB/WR.

**2. Arithmetic invariants.** Completions ≤ attempts (155/155), passing TD ≤
completions (146/146), interceptions ≤ attempts (155/155), receiving TD ≤
catches (645/645), rushing TD ≤ carries (534/534). Crucially, a **control**
confirms these discriminate: three deliberately wrong pairings all break.

**3. Team bookkeeping — the discriminating test.** These identities are real
football and depend on nothing about what the fields are called:

| Identity | Result |
|---|---|
| Σ receiving yards == Σ passing yards | **109/109** |
| Σ catches == Σ completions | **109/109** |
| Σ receiving TD == Σ passing TD | **89/89** |
| Σ rushing yards == Σ passing yards *(control)* | 1/109 |

The control is the point: the identity is specific to the receiving category,
so the category letters are **pinned, not guessed**.

**4. Cross-table.** `PSOF` and `PSDE` were decoded independently, then checked
against each other through `SCHD`:

- A defence's interceptions == the opposing QBs' interceptions thrown: **82/82**
- A defence's sacks == the opposing QBs' sacks taken: **82/82**

Restricted to the 41 FBS-vs-FBS games, for a principled reason: all 27 FCS
participants have **zero** stat rows, because FCS teams have no `PLAY` roster
(see PLGA). Their side of the identity was never written.

## PSOF — offence

| Group | Fields |
|-------|--------|
| Passing | `saat` att, `sacm` comp, `saya` yds, `satd` TD, `sain` INT, `sasa` sacked, `salN` long |
| Receiving | `scca` catches, `scya` yds, `sctd` TD, `scrL` long, `scdr` drops |
| Rushing | `suat` car, `suya` yds, `sutd` TD, `sulN` long, `subt` / `suyh` (pair), `sufu` fumbles |
| Meta | `PGID`, `SEYR` = 0, `sgmp` = 1 |

## PSDE — defence

`sdta` tackles, `sdtl` TFL, `slsk` sacks, `sdpd` passes defended, `ssin` INT,
`ssiy` INT return yds, `ssdt` defensive TD, `slff` forced fumbles, `slfr`
fumble recoveries, `slfy` fumble return yds.

Internal consistency: TFL ≤ tackles (467/467), sacks ≤ TFL (236/236), return
yards require the corresponding takeaway (134/134 and 34/34).

## Apparent anomalies that are real football

- **Longest run > total rushing yards, 110 rows.** Legitimate: `suya` is
  **signed** and 74 players have negative rushing yards. A long gain plus larger
  losses produces exactly this.
- **One cornerback with a carry and a catch.** Anthony Johnson (Notre Dame), one
  6-yard carry and one 5-yard catch — a trick play or two-way player. The
  validator asserts this exact shape rather than widening the rule to hide it.
- **A QB with a sack but zero attempts.** Sacks are not pass attempts in NCAA
  statistics, so this is correct bookkeeping.

## PLAC — cumulative in-game snapshots

Not a totals table. `PLAC` records a player's **running stat line at the moment
something notable happened**.

- Joins `SCHD` on `(SEWN, SGNM)` **490/490**, and the player's team is one of
  the two in that game **490/490** (chance would place ~4.8).
- Within a `(player, PAty)` group, values are **monotonically non-decreasing**
  as `PAas` rises: **122/122**.
- The highest snapshot **never overshoots** the player's final `PSOF`/`PSDE`
  line — the snapshots are prefixes of it.

Worked example — John Jones, `PAty` 3:

| PAas | GQTR | comp | yds | att |
|---|---|---|---|---|
| 16 | 2 | 8 | 101 | 15 |
| 16 | 3 | 15 | 179 | 28 |
| 21 | 7 | 15 | 179 | 28 |
| | **final (PSOF)** | **15** | **179** | **28** |

`PAty` is a stat **category**, not a position: 1 returns, 2 and 3 passing,
5 rushing, 7 receiving, 8 and 9 defence, 10 kicking. `PAat` is exactly the
offence/defence split — it is 1 on precisely `PAty` ∈ {8, 9}.

**Not established:** which specific stat each of `PAcC`/`PAsC`/`PAcS`/`PAsS`/
`PAcV`/`PAsV` holds. They vary by category and match `PSOF`/`PSDE` fields only
partially (58/81, 62/81 …), consistent with snapshots rather than totals.
`PAas` (1..45, never zero) is a progression index of some kind.

## HEIS — partial

Solid: `PGID` resolves 10/10, all QB/HB/WR with display OVR 91–98 (the top ~133
of 7404); `HPRK` is rank 0..9; `PCAP` is points, strictly descending
200/180/160/140/120/100/90/80/70/60.

**`CAN0` is left unidentified.** It resolves 10/10 as a `TEAM.TGID` — and that
is the `UTID` trap again. `TGID` is a dense id space, so resolution is free and
proves nothing. Seven distinct values across ten rows, meaning unknown.

`HEIS` shares an eight-field block with `PLAC` (`PGID` plus the six value
columns and `PAty`) and no other table has them.

## Validation

`src/validateStatTables.ts` — **32/32 checks pass**, covering PSOF, PSDE and
PLAC including the controls.
`src/dumpStatTables.ts` writes `out/PSOF.csv`, `out/PSDE.csv` and both schemas.

Leaderboards from the decoded data read as plausible box scores — David Scott
496 yards on 31/46 with 4 TD; Marvin Coleman 250 rushing yards on 22 carries
with a 95-yard long.
