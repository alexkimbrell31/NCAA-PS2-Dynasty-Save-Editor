# BOWL Table — Schema and Semantics

The postseason. One record per bowl game and conference championship game.

| Property | Value |
|---|---|
| Offset | `0x000002B0` |
| Data offset | `0x000003D0` |
| Records | 34 of 34 allocated |
| Record length | 44 bytes (352 bits) |
| Fields | 16 |
| Bit coverage | 0..339, then 12 bits of padding |

BOWL is the first table in the file and one of the smallest, but it is where
`SCHD` stops being incomplete. `SCHD` carries 34 game slots whose participants
are all `NO_TEAM`; BOWL holds exactly those 34 and says what each one *is*.

**All 16 fields are accounted for. Twelve are identified; four are reported as
unidentified per-bowl ids.** 34 semantic checks pass.

## Field map

| Field | Bits | Meaning |
|---|---|---|
| `BMFD` | 16 | Per-bowl id, 147..236 — **unidentified** |
| `GTOD` | 16 | Kickoff time, minutes past midnight (same units as `SCHD.GTOD`) |
| `BLGO` | 16 | Per-bowl id, 0..34 — **unidentified** |
| `SGID` | 8 | Venue → `STAD.SGID`, or 255 = site undetermined |
| `BNME` | 224 | Bowl name |
| `BIDX` | 8 | Row index, 0..33 |
| `BCI1` | 5 | First tie-in conference → `CONF.CGID` |
| `BCR1` | 4 | First tie-in finishing position (1 = champion), 0 = at-large |
| `BCI2` | 5 | Second tie-in conference → `CONF.CGID` |
| `BCR2` | 4 | Second tie-in finishing position, 0 = at-large |
| `UTID` | 7 | Per-bowl id, sparse in 1..80 — **unidentified** |
| `SGNM` | 7 | Game index within the week → joins `SCHD.SGNM` |
| `BMON` | 4 | Month, 12 or 1 |
| `SEWN` | 5 | Week number → joins `SCHD.SEWN` |
| `BPLO` | 6 | Per-bowl id, 0..34 — **unidentified** |
| `BDAY` | 5 | Day of month |

## The join to SCHD

`(SEWN, SGNM)` is the shared key. All 34 BOWL records land on a distinct `SCHD`
slot, and `SCHD` has exactly 34 slots with both participants undetermined —
there is nothing left over on either side.

A matching count alone would prove nothing. What makes the join real is that
the two tables agree on things they could have disagreed about:

- **Kickoff time** — `GTOD` is byte-identical on all 34.
- **The calendar** — `SCHD.GDAT` is a weekday index with no year attached;
  `BOWL.BMON`/`BDAY` is a date with no weekday attached. Combining them,
  the Monday-based reading of `GDAT` gives the correct real weekday for
  **34 of 34** dates, spanning Tuesday through Sunday.

That second point retroactively strengthens `SCHD`. `GDAT`'s origin had been
anchored on a single observation — the eight New Year's Day slots all carry
`GDAT = 0`, and January 1 2007 was a Monday. It is now a 34-point fit.

## `SGID = 255` means the site is not yet known

Thirty-two of the 34 venues resolve directly into `STAD`, and the cities are
right: Rose Bowl → Pasadena, Sugar Bowl → New Orleans, Orange Bowl → Miami.

Two carry `SGID = 255`, the maximum value of the 8-bit field — the shape of a
sentinel. The two are:

- the **Conference USA championship game**, which is hosted by the
  higher-seeded division winner, and
- the **BCS national championship game**, which has no permanent home.

Those are precisely, and only, the two postseason games in 2006 whose site
genuinely could not be known before the season was played. A sentinel landing
on arbitrary rows would have been a decoding error. Landing on exactly these
two is the strongest single piece of evidence in the table.

## Conference tie-ins

`BCI1`/`BCR1` and `BCI2`/`BCR2` are (conference, finishing position) pairs.
Position 1 is the conference champion, 2 the runner-up, and so on down to 8.
The decoded tie-ins reproduce the 2006 bowl structure:

| Bowl | Tie-in |
|---|---|
| Rose Bowl | Big Ten #1 v Pac-10 #1 |
| Orange Bowl | ACC #1 v Big East #1 |
| Sugar Bowl | SEC #1 v at-large |
| Fiesta Bowl | Big 12 #1 v at-large |
| Capital One Bowl | Big Ten #2 v SEC #2 |
| Cotton Bowl | Big 12 #2 v SEC #3 |
| Chick-fil-A Bowl | ACC #2 v SEC #5 |
| Holiday Bowl | Pac-10 #2 v Big 12 #3 |
| Alamo Bowl | Big Ten #4 v Big 12 #5 |
| Liberty Bowl | C-USA #1 v SEC #8 |
| Las Vegas Bowl | Mountain West #1 v Pac-10 #4 |

