# NCAA 07 PS2 Custom Roster Import Roadmap

## Goal

Build a reliable TypeScript-based toolchain that can:
- read NCAA 07 PS2 dynasty saves
- decode player and roster data from the EA DB tables
- import custom roster data from a structured source (CSV/JSON)
- encode and write the data back into a valid save file without corrupting the save

This is a long-term reverse-engineering and save-editing project. The first milestone is not a polished UI; it is a safe, verifiable parser and rewriter for the relevant game tables.

---

## Project Direction

The repo already has the right starting point: raw save parsing, table discovery, bitfield extraction, and field-schema mapping. The next step is to move from experimental scripts into a structured architecture that cleanly separates:

- file I/O
- table discovery
- data decoding
- domain models
- validation
- encoding/writing
- import workflow

This project should evolve as a library and command-line tool first, then a web app or local UI later if needed.

---

## Core Principles

1. Read before write
   - Every table and field must be decodeable before we attempt a rewrite.

2. Preserve file integrity
   - Never write random bytes without validation.
   - Always back up the original save.

3. Model the real data relationships
   - Player records are not standalone; names, rosters, team assignments, and related tables may be linked.

4. Validate at every stage
   - field ranges
   - table sizes
   - record counts
   - name/ID consistency
   - required metadata in dependent records

5. Work in small milestones
   - each phase should produce a testable artifact or command

---

## Phase 0: Stabilize the existing project

### Objective
Turn the ad hoc scripts into a reusable TypeScript project with consistent entry points and documented behavior.

### Tasks
- standardize file paths and config
- create a clean `src/` structure with feature folders
- add a shared `types` layer
- make scripts runnable via npm commands
- document the exact save file assumptions

### Proposed folder structure

```text
src/
  app/
    index.ts
  save/
    readSave.ts
    tableDirectory.ts
    fileHeader.ts
  tables/
    play/
      decodePlayTable.ts
      encodePlayTable.ts
      playSchema.ts
      playerRecord.ts
    names/
      decodeNames.ts
    team/
      decodeTeamTable.ts
  import/
    rosterImport.ts
    csvImport.ts
    jsonImport.ts
  validation/
    validatePlayerRecord.ts
    validateRoster.ts
  utils/
    bitReader.ts
    bitWriter.ts
    alignment.ts
  cli/
    importRoster.ts
```

### Deliverable
A project that can load the dynasty save, identify the `PLAY` table, and decode records in a structured type-safe way.

---

## Phase 1: Build a robust save abstraction

### Objective
Model the save file as a structured data source rather than raw bytes.

### Questions to answer
- Where is the master TOC?
- How are table records located and sized?
- Which offsets are fixed vs dynamic?
- What is the true record length for each table?
- How are aligned blocks handled?

### Tasks
- parse the master table directory
- identify table names and header offsets
- create a `SaveFile` abstraction
- create a `TableRef` abstraction with metadata
- add robust logging/debug output

### Deliverables
- `readSave(filePath)` returns a structured save object
- `findTable(tableName)` returns the relevant metadata and payload region
- a debug script that dumps every identified table entry

---

## Phase 2: Decode and model the player table

### Objective
Fully decode the `PLAY` table into typed player objects.

### Tasks
- map the schema fields from `play_schema.json` into explicit TypeScript types
- decode each field using the bit reader
- create a `PlayerRecord` model with named fields
- extract useful derived data like:
  - position
  - overall
  - speed
  - name ID references
  - weight group
  - team/roster status where available
- export the decoded records to JSON for inspection

### Deliverables
- `decodePlayTable()` returns a list of player records
- `PlayerRecord` interface with all mapped fields
- debug export of first N records to JSON

### Key milestone
Being able to print a high-confidence, structured roster from the Dynasty save and match it to observed in-game values.

---

## Phase 3: Build a reversible encoder

### Objective
Support writing a player record back into the save format.

### Tasks
- create a `BitWriter` that can encode fields back into packed records
- reconstruct a 366-bit record from a typed object
- preserve alignment and padding rules
- verify record boundaries and length
- add round-trip tests: decode → encode → decode

### Deliverables
- `encodePlayerRecord(player)` returns a packed buffer
- round-trip tests for known player records
- a validation command to compare original vs re-encoded bytes for unchanged records

### Key milestone
A round-trip test proves that the encoder is structurally consistent with the decoder.

---

## Phase 4: Validate record constraints

### Objective
Ensure that custom records are legal before writing them into a save.

