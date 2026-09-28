# SCHD Table — Schema and Semantics

The season schedule. One record per game slot, regular season and postseason.

| Property | Value |
|---|---|
| Offset | `0x000CF2E4` |
| Data offset | `0x000CF3E4` |
| Records | 785 used of 800 allocated |
| Record length | 16 bytes (128 bits) |
| Fields | 14 |
| Bit coverage | 0..103, then 24 bits of padding |

This is the most completely solved table in the file. **All 14 fields are
identified**, and 25 semantic checks pass. It is also the easiest table to
validate, for two reasons: a football schedule must obey hard structural rules
(nobody plays twice in a week, nobody plays themselves), and the 2006 season is
a matter of public record.

## Field map

| Field | Bits | Meaning |
|---|---|---|
| `GTOD` | 16 | Kickoff time, minutes past midnight |
| `GATG` | 16 | Away team → `TEAM.TGID`, or 511 = TBD |
| `GHTG` | 16 | Home team → `TEAM.TGID`, or 511 = TBD |
| `GSTA` | 8 | Result: 0 = unplayed, 1 = away won, 2 = home won |
| `GASC` | 8 | Away score |
| `GHSC` | 8 | Home score |
| `GDAT` | 8 | Day of week, Monday-based (0 = Mon … 5 = Sat, 6 = Sun) |
| `SEWT` | 8 | Week *type* — tracks `SEWN` in the regular season, then postseason codes |
| `SGNM` | 7 | Game index within the week, 0..n−1 |
| `SEWN` | 5 | Week number, 0..21 |
| `GFOT` | 1 | Unset in this save (0/785) — unidentified |
| `GFFU` | 1 | User-team game |
| `GFHU` | 1 | User-team game |
| `GMFX` | 1 | Conference game |

## `GSTA` is the winner, not a status

The obvious reading of an 8-bit field with values {0, 1, 2} next to two score
columns is "game status". That reading is wrong, and the data says so
unambiguously:

| `GSTA` | Games | Home team won |
|---|---|---|
| 0 | 717 | — (all 0–0) |
| 1 | 20 | **0 / 20** |
| 2 | 48 | **48 / 48** |

A status field would have no reason to correlate perfectly with the outcome.
`GSTA` is the result: **0 = not yet played, 1 = away team won, 2 = home team
won**. Score and winner are stored redundantly, which is convenient for
validation — the two must always agree.

Supporting checks: no completed game is a tie (overtime makes ties impossible in
college football), and no score is exactly 1 (unreachable in football scoring).

## The 511 sentinel, shared with COCH

`GATG` and `GHTG` use the same `NO_TEAM = 511` sentinel already seen in
`COCH.TGID`. Here it means **the participants are not yet determined**. All 34
sentinel rows have it on *both* sides, and all sit in the postseason — they are
empty bowl slots waiting for the season to be played.

(This is also why an early naive check reported "a team is playing itself": two
511s compared equal. Excluding sentinel rows, 0 of 751 real matchups are
self-games.)

## Season structure

`SEWN` is the week number. `SEWT` is the week *type*: it equals `SEWN` exactly
through week 13, then switches to a sparse code for the postseason. That is why
the two fields look like duplicates until they suddenly diverge.

| `SEWN` | `SEWT` | Slots | Meaning |
|---|---|---|---|
| 0–13 | 0–13 | 751 | Regular season |
| 15 | 15 | 5 | Conference championships |
| 18 | 30 | 6 | Bowls, early |
| 19 | 31 | 14 | Bowls, main |
| 20 | 32 | 8 | Bowls, New Year's Day |
| 21 | 40 | 1 | BCS National Championship |

**The week-15 slot count is exactly 5.** The 2006 season had exactly five
conference championship games — ACC, Big 12, Conference USA, MAC and SEC. The
other six conferences did not stage one. An arbitrary decoding would not land on
that number.

Week 13 holds only 12 games, and Army–Navy is one of them — that game is
traditionally played a week after the rest of the regular season finishes.

## `GDAT` is Monday-based

Saturday dominates (691 of 785), which identifies index 5 but not the origin.
The eight week-20 bowl slots settle it: they all carry `GDAT=0`, and those are
the New Year's Day games. **January 1 2007 fell on a Monday**, so 0 = Monday and
the week runs Monday → Sunday.

| Day | Games |
|---|---|
| Monday | 9 |
| Tuesday | 8 |
| Wednesday | 7 |
| Thursday | 38 |
| Friday | 29 |
| **Saturday** | **691** |
| Sunday | 3 |

Thursday being the clear second-place day matches mid-week MAC scheduling.

## `GTOD` is a kickoff time

Minutes past midnight. Every one of the 785 values is a multiple of 15, spanning
660 (11:00am) to 1320 (10:00pm). The three most common values are 930 (3:30pm,
265 games), 750 (12:30pm, 256) and 1080 (6:00pm, 228) — the classic
early/afternoon/night television windows.

## `GMFX` marks conference games

All 457 flagged games are between teams sharing a `TEAM.CGID` — 100%, no
exceptions.

In the other direction there are four unflagged games that *look*
same-conference: Notre Dame–Navy, Navy–Army, Temple–Navy and Army–Notre Dame.
All four are between **Independents**, who share a `CGID` bucket but by
definition play no conference games. The exception confirms the rule rather
than undermining it.

## FBS / FCS scheduling

- **All 119 home teams are FBS schools.** Home-team ids number 119; away-team
  ids number 176.
- The 57 teams appearing *only* as visitors are all non-FBS.
- Of the 75 games involving a non-FBS opponent, **75 are played at the FBS
  school** — a perfect match for how guarantee games work in reality.

Per-team integrity: no team plays twice in a week, home games range 4–8, and 118
of 119 teams play 12 games. San Jose State plays 11, which is a legitimate
schedule quirk rather than a decoding error.

## The user's team

`GFFU` and `GFHU` are both set on exactly the same 12 games — every Washington
Huskies game. This save is a **Washington dynasty**.

Because both flags are set identically on all 12 games regardless of whether
Washington is home or away, **these two fields cannot be told apart from this
save alone.** The natural guess is "away team is user" / "home team is user",
but that is contradicted here: both are 1 in both situations. Resolving them
needs a save with two user-controlled teams.

`GFOT` is 0 for all 785 games and is unidentified.

## Current save state

The dynasty has advanced into week 0, which has 71 games. 68 have been simmed;
three remain unplayed:

- Kentucky @ Louisville
- Florida State @ Miami
- **E Washington @ Washington** — the user's own game, awaiting play

That is exactly the expected state: advancing a week sims every game except the
ones the user intends to play.

## Open questions

- `GFOT` — never set in this save.
- Separating `GFFU` from `GFHU`.
- Whether bowl slots gain a tie-in identifier once the postseason is reached;
  all 34 are currently blank apart from date and kickoff time.

## Validation

`src/validateScheduleTable.ts` asserts 25 properties, all passing: bit tiling,
team-reference resolution, no self-games, FBS-only hosts, guarantee-game
direction, no double-booking, slate size, home/away balance, `GSTA`-as-winner,
score sanity (no ties, no scores of 1), day index with the Monday anchor,
kickoff granularity, `SGNM` contiguity, the five conference championships, the
single national title game, postseason participants all TBD, the `SEWN`/`SEWT`
relationship, `GMFX` conference agreement plus the Independent exception,
rivalry presence and end-of-season clustering, and Army–Navy in the final week.
