# EA DB Save File Format Specification

Verified against `DynastySaveFiles/BASLUS-21459DDyn1` (NCAA Football, PS2 dynasty save).

Every structure below is confirmed by the tooling in `src/`, not inferred. The
decisive tests are that all 82 tables tile the DB region contiguously with no
gaps or overlaps, and that decoded contents are semantically correct
(conference names, player names, heights, jersey numbers).

---

## 1. File header (`0x00`–`0x17`)

| Offset | Type | Value here | Meaning |
| :--- | :--- | :--- | :--- |
| `0x00` | `char[2]` | `"DB"` | Magic |
| `0x02` | `u16` | `0x0800` | Format/version |
| `0x08` | `u32` | `0x001778FC` | DB size in bytes (1,538,300) |
| `0x10` | `u32` | `82` | Table count |
| `0x14` | `u32` | `0xAC412A22` | File checksum |

The file on disk is 2,161,664 bytes. Everything past `dbSize` is PS2 save
padding and is not part of the database.

---

## 2. Master table directory (TOC)

Starts at **`0x18`**, immediately after the file header. `tableCount` entries of
8 bytes each:

```c
struct TocEntry { char name[4]; u32le pointer; };
```

**Pointers are relative, not absolute.** The base is `TOC_BASE = 0x2B0`, the end
of the TOC region rounded up to a 16-byte paragraph:

```
realOffset = 0x2B0 + pointer
```

Omitting this base shifts every table by 688 bytes, which makes table payloads
look like zero padding. The first table begins exactly at `0x2B0` and the last
ends exactly at `dbSize`.

> The TOC is at `0x18`. Earlier revisions of this document claimed `0x258` —
> that is merely where the `PLAY` entry happens to land.

---

## 3. Table header (36 bytes)

Located at each table's `realOffset`.

| Offset | Type | Meaning |
| :--- | :--- | :--- |
| `0x00` | `u32` | Record length in **bytes** |
| `0x04` | `u32` | Record length in bits — always `recordLenBytes*8 - 1` |
| `0x08` | `u32` | Zero |
| `0x0C` | `u16` | `maxRecords` (capacity) |
| `0x0E` | `u16` | `currentRecords` (used) |
| `0x10` | `u16` | Zero |
| `0x12` | `u16` | `0xFFFF` — alignment anchor |
| `0x14` | `u32` | Field count |
| `0x18` | `u32` | Zero |
| `0x1C` | `u32` | Table checksum |
| `0x20` | `u32` | Flags (typically 3) |
| `0x24` | — | Field descriptors begin |

The `0xFFFF` marker at `+0x12` and the `recordLenBits` identity are both
asserted when parsing; they catch a misaligned table immediately.

The table's FourCC name appears **only** in the TOC — it is not repeated at the
table itself.

---

## 4. Field descriptors (16 bytes each)

```c
struct FieldDescriptor {
    u32  bitOffset;   // offset FIRST
    char name[4];
    u32  bits;        // width; > 32 means a string
    u32  type;        // 3 = unsigned, 2 = signed
};
```

Two traps:

1. **Offset comes first.** Because the 4-char name sits on a 16-byte boundary in
   a hex dump, a field's `bitOffset` is the dword *before* its name. Reading the
   trailing dword of the same dump line as the current field's offset shifts the
   entire schema by one field and produces overlapping bit ranges.
   The alternative `{name, bits, type, offset}` layout is disproven: it places
   `PL11` (54–59) over `PRG1` (57–59) and `PGID` (220–235) over `PHPD` (221).

2. **Descriptors are not in bit order.** They are stored sorted by the name
   interpreted as a little-endian `u32` (i.e. by 4th character, then 3rd, 2nd,
   1st). Always re-sort by `bitOffset` before use.

---

## 5. Record data

```
dataOffset = fieldsOffset + fieldCount*16 - 4
```

**Note the minus four.** The final descriptor's trailing `type` dword is not
stored at all — those 4 bytes are the first 4 bytes of record 0. Consequently
the last field's type is unknown and is defaulted to unsigned.

Proof: in `CONF` the descriptor block ends at `0x7128`, and the string `"ACC"`
(the first conference name, which lives at record byte 4) begins exactly there,
placing record 0 at `0x7124`.

The full table extent is:

```
length = 0x24 + fieldCount*16 - 4 + allocatedRecords*recordLen + 8
```

where the trailing 8 bytes are inter-table padding. This is exact:

| Table | Computation | Actual |
| :--- | :--- | :--- |
| `CONF` | `36 + 128 - 4 + 25*28 + 8` | 868 |
| `PLAY` | `36 + 1568 - 4 + 8470*56 + 8` | 475,928 |

