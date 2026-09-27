# 2. PLAY_TABLE_SCHEMA_SPEC.md
# PLAY Table Schema & Bit Alignment Specification

## Overview
The `PLAY` table contains player attribute and roster data. Individual records are packed into 366-bit structures across 44 distinct fields.

---

## Record Specifications
* **Record Bit Size:** 366 bits
* **Record Byte Size:** 46 bytes (`ceil(366 / 8)`)
* **Table Header Offset:** `0x0EE8C8`
* **Bit Extraction Method:** Big-Endian / MSB First (`(byte >> (7 - bitInByte)) & 1`)

---

## Schema Bit Layout (`play_schema.json`)

| Bit Range | Bit Width | Field Name | Type Flag | Data Description |
| :---: | :---: | :---: | :---: | :--- |
| **315 – 333** | 19 | `FSPN` | String ID | First Name Pointer ID |
| **334 – 334** | 1 | Unmapped | Flag | Bit Flag |
| **335 – 341** | 7 | `PPSP` | Integer | Speed Attribute (0–99) |
| **342 – 346** | 5 | `WGTS` | Integer | Weight Group Modifier |
| **347 – 351** | 5 | `POVR` | Integer | Player Overall Rating Offset |
| **352 – 358** | 7 | `PPOS` | Enum | Player Position Enum |
| **359 – 365** | 7 | `LSPN` | String ID | Last Name Pointer ID |

---

## Alignment Diagnostic Notes
* **Initial Issue:** Decoding records directly from schema boundary offset `0x018AA0` yielded distorted attributes (`PPOS = 100/124`, `POVR = 1/16`).
* **Root Cause:** Data records do not begin directly after schema definitions (`0x018AA0`). They are managed by the `PLAY` table header metadata block located via TOC at `0x0EE8C8`.
* **Resolution:** Record decoding must pull payload offset and record counts dynamically from the header at `0x0EE8C8`.