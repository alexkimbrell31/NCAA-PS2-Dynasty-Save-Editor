# AAPL — All-Conference and All-America Selections

`AAPL @ 0x00162E90` — **650 / 3406 records, 6 fields, 8 bytes each.**

The most regular table in the file. 650 factors exactly as
**13 squads × 2 tiers × 25 slots**, and that factorisation is itself the
identification of `CGID`, `TTYP` and `PPOS` — nothing has to be assumed.

## Schema

| Field  | Bit | Width | Type | Meaning |
|--------|-----|-------|------|---------|
| `PGID` | 0   | 16    | 3    | Player — foreign key into `PLAY`, resolves 650/650 |
| `CGID` | 16  | 5     | 3    | Squad — a `CONF.CGID`, plus one pseudo-conference |
| `TTYP` | 21  | 3     | 3    | Tier: 0 = first team, 1 = second team |
| `SEYR` | 24  | 6     | 3    | Season index — 0 throughout |
| `PPOS` | 30  | 5     | 3    | The **slot** filled on the team sheet |
| `ARET` | 35  | 1     | 3    | Return-specialist designation |

Note `TTYP` reuses a tag from `TEAM`, where it means FBS/FCS. Here it does not.

## Findings

### The 25-slot template

All 21 positions appear. Seventeen get one slot per squad; four get two:
**HB, WR, DT, CB** — the positions a base formation fields two of.
17 + 4×2 = 25. Every one of the 26 (squad, tier) buckets holds exactly 25.

This is an independent confirmation of `PLAYER_POSITIONS`, after PLGA's.

### `TTYP` ordering is established, not assumed

Mean raw `POVR` is 22.3 for tier 0 against 19.2 for tier 1, so tier 0 really is
the first team rather than merely the first label.

### `CGID 15` is not a conference

Twelve squads are genuine conferences, and in those, every player sits in the
squad of his own conference — 600/600. The thirteenth, `CGID 15` (`CONF` names
it `Historic`), draws its 50 players from **12 different real conferences**. No
conference does that. It is the All-America squad.

It is also the only source of repeat selections: exactly 50 players appear
twice — once for their conference, once for All-America — and nobody appears
three times.

### Only FBS conferences get a team

All 650 selections are FBS players. The twelve `CONF` rows with no squad are the
FCS conferences and placeholders: Ivy League, MEAC, SWAC, Fantasy, Generic,
Atlantic 10, Big Sky, Gateway, Southern, Southland, Ohio Valley, High School.
Consistent with DIVI (divisions are FBS-only) and PLGA (FCS rosters are
generated, not stored).

### `PPOS` is the slot, not the player

`AAPL.PPOS` matches `PLAY.PPOS` on 647/650. The three that differ are players
selected out of position. This is the same shape of small, honest disagreement
PLGA showed against PLAY, and the validator asserts it rather than hiding it.

### `ARET`

25 rows are flagged, spread across 25 of the 26 (squad, tier) buckets — at most
one per squad, always at HB, WR or CB. The single bucket with no flag is the
All-America **first** team. Recorded as an anomaly, not explained.

## Open questions

- Why the All-America first team has no `ARET` selection.
- Whether `CONF`'s name for `CGID 15` (`Historic`) carries any meaning beyond
  being the slot the game parks its cross-conference squad in.

## Validation

`src/validateAllConferenceTable.ts` — **16/16 checks pass.**
`src/dumpAllConferenceTable.ts` writes `out/AAPL.csv` and
`analysis/allconference_schema.json`.
