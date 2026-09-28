# TEAM table — schema and semantics

`TEAM` holds one row per program: identity, conference alignment, prestige,
ratings, stadium and rivalry. It is the hub table — `PLAY`, `COCH`, `STAD`,
`SCHD` and the season-stat tables all key off `TGID`.

| | |
|---|---|
| Offset | `0x000D3478` |
| Record length | 184 bytes (1,472 bits) |
| Records | 203 used of 446 allocated |
| Fields | 112, tiling bits 0–1463 (8 bits padding) |

Unlike `PLAY`, `TEAM` decoded correctly on the first attempt — the format work
was already done, so this was purely semantic.

---

## Identity

| Field | Bits | Meaning |
|---|---|---|
| `TGID` | 9 | **Team id, primary key.** 1–231, assigned alphabetically |
| `TOID` | 9 | Duplicate of `TGID` in all 203 rows |
| `TDNA` | 176 | **School name** — "Air Force", "Ohio State" |
| `TMNA` | 144 | **Nickname** — "Falcons", "Buckeyes" (5 teams have none) |
| `TSNA` | 56 | Short name — "AF", "Bama" |
| `TTYP` | 3 | **Division: 0 = FBS (119 teams), 1 = FCS (84)** |

`TGID` being alphabetical is a trap: any small-integer field will appear to
"match" it. Never treat agreement with `TGID` alone as evidence.

Five rows (`1AA East`, `1AA Midwest`, `1AA Northwest`, `1AA Southeast`,
`1AA West`) are generic filler opponents with no stadium and no roster.

**Player link:** `PLAY` has no `TGID` column. A player's team is encoded
arithmetically in `PGID` — see the PLAY schema doc. `TTYP` independently
reproduces the same 119/84 split, confirming both derivations.

---

## Conference and scheduling

| Field | Bits | Meaning |
|---|---|---|
| `CGID` | 5 | **Conference id** → `CONF.CGID`. All 203 rows resolve; 22 conferences |
| `DGID` | 4 | **Division within conference** |
| `TMRV` | 9 | **Rival team** → `TGID`. 202/203 resolve, 129 mutual |
| `SGID` | 8 | **Home stadium** → `STAD.SGID`. All 119 FBS teams resolve |

`DGID` reproduces the 2006 alignments exactly — SEC East (Florida, Georgia,
Kentucky, South Carolina, Tennessee, Vanderbilt) and West (Alabama, Arkansas,
Auburn, LSU, Mississippi State, Ole Miss), and likewise for the Big 12 and ACC.

`TMRV` recovers real rivalries: Ohio State↔Michigan, Army↔Navy,
Alabama↔Auburn, Texas→Texas A&M, USC→UCLA, Florida→Florida State,
Georgia→Georgia Tech, Oregon→Oregon State, Clemson→South Carolina,
Notre Dame→USC. Asymmetry is expected — Oklahoma's rival is Texas, but Texas'
is Texas A&M.

---

## Prestige

| Field | Bits | Meaning |
|---|---|---|
| `TMPR` | 3 | **Program prestige, 1–6 stars** |
| `TMAR` | 4 | **Academic prestige, 1–6** |

These are easy to confuse; they measure different things.

**`TMPR` = 6** (12 teams): Florida, Florida State, Georgia, LSU, Miami,
Michigan, Notre Dame, Ohio State, Oklahoma, Tennessee, Texas, USC — the 2006
blue bloods.

**`TMAR` = 6** (5 teams): Cal, Duke, Michigan, Northwestern, Stanford. At 5:
Air Force, Army, Navy, Notre Dame, Rice, Vanderbilt, Georgia Tech, Virginia.
This is unmistakably academic reputation, not athletic strength — Duke and
Northwestern rank top while sitting near the bottom of `TMPR`.

