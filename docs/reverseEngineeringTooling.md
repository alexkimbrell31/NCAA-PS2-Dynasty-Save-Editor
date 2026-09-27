# 3. REVERSE_ENGINEERING_TOOLING.md
# Reverse Engineering Tooling & Scripts Reference

## Project Structure
```text
/
├── DynastySaveFiles/
│   └── BASLUS-21459DDyn1         # Raw EA DB Dynasty save file
├── play_schema.json              # Mapped 44-field bit schema
└── src/
    ├── decodePlayerRecord.ts   # Bitfield unpacker script
    ├── findPlayHeader.ts s       # Global buffer TOC scanner
    └── inspectPlayTable.ts      # Header metadata inspector at 0x0EE8C8