The Rose Bowl entry is worth singling out: Big Ten champion against Pac-10
champion is the oldest and most rigid arrangement in the sport, and it is the
kind of thing an incorrect field assignment could not produce by accident.

### At-large berths

An unanchored berth is stored as conference `Generic` (`CGID = 17`) with
position 0. The two encodings co-occur perfectly — every `Generic` has rank 0
and every rank 0 is `Generic` — which is what makes "at-large" a reading rather
than a guess. There are five such berths, on exactly the slots that are
genuinely unanchored: the Sugar and Fiesta Bowls' second team, the Poinsettia
Bowl's second team, and **both** sides of the national championship game.

### Structural sanity

Every bowl-eligible conference claims positions 1..n with no holes: a
conference cannot send its #3 and #5 while skipping its #4. The deepest is
eight berths. No bowl pairs a conference with itself — except the championship
games, where that is the whole point.

## Conference championship games

Five rows have the same conference on both sides, both at position 1. That is
not a contradiction: a championship game takes the two division winners, each
of which tops its own division.

| Game | Date | Venue |
|---|---|---|
| ACC Championship | 12/2 | ALLTEL Stadium, Jacksonville |
| Big 12 Championship | 12/2 | Arrowhead Stadium, Kansas City |
| C-USA Championship | 12/2 | TBD |
| MAC Championship | 12/2 | Ford Field, Detroit |
| SEC Championship | 12/2 | Georgia Dome, Atlanta |

**Exactly five, and the right five.** The 2006 season had five conference
championship games — ACC, Big 12, C-USA, MAC and SEC — and the other six
conferences staged none. The host cities match reality on all four that had a
fixed site. `SCHD` had independently found five week-15 slots; BOWL names them.

## Season shape

| Week | Slots | Dates |
|---|---|---|
| 15 | 5 | Dec 2 — conference championships |
| 18 | 6 | Dec 19–23 |
| 19 | 14 | Dec 24–30 |
| 20 | 8 | Jan 1 — the New Year's Day slate |
| 21 | 1 | Jan 8 — national championship |

The weeks are strictly date-ordered, and the Jan 1 slate holds exactly eight
games: Cotton, Outback, Gator, Capital One, Rose, Fiesta, Sugar and Orange.

## The four unidentified fields

`BMFD`, `BLGO`, `BPLO` and `UTID` are each unique across all 34 rows. That is
the weakest possible evidence — so are `BIDX`, `BNME` and `SGID`. None of them
resolves against another table, and no ordering of them predicts anything else
in the save, so they are reported rather than labelled.

What *is* known about them:

- **`BLGO` and `BPLO`** both run 0..34 with a single unused slot (27 and 24
  respectively). Sorted, they produce nearly the same list — roughly
  alphabetical among the bowls, with the championship games and a few
  late-additions placed differently in each. Two parallel asset orderings is
  the natural reading, and the mnemonics point at artwork, but nothing in this
  save separates one from the other.
- **`BMFD`** runs 147..178 (missing 172) plus 233, 234, 236, and its ordering
  matches `BLGO`'s. It sits inside `STAD`'s neutral-site `SGID` range and
  equals `SGID + 1` on 22 of 34 rows, which is tempting — but it resolves to
  the *wrong* stadium every time it resolves, and it is not a `STAD` row index
  either (0/34). It is a separate id space that happens to overlap.
- **`UTID`** is the interesting one. Its values are 1, 2, 4, 6, 7, 10, 13–38,
  79, 80, and **all 34 resolve as a `TEAM.TGID`**. They mean nothing as teams:
  Air Force sits on the national championship, Akron on the ACC championship.
  `TGID` is dense over 0..119, so *any* small distinct set resolves against it
  for free. This is the clearest example yet of evidence that is real and
  entirely non-discriminating.

## Open questions

- Separating `BLGO` from `BPLO`, and identifying `BMFD`.
- What `UTID` indexes. The gaps below its maximum suggest a master list of
  around 80 postseason games from which this dynasty's 34 were drawn.
- Whether any of these fields become writable in a meaningful way — none of
  them changes during a season, so a second save would not help.

## Validation

`src/validateBowlTable.ts` asserts 34 properties, all passing: bit tiling, the
table being exactly full, `BIDX` contiguity, name uniqueness, the `SCHD` join
on `(SEWN, SGNM)`, kickoff agreement, the date/weekday cross-check, month and
day-of-month ranges, the eight-game New Year's slate, the title game being last,
week/date ordering, venue resolution and the two-sentinel argument, neutral-site
venues, conference resolution, the at-large encoding, tie-in position ranges,
contiguous conference runs, distinct conferences per bowl, the five championship
games with their #1-v-#1 seeding and host cities, the Rose, Orange, Sugar and
Fiesta tie-ins, the unanchored title game, kickoff granularity, and explicit
non-identification of `BMFD`, `BLGO`, `BPLO` and `UTID` including the `UTID`
coincidence.
