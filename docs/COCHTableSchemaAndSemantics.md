# COCH Table — Schema and Semantics

The coaching-staff table. One record per head coach, employed or unemployed.

| Property | Value |
|---|---|
| Offset | `0x00000B58` |
| Data offset | `0x000010B8` |
| Records | 213 used of 227 allocated |
| Record length | 108 bytes (864 bits) |
| Fields | 84 |
| Bit coverage | 0..861, then 2 bits of padding |

The record tiles cleanly with no gaps or overlaps, which is the first
confirmation that the field descriptors were read correctly.

## Caveat: this is a preseason save with placeholder coaches

Two properties of this particular file limit how much can be recovered, and it
is worth stating them up front so the schema below is not over-trusted:

1. **The coaches are generic.** `CLFN` (first name) is empty for all 213
   records, and `CLLN` (last name) is a school-derived placeholder — `AF Coach`,
   `Bama Coach`, `Bucks Coach`. There are no real coach names to validate
   against, so none of the usual "does this match reality" checks are available.
2. **52 of the 84 fields hold a single constant value.** The dynasty has not
   been played, so career wins, losses, championships, tenure and job history
   are all zero. Those fields cannot be distinguished from one another here.
   Resolving them requires a mid-dynasty save.

Only **32 fields vary**, and everything below is derived from those.

## Identity

| Field | Bits | Meaning |
|---|---|---|
| `CCID` | 16 | Coach ID. 213 distinct values — the primary key. |
| `CLFN` | — | First name (string). Empty in this save. |
| `CLLN` | — | Last name (string). Placeholder, always ends in `Coach`. |
| `TGID` | 9 | Employing team, or the sentinel `511` for a free agent. |

## Employment: the 511 sentinel

`TGID` is the same team key used by `TEAM` and (via `PGID / 70`) by `PLAY`.
The value **511** — all nine bits set — is a null marker meaning *unemployed*.

- **120 coaches are employed**, 93 sit in the free-agent pool.
- **All 119 FBS teams have exactly one head coach.** No team has two.
- Every free agent has `CPRE = 0` and `CTOP = 0`.

The 120th employed coach is an oddity: `TSU Coach` is attached to
`E Washington Eagles` (TGID 197), which is an FCS team. It also carries
`CPRE = 0`. It behaves like a free agent that happens to hold a team pointer,
so validation checks that concern head coaches are scoped to the 119 FBS teams.

Of the 93 free agents, 77 have a last name matching an FCS school's short name;
the remaining 16 are `Villa Coach` plus 15 records whose name is just `Coach`.
The pool looks like FCS coaches plus filler to pad the table.

## Prestige

`CPRE` (coach prestige, 1–6) is **identical to `TEAM.TMPR`** (program prestige)
for 119 of the 120 employed coaches — correlation 1.000, the only exception
being the E Washington record. Coach prestige in this save is not an
independent attribute; it is seeded from the program.

This is also the strongest available evidence that `TGID` is decoded correctly.
119 independent exact agreements across two separately parsed tables cannot
happen by accident.

**Re-audit — the "coach prestige" label is untestable in this save.** Because
`CPRE` matches `TMPR` on 119 of 120 rows, no test performed on this file can
distinguish "an independent coach prestige attribute that happens to have been
seeded from the program" from "a plain copy of team prestige". Both readings
predict exactly the data we see. The name is retained because the mnemonic and
the 1–6 range fit, but it should be treated as **unproven**. Resolving it needs
a save in which a coach has moved schools — if `CPRE` follows the coach rather
than the new program, it is genuinely a coach attribute.

## Playbooks

| Field | Bits | Meaning | Agreement with TEAM |
|---|---|---|---|
| `CPID` | 8 | Offensive playbook (**unproven** — see below), 0..124 | `TEAM.TOPB`, 119/120 |
| `CDID` | 8 | Defensive playbook, 125..129 | `TEAM.TDPB`, 108/120 |

The two playbook kinds share one ID space: offensive books occupy 0..124 and
the five defensive books occupy 125..129.

**Offensive playbooks are per-school.** Across the 119 FBS teams there are 119
distinct `CPID` values spanning 0..118 — one book each, none shared, and the ID
is effectively the school's index. This matches the game shipping a named
playbook for every FBS program.

