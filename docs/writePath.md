# Write Path

Status: **reads and writes are byte-exact; the two unknown dwords are untested
against the game.**

## Guarantees

The write path does not rebuild the file. Field edits cannot change a record's
length, so the TOC, the 82 table headers and every descriptor block are left
exactly as found, along with the 60-odd tables we have never decoded and the
623 KB of trailing zero padding. Edits are bit-patched into a copy of the
original buffer.

Two gates enforce this.

### Gate 1 — `verifyRoundTrip.ts`: can we write *nothing* correctly?

Every field of every record of all 82 tables is decoded and immediately written
back. The result must be byte-identical to the original.

```
Re-encoded 928,176 field values across 22,870 records in 82 tables.
IDENTICAL: all 2,161,664 bytes match.
```

This is the strongest single test in the project. It is not a test of the write
code alone — it exercises all 928,176 field descriptors simultaneously, so any
bit-order error, off-by-one offset, sign-extension mistake or field overlap
surfaces as a concrete differing byte with a table and field name attached.

It found three real bugs that reading alone had hidden for five tables:

| Bug | Symptom | Root cause |
|---|---|---|
| `TEAM.TPIP`, `TEAM.JJNM` destroyed | 276 bytes differed | The `bits > 32 ⇒ string` rule is **wrong**. These fields are binary; decoding them as text truncated them at the first NUL and re-encoding erased the rest. |
| `COCH.CLLN` rejected | 153 write errors | A string that exactly fills its field has **no NUL terminator**. "Bama St Coach" is 13 characters in a 13-byte field. |
| `STAD.SNAM` corrupted | 1 byte, `0xB1 → 0x31` | Node's `'ascii'` encoding **masks bit 7**. Decoding and re-encoding silently cleared the high bit. Fixed by using `latin1`, a lossless 1:1 byte mapping. |

The third one also explains a long-standing cosmetic oddity. Stadium names were
recorded as having stray trailing digits — `Georgia Dome1`, `ALLTEL Stadium0`,
`Sun Devil0 Stadium`. Those digits do not exist. They are `0xB0`/`0xB1` bytes
being masked down to `'0'`/`'1'` by the ASCII decoder.

Field classification is now decided by **inspecting the bytes**, not the width:
a wide field is text only if no sampled record contains a control character
before its terminator, and at least one record holds a plausible string. High
bytes are allowed; an all-NUL sample is treated as binary so unknown data is
preserved verbatim rather than mangled.

### Gate 2 — `editSave.ts`: can we write *something* without collateral damage?

After applying edits, the tool diffs against the original and attributes every
changed byte. If one byte outside the edited fields' own span has moved, it
refuses to write. It also re-parses the table header to confirm the record
shape and file length are unchanged.

```
PLAY[7056] at file offset 0x14f938
  PJEN: 94 -> 77
2 byte(s) changed, all within 2 byte(s) owned by the edited fields.
```

(Two bytes for a 7-bit field is correct — `PJEN` straddles a byte boundary.)

Other guards, all verified:

- **Width overflow** — `PJEN=200` is rejected: `out of range for unsigned 7-bit field PJEN (0..127)`. Without this, an oversized value would silently overwrite the neighbouring field's bits, which is the hardest class of corruption to trace.
- **Unknown field** — rejected with the table's real field list.
- **Ambiguous selector** — `--where PPOS=0` matches 423 records and is refused rather than guessing.
- **Never overwrites the input.**

### Usage

```
node src/editSave.ts --table PLAY --where PGID=7712 --set PJEN=77 --dry-run
node src/editSave.ts --table TEAM --row 0 --set TMPR=6 --out /tmp/test.bin
```

## The unresolved part: the two mystery dwords

`file +0x14` and `table +0x1C` are **not** updated, because we do not know what
they are. They were inherited from other EA DB documentation as "checksum",
which is mnemonic-grade evidence — exactly what the label audit taught us to
distrust. What we actually established:

- All 82 table values are distinct, non-zero and full 32-bit width, with 185 of
  256 byte values represented. They look hash-like, not like counters, sizes or
  timestamps (not ascending; 70 distinct high bytes).
- They match **no** structural quantity: table length, `recLen × maxRecords`,
  `recLen × currentRecords`, data offset, start offset or field count — 0/82 on
  every one.
- They are **not** a hash of the table name (FNV-1/1a, djb2, sdbm, Jenkins
  one-at-a-time all fail).
- No standard algorithm (sum8, xor32, sum32, CRC32 reflected and forward,
  Adler-32) matches over any plausible range — whole table, header, descriptors,
  data, or combinations.
- Crucially, this holds even under a **residual test**, which allows for unknown
  init and final-XOR constants by asking whether `stored XOR computed` is the
  same for all 82 tables rather than demanding an exact match. No constant
  residual exists, so it is not a standard algorithm with non-standard
  constants.

One earlier inference was overstated and is corrected here: six tables hold zero
data bytes yet carry distinct values, which rules out a checksum over record
data *alone* — but all six have different schemas, so a checksum spanning
schema + data is still consistent with the evidence.

### Why we are not cracking it yet

Guessing is expensive and may be unnecessary. Many EA DB tools never recompute
these and the games load fine. The decisive experiment is cheaper than the
cryptanalysis, and it is the same move that resolved the `PWGT` offset: get one
piece of ground truth instead of theorising.

`out/BASLUS-21459DDyn1.test-jersey` changes exactly **one byte**: Darius
Whitaker, Washington's #94 DT, becomes **#78**. It is immediately visible on the
roster screen and affects nothing else.

The number matters. #77 was the first choice and was wrong — it is already worn
by **Brian Yarno, also a Washington DT**. All 67 Washington players have distinct
numbers, so EA evidently assigns them uniquely per team; introducing the first
duplicate on the roster risked the game renumbering someone, rejecting the entry,
or displaying something odd. Any of those would be indistinguishable from the
save being rejected outright, which is the exact question the test exists to
answer. #78 is free and conventional for an interior lineman (50–79 / 90–99).
`src/experiments/freeJerseyNumbers.ts` lists the free numbers.

Verified independently by `verifyEdit.ts`, which re-reads the written file from
scratch rather than trusting the buffer that produced it:

```
82/82 table headers parse cleanly
1 field value(s) differ across the entire file:
  PLAY[7056].PJEN: 94 -> 78
all 67 jersey numbers on the team are still unique
```

- **If the game loads it and shows #78**, nothing verifies these dwords, the
  write path is complete, and we can move straight to the editor UI.
- **If the game rejects it**, they are verified, and we crack them with a much
  better tool than guesswork: a known-plaintext pair. Editing one byte and
  observing how the game *rewrites* the dword constrains the algorithm far more
  tightly than searching blind.

Either outcome is progress, which is what makes it worth running before
spending effort on the algorithm.

## Not yet supported

- **Adding or deleting records.** `currentRecords` would need updating and, past
  the allocated `maxRecords`, the whole file would need relayout. Every edit
  today is a pure value change.
- **Player names.** `PLAY` stores them as 6-bit packed characters across
  `PF01..PF10` / `PL01..PL13`; there is a decoder but no encoder yet.
- **Rating snapping.** `displayToRating()` is lossy by design — the 5-bit scale
  cannot express every 0–99 value (41, 42, 43 all collapse). A UI must show the
  value that will actually be stored, not the one that was typed.