### Tasks
- determine minimum and maximum legal values for each bitfield
- enforce valid ranges for:
  - overall
  - position
  - ratings
  - age/years if present
  - team assignment values
  - name lookup references
  - equipment/attribute group fields
- reject records with impossible combinations
- add warnings for fields that are known to be constrained by game logic

### Deliverables
- `validatePlayerRecord(player)`
- rule definitions for legal roster data
- validation failure output with field names and expected ranges

### Key milestone
The project can reject invalid data before a save is modified.

---

## Phase 5: Implement roster import from structured data

### Objective
Import roster data from a clean external source.

### Supported input formats
- CSV
- JSON
- future: spreadsheet export or user-generated roster editor

### Tasks
- define an import schema for roster rows
- map custom data fields into the game’s player record model
- normalize names, positions, ratings, and team assignments
- support partial roster updates vs full roster replacement
- optionally support a “template mode” that keeps most existing data and only edits selected players

### Deliverables
- `importRoster(filePath, mode, options)`
- schema examples for custom roster CSV and JSON
- importer logs showing rows added, updated, or rejected

### Key milestone
A custom roster can be loaded and translated into valid player records without manual byte editing.

---

## Phase 6: Handle dependent tables and roster relationships

### Objective
Avoid breaking the save by updating only the obvious player row.

### Tasks
- inspect other table relationships, especially the tables listed in the format docs:
  - `AAPL`
  - `PLGA`
  - `POAG`
  - `PNLU`
  - `SCHT`
- determine if name lookups or team link tables need to be updated when roster data changes
- identify which fields are independent and which are linked
- build a dependency map for player data

### Deliverables
- a table dependency graph
- a checklist of required updates per roster action
- a note of which tables are currently “guessed” vs verified

### Key milestone
The project knows whether a roster change affects only one record or a whole set of linked tables.

---

## Phase 7: Safety writes and backup management

### Objective
Make save writing safe and reversible.

### Tasks
- create a save backup before patching
- write only targeted ranges to the binary file
- maintain file integrity checks
- ensure the modified file still has correct size and header state
- add dry-run mode for previewing changes

### Deliverables
- `writeSavePatch(savePath, patch)`
- dry-run diff output
- backup and restore flow

### Key milestone
A patch can be previewed and applied in a controlled way.

---

## Phase 8: Create a usable front end

### Objective
Turn the library into something approachable for real use.

### Choices
- command-line utility first
- later a lightweight local web app or desktop tool

### Best near-term option
A local TypeScript CLI with JSON/CSV import and a “preview save patch” flow.

### Tasks
- import roster file
- preview player list
- validate records
- preview save patch changes
- apply patch to a copy of the save

### Deliverable
A minimal but useful user workflow for custom roster editing.

---

## Recommended implementation sequence

This order is the safest and most sensible:

1. stabilize project structure
2. decode `PLAY` table reliably
3. verify round-trip encode/decode
4. add validation rules
5. implement import from CSV/JSON
6. analyze dependent tables
7. patch write workflow
8. build CLI/web interface

Do not skip the round-trip and validation steps. They are what distinguish a raw reverse-engineering script from a workable save editor.

---

## Immediate next tasks

These are the first concrete tasks to tackle in the repo:

### Task 1: Create a core save abstraction
- file: `src/save/readSave.ts`
- behavior: open a save file, validate DB magic, return a buffer wrapper and table metadata

### Task 2: Improve `PLAY` decoding
- file: `src/tables/play/decodePlayTable.ts`
- behavior: decode full table rather than just first N sample records

### Task 3: Add round-trip tests
- create a `tests/` folder
- decode a known record, encode it, decode again, compare values

### Task 4: Build an import schema
- create a roster input contract for CSV/JSON
- define required columns and defaults

### Task 5: Add a dry-run patch preview
- show what would change before writing to disk

---

## Risk areas to watch

- assuming the `PLAY` table is fully independent when it may not be
- writing field values that are valid in isolation but invalid in-game
- not accounting for pointer/index tables and metadata lookups
- ignoring alignment and paragraph boundary concerns when rewriting blocks
- applying edits without verification against the original data model

---

## Definition of done for the first usable version

The first minimal product is complete when all of the following are true:

- the tool can open a valid NCAA 07 PS2 dynasty save
- it decodes the `PLAY` table into structured player objects
- it can validate custom roster rows before import
- it can generate a reversible save patch
- it can preview changes before writing
- it can write a patched save safely and restore from backup if needed

That would be a serious and useful step forward from the current experimental parsing repo.

---

## Suggested project motto

"Decode, validate, import, patch safely."

That is the right principle for this project.