**Re-audit — `CPID` is at risk and should be read as unproven.** The values are
119 distinct, contiguous over 0..118, and **equal the school's alphabetical rank
on 57 of 119 teams** — far above chance. So `CPID` is close to a plain
alphabetical school index, and a "per-school offensive playbook ID" and a
"school index" are indistinguishable when every school has exactly one playbook.
The only thing actually favouring the playbook reading is the `TOPB` mnemonic in
`TEAM`, and a mnemonic is a hint, not evidence. Separating the two requires
either a save where two schools share a playbook, or an unrelated table that
keys off the same index.

**Defensive playbooks are five shared schemes.** Distribution across all 203
teams in `TEAM.TDPB`:

| CDID | Teams |
|---|---|
| 125 | 10 |
| 126 | 26 |
| 127 | 14 |
| 128 | 145 |
| 129 | 8 |

`CDID` disagrees with `TEAM.TDPB` for 12 coaches, which is the expected shape
for a *coach preference* layered over a *team default* — a coach can run a
different front from the one the program is listed with.

### Corroboration from roster shape

The defensive scheme should be visible in how each program stocks its front
seven: a 3-4 uses fewer down linemen and more linebackers than a 4-3. Computing
the DL:LB headcount ratio over each scheme's rosters:

| CDID | DL:LB ratio | Reading |
|---|---|---|
| 125 | 1.07 | 3-4 style |
| 126 | 1.06 | 3-4 style |
| 127 | 1.58 | 4-3 / line-heavy |
| 128 | 1.32 | 4-3 (the default, 145 teams) |
| 129 | 1.24 | mixed |

This is independent evidence from the `PLAY` table that `CDID` really is a
defensive scheme and not an arbitrary index.

## Coaching focus: a three-way percentage split

`CDPC`, `CRPC` and `CTPC` **sum to exactly 100 for all 120 employed coaches**.
An exact three-way constraint holding across 120 records is decisive: these are
percentage allocations of a single budget, not independent ratings.

| Field | Observed range |
|---|---|
| `CDPC` | 26–39 |
| `CRPC` | 30–38 |
| `CTPC` | 28–38 |

**What the three categories are is not confirmed.** The values cluster tightly
around 33 each, consistent with a roughly balanced allocation, but this save
offers nothing to distinguish e.g. a practice-time split from a recruiting-time
split. Naming them would be a guess.

## Tendency fields: sliders vs generated values

Two distinct granularities appear among the tendency fields, which separates
designer-authored settings from generated ones:

| Field | Multiples of 5 | Range | Reading |
|---|---|---|---|
| `CDTA` | 100% | 35–90 | slider |
| `CDTS` | 100% | 40–65 | slider |
| `COTS` | 98% | 40–65 | slider |
| `COTR` | 36% | — | generated |
| `COTA` | 25% | — | generated |
| `CDTR` | 18% | — | generated |

A field where every value lands on a multiple of 5 was almost certainly set by
hand on a coarse UI control; one with arbitrary values was computed.

`COTA` (an offensive tendency) does **not** track roster composition —
correlation with (best QB rating − best RB rating) is **0.082**. Coach
tendencies are authored independently of the players available.

## Other varying fields

Ranges are known; meanings are not. Listed so they are not mistaken for solved:

`CFEX` (0–5), `CTOP` (0–6), `CHAR` (0–5), `CSKI` (0/2/5), `CThg` (0–4),
`CDST` (0–3, with 95 teams at 3), `COST` (0–4), `COHT` (0–2), `COFS` (0/1),
`CCPO`, `COTY`, `CFUC`, `CCTF`, `PTID` (−1/0), `CCFY`, `CBSZ`, `CTgw`.

## Open questions

- The categories behind the `CDPC`/`CRPC`/`CTPC` split.
- The 52 constant fields — career record, contract length, job history. These
  need a save from mid-dynasty; no amount of analysis of this file will
  separate them.
- Whether `CDST`/`COST` are aggressiveness settings or something else; their
  small ranges and heavy clustering are suggestive but not conclusive.

## Validation

`src/validateCoachTable.ts` asserts 16 properties, all passing: record tiling,
`CCID` uniqueness, the 511 sentinel, one-coach-per-team, full FBS coverage,
`CPRE`↔`TMPR` agreement, `CPID`↔`TOPB` agreement and per-school uniqueness,
the `CDID` band, the DL:LB roster correlation, the 100% focus split, and slider
granularity.
