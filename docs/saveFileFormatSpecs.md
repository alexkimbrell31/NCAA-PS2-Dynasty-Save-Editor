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