**Re-audit — confirmed.** `TMPR` and `TMAR` correlate at only **0.418**, so they
are genuinely independent quantities rather than two views of one number. The
split runs the right way in both directions: academic-leaning schools carry a
much higher `TMAR` than `TMPR` (Army 5 v 1, Duke 6 v 2, Navy 5 v 1, Rice 5 v 1,
Air Force 5 v 2), while athletic powers invert it (LSU 3 v 6, and Florida, FSU,
Georgia and Miami all 4 v 6). Decisively, `TMPR` predicts on-field strength
(`corr(TMPR, TROV) = 0.784`) and `TMAR` largely does not (`0.317`).

---

## Ratings

Team ratings are stored as **plain 0–99 values in 8-bit fields** — they do *not*
use the 5-bit quantised scale that player ratings use.

| Field | Meaning | Correlation with roster strength |
|---|---|---|
| `TROV` | **Team overall** | **0.978** |
| `TRDE` | Defense | 0.932 |
| `TROF` | Offense | 0.889 |
| `TRDL` | Defensive line | 0.861 |
| `TROL` | Offensive line | 0.845 |
| `TRDB` | Defensive backs | 0.817 |
| `TRLB` | Linebackers | 0.816 |
| `TWRR` | Wide receivers | 0.746 |
| `TRST` | Special teams | 0.672 |
| `TRRB` | Running backs | 0.660 |
| `TRQB` | Quarterbacks | 0.553 |

Correlation is against the mean overall of each team's top 25 players, computed
from `PLAY` via the decoded rating scale. `TROV` at 0.978 across 119 teams is
about as strong as this kind of relationship gets.

### Unit ratings — discriminating re-audit

The figures above measure each unit rating against the **whole roster**, which
is the wrong comparison and badly understates the position-group fields. It also
proves nothing: every unit rating correlates with overall roster strength, so
that test cannot tell `TRQB` from `TRRB`.

The discriminating test is: does each unit rating correlate better with **its
own** position group than with any other group? A mislabelled or swapped field
fails this. **All 7 passed**, most by a wide margin:

| Field | Unit | corr. with own unit | best other unit | Margin |
|---|---|---|---|---|
| `TROL` | Offensive line | **0.908** | 0.762 | +0.146 |
| `TRLB` | Linebackers | **0.900** | 0.717 | +0.183 |
| `TRDB` | Defensive backs | **0.898** | 0.719 | +0.179 |
| `TRDL` | Defensive line | **0.883** | 0.737 | +0.146 |
| `TWRR` | Wide receivers | **0.782** | 0.687 | +0.095 |
| `TRQB` | Quarterbacks | **0.750** | 0.468 (`TRDL`) | +0.282 |
| `TRRB` | Running backs | **0.694** | 0.546 | +0.148 |

Unit strength here is the **mean displayed overall of every player in the group**
across all 119 FBS teams; this is what `validateTeamTable.ts` computes, so the
figures are reproducible. Restricting each group to its likely starters raises
every value (`TRQB` reaches 0.874, `TRRB` 0.907, `TROL` 0.972) but does not change
the outcome — own-unit wins 7/7 either way, which is the part that matters.

`TRQB` is the headline correction: measured against the quarterbacks it actually
describes it scores **0.750**, not the 0.553 in the table above. It also has the
largest margin over its nearest rival of any unit rating — unsurprising, since QB
play is the least correlated with general roster depth.

---

## Stadium

| Field | Bits | Meaning |
|---|---|---|
| `TMAA` | 17 | **Average attendance** (not capacity — see below) |
| `TMIA` | 7 | Attendance-related, 56–110; exact meaning unresolved |
| `TEZ1` / `TEZ2` | 9 | End-zone art ids |
| `SGID` | 8 | Stadium id → `STAD` |

### Correction: `TMAA` is attendance, not capacity

This field was originally documented here as **stadium capacity**, on the
strength of its top values coming out as Michigan 111,263 → Penn State 109,427 →
Tennessee 107,200 → Ohio State 105,122 — the exact real-world ordering of the
largest college stadiums.

That ordering is real, but it does not distinguish capacity from attendance:
the biggest stadiums also draw the biggest crowds, so both readings predict the
same ranking. Decoding `STAD` later supplied the discriminator.

