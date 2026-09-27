# NCAA-PS2-Dynasty-Save-Editor
Web Application that can be used to edit NCAA Football (PS2 Era) Dynasty Save files 

# EA DB Save File Parser & Reverse Engineering Tooling

A TypeScript-based utility suite for reverse engineering, inspecting, and decoding binary save files (`BASLUS-21459DDyn1`) built on EA's proprietary database format (EA DB). 

This project provides low-level binary analysis tools to scan Master Table Allocation Tables (TOC), parse table headers, map bitfield schemas, and unpack bit-packed record payloads into structured JavaScript/TypeScript objects.

---

## 📌 Project Overview

EA DB save files store game database tables (such as player attributes, team stats, and schedules) using tight bit-packing across 46-byte (366-bit) boundaries rather than standard byte-aligned structures. 

This repository contains the reverse-engineered specification and tooling to:
1. Locate table offsets dynamically using the Master TOC at `0x000258`.
2. Inspect table header metadata and paragraph-aligned payload blocks.
3. Unpack arbitrary bit-width fields (`PPOS`, `POVR`, `PPSP`, `FSPN`, `LSPN`, etc.) using MSB-first bitwise extraction across byte boundaries.

---

## 📁 Repository Structure

```text
.
├── DynastySaveFiles/
│   └── BASLUS-21459DDyn1         # Raw EA DB Dynasty save file
├── play_schema.json              # Mapped 44-field bit schema for the PLAY table
├── src/
│   ├── findPlayHeader.ts        # Scans file for TOC entries & table header offsets
│   ├── inspectPlayTable.ts      # Reads metadata header fields at target table offsets
│   └── decodePlayerRecords.ts   # Unpacks bitfield records from table binary payloads
├── package.json
├── tsconfig.json
└── README.md