**Allocation is sized to need, not to `maxRecords`.** 14 tables reserve fewer
rows than `maxRecords` — `BXSS` reserves 0 rows despite `maxRecords = 240`, as
does `SCHT` with 800. Never compute a table's extent from `maxRecords`; always
use the TOC.

---

## 6. Bit packing — little-endian bitfields

Records are little-endian bitfields. Bit *i* of a record lives in byte `i >> 3`
at bit position `i & 7` counted **from the LSB**, and multi-bit values are
assembled LSB-first:

```ts
value |= ((buf[base + (i >> 3)] >> (i & 7)) & 1) << j;
```

Confirmed via `DCHT`, whose 16-bit player key decodes to a clean sequential run
(70, 71, 72, 73, …) under this convention but to multiples of 256 under a
big-endian reading.

Signed fields (`type == 2`) use two's complement at the field's width.

---

## 7. String fields

A field wider than 32 bits is a **byte-aligned, NUL-padded ASCII string**, not an
integer. `type` does not flag this — the width does.

Example: `CONF.CNAM` is 160 bits = 20 bytes, yielding `"ACC"`, `"Big Ten"`,
`"Big 12"`, `"Mountain West"`.

---

## 8. Reference implementation

`src/lib/eadb.ts` is the single source of truth for all of the above. Everything
else goes through it.

| Script | Purpose |
| :--- | :--- |
| `src/buildTableDirectory.ts` | Parse the TOC, assert contiguous tiling, write `analysis/tableDirectory.json` |
| `src/dumpPlayTable.ts` | Generate `play_schema.json` and `out/PLAY.csv` from the file's own descriptors |
| `src/validatePlayTable.ts` | Semantic validation of the decode |
| `src/experiments/inspectTable.ts` | Inspect any table by FourCC |

Run with `node src/<script>.ts` — Node 24 strips the types natively, so there is
no build step and no dependencies.
# 1. EA_DB_FILE_FORMAT_SPEC.md
# EA DB Save File Format Specification

## Overview
The save file (`BASLUS-21459DDyn1`) uses EA's standard binary database format (EA DB). Data is structured into a **Master Table Directory (TOC)**, **Table Metadata Headers**, **Schema Definition Blocks**, and **Bit-Packed Data Payloads**.

---

## File Architecture

| Memory Region / Offset | Size | Description |
| :--- | :--- | :--- |
| `0x000000` – `0x000257` | 600 B | File Header & Global Metadata |
| `0x000258` – Table TOC | Variable | Master Table Directory (Table Allocation Table) |
| `0x010000` – `0x018A8C` | ~35 KB | Global Schema Definitions / Field Index Maps (`play_schema.json`) |
| `0x0EE8C8` (PLAY Header) | Variable | `PLAY` Table Header Metadata & Record Definitions |
| Payload Blocks | Variable | Bit-packed table records aligned to paragraph boundaries |

---

## Master Table Directory (TOC)
* **Directory Offset:** Starts at `0x000258` (600 bytes into file).
* **Directory Entry Size:** 8 bytes per entry.
* **Endianness:**
  * **FourCC Tag:** ASCII String (4 bytes)
  * **Table Header Offset:** `UInt32LE` (4 bytes)

### Identified Table Directory Entries
| Table FourCC | Description | Offset (Hex) | Offset (Dec) | Pointer Bytes (Hex) |
| :---: | :--- | :---: | :---: | :--- |
| `PLAY` | Player Records Table | `0x0EE8C8` | 977,096 | `C8 E8 0E 00` |
| `AAPL` | Award / All-American Pointer List | `0x162BE0` | 1,453,024 | `E0 2B 16 00` |
| `PLGA` | Player Game Stats | `0x1696D8` | 1,480,408 | `D8 96 16 00` |
| `POAG` | Player Overall / Game Attributes | `0x16C0B0` | 1,491,120 | `B0 C0 16 00` |
| `PNLU` | Player Name Lookups | `0x16CAD8` | 1,493,720 | `D8 CA 16 00` |
| `SCHT` | Schedule / Team Matchups | `0x16CC20` | 1,494,048 | `20 CC 16 00` |

---

## Data Packing & Alignment Rules
1. **Bit-Packed Records:** Records within table payloads are stored end-to-end as bitfields without byte padding between fields inside a record.
2. **Big-Endian Bit Order:** Bitfield indices within a record are read Most Significant Bit (MSB) first across byte boundaries.
3. **Data Block Alignment:** Payload data regions following headers are aligned to 16-byte (0x10) paragraph boundaries.