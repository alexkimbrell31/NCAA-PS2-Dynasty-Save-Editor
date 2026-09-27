import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const outputPath = path.join(__dirname, '..', 'analysis', 'schemaDescriptorRuns.json');

export interface DescriptorCandidate {
  offset: number;
  offsetHex: string;
  fieldName: string;
  typeFlag: number;
  bitOffset: number;
}

export interface SchemaRun {
  runIndex: number;
  startOffset: number;
  startOffsetHex: string;
  endOffset: number;
  fieldCount: number;
  totalRecordBits: number | null;
  fields: Array<DescriptorCandidate & { bitWidth: number | null }>;
}

const DESCRIPTOR_STRIDE = 16; // proven stride from play_schema.json / parsePlayerFields.ts
const MAX_TYPE_FLAG = 5; // proven ceiling from parsePlayerFields.ts
const MIN_RUN_LENGTH = 3; // reject 1-2 entry "runs" as likely coincidence

/**
 * Scans the entire buffer for the proven PLAY-schema descriptor pattern:
 * [4-byte ASCII name][4 bytes unknown][4-byte typeFlag LE][4-byte bitOffset LE]
 * at every possible byte offset (descriptors are NOT globally 16-byte aligned;
 * only consecutive descriptors within one run are 16 bytes apart).
 */
function findCandidates(buffer: Buffer): DescriptorCandidate[] {
  const candidates: DescriptorCandidate[] = [];
  const nameRegex = /^[A-Za-z0-9_]{4}$/;

  for (let offset = 0; offset < buffer.length - 16; offset++) {
    const fieldName = buffer.toString('ascii', offset, offset + 4);
    if (!nameRegex.test(fieldName)) continue;

    const typeFlag = buffer.readUInt32LE(offset + 8);
    if (typeFlag > MAX_TYPE_FLAG) continue;

    const bitOffset = buffer.readUInt32LE(offset + 12);
    // bitOffset must be a plausible bit position within a record; reject absurd values
    if (bitOffset >= 0x10000) continue;

    candidates.push({
      offset,
      offsetHex: `0x${offset.toString(16).toUpperCase().padStart(6, '0')}`,
      fieldName,
      typeFlag,
      bitOffset
    });
  }

  return candidates;
}

/**
 * Groups candidates into runs of consecutive descriptors spaced exactly
 * DESCRIPTOR_STRIDE bytes apart. A large backward jump in bitOffset within
 * an otherwise-contiguous chain marks the start of a new table's schema.
 */
function groupIntoRuns(candidates: DescriptorCandidate[]): SchemaRun[] {
  const byOffset = new Map(candidates.map(c => [c.offset, c]));
  const consumed = new Set<number>();
  const runs: SchemaRun[] = [];

  for (const candidate of candidates) {
    if (consumed.has(candidate.offset)) continue;

    // Only start a chain where the previous stride position is NOT itself a candidate,
    // so each run is captured starting from its true first field.
    if (byOffset.has(candidate.offset - DESCRIPTOR_STRIDE)) continue;

    const chain: DescriptorCandidate[] = [candidate];
    consumed.add(candidate.offset);

    // NOTE: fields are NOT necessarily stored in bitOffset order within a table's
    // schema block (verified against raw bytes: PRV1's low bitOffset legitimately
    // follows PT01's higher one within the same real PLAY schema chain). So a chain
    // is defined purely by exact 16-byte stride adjacency; it naturally terminates
    // once the descriptor pattern (name/typeFlag/bitOffset) stops matching.
    let cursor = candidate.offset + DESCRIPTOR_STRIDE;
    while (byOffset.has(cursor) && !consumed.has(cursor)) {
      const next = byOffset.get(cursor)!;
      chain.push(next);
      consumed.add(cursor);
      cursor += DESCRIPTOR_STRIDE;
    }

    if (chain.length >= MIN_RUN_LENGTH) {
      const fields = chain.map((field, idx) => {
        const next = chain[idx + 1];
        const bitWidth = next ? next.bitOffset - field.bitOffset : null;
        return { ...field, bitWidth };
      });

      const lastField = chain[chain.length - 1];
      runs.push({
        runIndex: runs.length,
        startOffset: chain[0].offset,
        startOffsetHex: chain[0].offsetHex,
        endOffset: lastField.offset + DESCRIPTOR_STRIDE,
        fieldCount: chain.length,
        // Without independently knowing total record bits, we can only report
        // the highest observed bitOffset; real total may be larger (last field's width).
        totalRecordBits: null,
        fields
      });
    }
  }

  return runs;
}

function main() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Save file not found at ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  console.log(`File size: ${buffer.length} bytes`);

  const candidates = findCandidates(buffer);
  console.log(`Raw candidate descriptors found: ${candidates.length}`);

  const runs = groupIntoRuns(candidates);
  console.log(`Schema runs (length >= ${MIN_RUN_LENGTH}): ${runs.length}`);

  console.table(runs.map(r => ({
    runIndex: r.runIndex,
    startOffset: r.startOffsetHex,
    fieldCount: r.fieldCount,
    firstField: r.fields[0]?.fieldName,
    lastField: r.fields[r.fields.length - 1]?.fieldName,
    maxBitOffset: r.fields[r.fields.length - 1]?.bitOffset
  })));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(runs, null, 2));
  console.log(`\nSaved ${runs.length} schema runs to: ${outputPath}`);
}

main();