`STAD.SCAP` is the real capacity, and it **differs from `TMAA` on all 119 FBS
teams**:

| School | `TMAA` | `STAD.SCAP` | Fill |
|---|---|---|---|
| Michigan | 111,263 | 107,501 | 103% |
| Alabama | 93,970 | 92,128 | 102% |
| Akron | 13,812 | 31,000 | 45% |
| Florida Atlantic | 5,882 | 20,450 | 29% |

`SCAP` matches published 2006 capacities **exactly** for seven stadiums tested
(Michigan 107,501, Beaver 107,282, Neyland 104,079, Ohio Stadium 101,568, Ben
Hill Griffin 88,548, Jordan-Hare 87,451, Camp Randall 80,321), which `TMAA` does
not.

The decisive test is that **fill rate rises monotonically with program
prestige** — 1-star 50%, 2-star 62%, 3-star 84%, 4-star 93%, 5-star 94%, 6-star
99%. Attendance depends on how good a team is; the size of a building does not.
Fill rate also stays inside a physically sensible 29%–104% band, with the 24
teams above 100% being exactly the traditional powers where standing room
exceeds the listed figure.

The earlier claim that "Florida Atlantic's 5,882 is a real capacity" was wrong
in detail: that was their average attendance. Lockhart Stadium held ~20,450.

`TMIA` was previously guessed to be a minimum-attendance percentage. It
correlates strongly with the fill rate (0.942) but equals
`round(TMAA / SCAP × 100)` on only 6 of 119 teams, so it is attendance-related
but **not** simply that ratio. Left unresolved rather than guessed at.

---

## Season statistics

Sixteen 16-bit counters at bits 0–255 hold season totals — `TCPA`/`TDPA`/`TSPA`
(points against splits), `TCPF`/`TDPF`/`TSPF` (points for), `TFFB`/`TFOB`,
`TFFG`/`TFOG`, `TFRD`, `TFOR`, `TCPT`, `TMPT`, `TMCP`. The lowercase block
(`tsal`, `tsbl`, `tscl`, `tsdl`, `tshl`, `tscs`, `tsns`, `tsaw`, `tsbw`, `tscw`,
`tsdw`, `tshw`) is mostly 0/1 flags — likely per-season bowl or title markers.
These are un-verified; a dynasty save mid-season would be needed to confirm.

---

## Cross-table links (all verified)

| From | To | Result |
|---|---|---|
| `TEAM.CGID` | `CONF.CGID` | 203/203 |
| `TEAM.SGID` | `STAD.SGID` | 119/119 FBS |
| `TEAM.TMRV` | `TEAM.TGID` | 202/203 |
| `COCH.TGID` | `TEAM.TGID` | 120/121 |
| `STTM.TGID` | `TEAM.TGID` | 203/203 |

---

## Validation

`src/validateTeamTable.ts` — 16 checks, all passing. The notable ones assert
external ground truth rather than internal consistency: known rivalries, the
2006 SEC divisional split, blue-blood prestige, academic ranking, and Michigan
owning the largest stadium.

---

## Open questions

- **`JJNM`** (104 bits, FBS-only) is **not a string** despite exceeding the
  32-bit width threshold — 0 of 119 values are printable ASCII and the bytes
  look high-entropy. Present for exactly the 119 FBS teams. Possibly packed
  uniform or jersey data.
- **`TPIP`** (56 bits) is likewise non-text; only 58 rows are non-zero.
- `TCHS`, `TCHT`, `TCHW`, `TCHL` (10 bits each) are coach-related but
  unconfirmed; `TCHS` saturates at 1023 for many teams.
- `TDPB` (125–129) and `TOPB` (0–124) have oddly narrow ranges.
- The lowercase `ts**` block is presumed per-season flags.
- `TSCS` looked like a prestige candidate but is a false positive — its
  255/1/0 distribution does not track program strength.

Note that the string-detection heuristic (`bits > 32` implies text) produces
false positives. Any wide field should be checked for printability before its
decoded text is trusted.
