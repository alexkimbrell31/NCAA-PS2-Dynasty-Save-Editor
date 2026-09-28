# DIVI — Conference Divisions

`DIVI @ 0x000135E8` — **10 / 10 records, 3 fields, 24 bytes each.**

The smallest table in the file, and the only one so far that is essentially
**self-labelling**: `DNAM` is plain text that names the row's own conference,
so the numeric `CGID` in the same record has an independent witness sitting
next to it. No outside knowledge is needed to identify any of the three fields.

Its real value is leverage on a *different* table: DIVI is what finally proves
`TEAM.DGID` is a division foreign key, and that `DGID = 15` is a sentinel.

## Schema

| Field  | Bit | Width | Type | Meaning |
|--------|-----|-------|------|---------|
| `DNAM` | 0   | 160   | 3    | Division name, plain text, `"<Conference> (<Division>)"` |
| `CGID` | 160 | 5     | 3    | Conference id — foreign key into `CONF.CGID` |
| `DGID` | 165 | 4     | 0    | Division id — primary key, dense `0..9` |

Fields tile bits 0..168 cleanly; 23 bits of padding to the 24-byte record.

## Contents

| DGID | DNAM | Conference | Members |
|------|------|-----------|---------|
| 0 | Big 12 (North) | Big 12 | Colorado, Iowa State, Kansas, Kansas State, Missouri, Nebraska |
| 1 | Big 12 (South) | Big 12 | Baylor, Oklahoma, Oklahoma State, Texas, Texas A&M, Texas Tech |
| 2 | MAC (East) | MAC | Akron, Bowling Green, Buffalo, Kent State, Miami University, Ohio |
| 3 | MAC (West) | MAC | Ball State, Central Michigan, Eastern Michigan, Northern Illinois, Toledo, Western Michigan |
| 4 | SEC (East) | SEC | Florida, Georgia, Kentucky, South Carolina, Tennessee, Vanderbilt |
| 5 | SEC (West) | SEC | Alabama, Arkansas, Auburn, LSU, Mississippi State, Ole Miss |
| 6 | ACC (Atlantic) | ACC | Boston College, Clemson, Florida State, Maryland, NC State, Wake Forest |
| 7 | ACC (Coastal) | ACC | Duke, Georgia Tech, Miami, North Carolina, Virginia, Virginia Tech |
| 8 | C-USA (East) | C-USA | ECU, Marshall, Memphis, Southern Miss, UAB, UCF |
| 9 | C-USA (West) | C-USA | Houston, Rice, SMU, Tulane, Tulsa, UTEP |

Every membership is the real 2006 alignment, team for team.

## Findings

### `DGID = 15` is a sentinel, not an eleventh division

143 of the 203 teams in `TEAM` carry `DGID = 15`. This is *not* a division:

- `DIVI` has no row 15.
- The 143 teams span **17 different conferences**. A division belongs to one
  conference, so a value shared by seventeen of them cannot be one.
- `DGID` is 4 bits wide and 15 is all-ones — the format's standard "no value"
  encoding, exactly as `BOWL.SGID = 255` is in 8 bits.

Exposed as `DIVISION_NONE` with a `hasDivision()` helper in `eadb.ts`.

### `TEAM.DGID` really is a division reference

The discriminating test — the one that rules out DGID being a region, a pod, a
scheduling bucket or a playoff group — is that **a team's division must belong
to the team's own conference**. It does, 60/60. A geographic or scheduling
grouping would not have to respect conference boundaries, and in 2006 several
of these divisions (Big 12 North/South, ACC Atlantic/Coastal) are *not* clean
geographic splits, so the agreement is not free.

Supporting structure: every division holds exactly six teams, all ten are
occupied, and no conference is partially divided.

### BOWL predicted this table

`BOWL` was solved first, and contains five conference championship games —
rows where both tie-in slots draw from the same conference. A title game only
makes sense for a conference that has divisions to crown winners of.

DIVI says the split conferences are {ACC, Big 12, C-USA, MAC, SEC}.
BOWL says the title-game conferences are {ACC, Big 12, C-USA, MAC, SEC}.

Two independently decoded tables, same five. This was a genuine prediction, and
it is also correct history: the Big Ten, Big East and Pac-10 all played without
divisions or a championship game in 2006, and DIVI correctly omits all three.

### Divisions are FBS-only

All 60 divided teams have a roster in `PLAY` (60/60). The FCS conferences
present in `TEAM` — Ivy League, MEAC, SWAC, Big Sky, Gateway, Southern,
Southland, Ohio Valley, Atlantic 10 — all carry the sentinel, even though
several of them genuinely did play in divisions in reality. The game does not
model FCS division structure, consistent with the PLGA finding that FCS rosters
are generated rather than stored.

## Open questions

None. All three fields are identified, every value is accounted for, and the
sentinel is explained.

## Validation

`src/validateDivisionTable.ts` — **17/17 checks pass.** Covers structure, key
density, the text-vs-numeric `CGID` agreement, division sizes, conference
containment, the sentinel argument, the BOWL cross-check, FBS membership, and
the full 2006 alignment as ground truth.

`src/dumpDivisionTable.ts` writes `out/DIVI.csv` and
`analysis/division_schema.json`.
