/**
 * EA DB save-file primitives.
 *
 * This is the SINGLE source of truth for parsing the container. Every script
 * must go through these helpers -- the earlier scripts each reimplemented bit
 * extraction and header parsing slightly differently, which is how the schema
 * drifted out of sync with the file.
 *
 * Layout (verified against BASLUS-21459DDyn1):
 *
 *   File header (0x00..0x17)
 *     0x00 char[2] "DB"
 *     0x02 u16     format/version
 *     0x08 u32     dbSize   (bytes of real DB content; rest of file is save padding)
 *     0x10 u32     tableCount
 *     0x14 u32     checksum
 *
 *   TOC at 0x18, tableCount * 8 bytes: { char[4] name; u32le pointer }
 *   Pointers are RELATIVE to TOC_BASE (0x2B0), not absolute file offsets.
 *
 *   Table header, 36 bytes (0x24) at the table's real offset -- see parseTableHeader.
 *   Field descriptors follow immediately, 16 bytes each, OFFSET FIRST -- see parseFieldDescriptors.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SAVE_FILE_PATH = path.join(
  here,
  '..',
  '..',
  'DynastySaveFiles',
  'BASLUS-21459DDyn1',
);

/** TOC starts here, immediately after the 0x18-byte file header. */
export const TOC_OFFSET = 0x18;

/**
 * All TOC pointers are relative to this base: the end of the TOC region rounded
 * up to a 16-byte paragraph. Forgetting this offsets every table by 688 bytes,
 * which is what made the PLAY payload look like zero padding.
 *
 * 0x2B0 is the value for THIS file, which has 82 tables:
 *   0x18 + 82 * 8 = 0x2A8, rounded up to 16 = 0x2B0.
 * Use {@link tocBaseFor} instead when opening a file whose table count may
 * differ -- a roster file, or another EA title using the same container.
 *
 * CAVEAT: the derivation fits exactly, but on a sample of ONE file. A second
 * file with a different table count would be the first real test of it.
 */
export const TOC_BASE = 0x2b0;

/**
 * TOC base for an arbitrary table count. See {@link TOC_BASE} for the caveat.
 */
export function tocBaseFor(tableCount: number): number {
  const tocEnd = TOC_OFFSET + tableCount * 8;
  return Math.ceil(tocEnd / 16) * 16;
}

export const TABLE_HEADER_SIZE = 0x24;
export const FIELD_DESCRIPTOR_SIZE = 0x10;

/** Field type flags seen in descriptors. */
export const FIELD_TYPE_SIGNED = 2;
export const FIELD_TYPE_UNSIGNED = 3;

export interface FileHeader {
  magic: string;
  dbSize: number;
  tableCount: number;
  checksum: number;
}

export interface TocEntry {
  name: string;
  /** Byte offset of this entry within the TOC itself. */
  tocOffset: number;
  /** Raw pointer as stored, relative to TOC_BASE. */
  pointer: number;
  /** Absolute file offset of the table header: TOC_BASE + pointer. */
  realOffset: number;
}

export interface TableHeader {
  recordLenBytes: number;
  /** Stored as recordLenBytes*8 - 1. It is a max bit INDEX, not a bit count. */
  recordLenBits: number;
  maxRecords: number;
  currentRecords: number;
  fieldCount: number;
  checksum: number;
  flags: number;
  /** Absolute offset of the first field descriptor. */
  fieldsOffset: number;
  /** Absolute offset of the first data record. */
  dataOffset: number;
}

export interface FieldDescriptor {
  name: string;
  bitOffset: number;
  bits: number;
  type: number;
  /**
   * True for the final descriptor of a table, whose `type` dword is not stored
   * at all -- those bytes are the start of record 0. We default it to unsigned.
   */
  typeUnreliable: boolean;
  /**
   * True for fixed-length ASCII text fields.
   *
   * Width alone does NOT determine this. The old "wider than 32 bits means
   * string" rule produces false positives -- `TEAM.TPIP` (56 bits) and
   * `TEAM.JJNM` (104 bits) are binary, and treating them as text silently
   * destroyed their contents on write. This flag is now decided by sampling the
   * actual bytes; see parseFieldDescriptors.
   */
  isString: boolean;
  /**
   * True for fields wider than 32 bits whose bytes are NOT text. These are read
   * and written as raw hex so they survive an edit verbatim, which matters
   * because we cannot regenerate data we cannot interpret.
   */
  isRaw: boolean;
}

export function readSaveFile(filePath: string = SAVE_FILE_PATH): Buffer {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Save file not found at ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

export function parseFileHeader(buf: Buffer): FileHeader {
  const magic = buf.toString('ascii', 0x00, 0x02);
  if (magic !== 'DB') {
    throw new Error(`Not an EA DB file: magic is "${magic}", expected "DB"`);
  }
  return {
    magic,
    dbSize: buf.readUInt32LE(0x08),
    tableCount: buf.readUInt32LE(0x10),
    checksum: buf.readUInt32LE(0x14),
  };
}

export function parseToc(buf: Buffer, header: FileHeader): TocEntry[] {
  const entries: TocEntry[] = [];
  const base = tocBaseFor(header.tableCount);
  for (let i = 0; i < header.tableCount; i++) {
    const off = TOC_OFFSET + i * 8;
    const name = buf.toString('ascii', off, off + 4).replace(/\0/g, '');
    const pointer = buf.readUInt32LE(off + 4);
    entries.push({ name, tocOffset: off, pointer, realOffset: base + pointer });
  }
  return entries;
}

/**
 * Parse the 36-byte table header.
 *
 * The 0x0000FFFF marker at +0x10 is used as an alignment anchor: if it is not
 * present, our offset is wrong and every downstream field would be garbage.
 */
export function parseTableHeader(buf: Buffer, tableOffset: number): TableHeader {
  const recordLenBytes = buf.readUInt32LE(tableOffset + 0x00);
  const recordLenBits = buf.readUInt32LE(tableOffset + 0x04);
  const maxRecords = buf.readUInt16LE(tableOffset + 0x0c);
  const currentRecords = buf.readUInt16LE(tableOffset + 0x0e);
  const marker = buf.readUInt16LE(tableOffset + 0x12);
  const fieldCount = buf.readUInt32LE(tableOffset + 0x14);
  const checksum = buf.readUInt32LE(tableOffset + 0x1c);
  const flags = buf.readUInt32LE(tableOffset + 0x20);

  if (marker !== 0xffff) {
    throw new Error(
      `Bad table header at 0x${tableOffset.toString(16)}: expected 0xFFFF marker at +0x12, got 0x${marker.toString(16)}`,
    );
  }
  if (recordLenBits !== recordLenBytes * 8 - 1) {
    throw new Error(
      `Bad table header at 0x${tableOffset.toString(16)}: recordLenBits ${recordLenBits} != recordLenBytes*8-1 (${recordLenBytes * 8 - 1})`,
    );
  }

  const fieldsOffset = tableOffset + TABLE_HEADER_SIZE;

  // Record data begins 4 bytes BEFORE the nominal end of the descriptor block:
  // the final descriptor's trailing `type` dword is not actually stored, and
  // those 4 bytes are the first 4 bytes of record 0.
  //
  // Verified exactly by table length arithmetic --
  //   length == 0x24 + fieldCount*16 - 4 + maxRecords*recordLen + 8
  // holds for every table (CONF 868, PLAY 475928), where the trailing 8 bytes
  // are inter-table padding.
  //
  // Proof for CONF: the descriptor block ends at 0x7128 and the string "ACC"
  // (the first conference name, at record byte 4) starts there, which puts
  // record 0 at 0x7124.
  const dataOffset = fieldsOffset + fieldCount * FIELD_DESCRIPTOR_SIZE - 4;

  return {
    recordLenBytes,
    recordLenBits,
    maxRecords,
    currentRecords,
    fieldCount,
    checksum,
    flags,
    fieldsOffset,
    dataOffset,
  };
}

/**
 * Parse the field descriptor block.
 *
 * CRITICAL: the descriptor is OFFSET FIRST --
 *   { u32 bitOffset; char name[4]; u32 bits; u32 type }
 * In a hex dump the 4-char name lands on a 16-byte boundary, so a field's
 * bitOffset is the dword *before* its name. Reading the trailing dword of the
 * same hex line as the current field's offset shifts the whole schema by one
 * field, producing overlapping bit ranges (the classic PPOS=100/124 symptom).
 *
 * Descriptors are stored sorted by name-as-u32LE (i.e. by 4th char, then 3rd,
 * 2nd, 1st) -- NOT by bit offset. We always re-sort by bitOffset on return.
 */
export function parseFieldDescriptors(
  buf: Buffer,
  header: TableHeader,
): FieldDescriptor[] {
  const fields: FieldDescriptor[] = [];

  for (let i = 0; i < header.fieldCount; i++) {
    const off = header.fieldsOffset + i * FIELD_DESCRIPTOR_SIZE;
    const isLast = i === header.fieldCount - 1;
    const rawType = buf.readUInt32LE(off + 0x0c);
    const bits = buf.readUInt32LE(off + 0x08);
    const bitOffset = buf.readUInt32LE(off + 0x00);

    // Only fields wider than 32 bits can be text, and text is always stored on
    // whole bytes. Everything else is an integer.
    const couldBeText = bits > 32 && bits % 8 === 0 && bitOffset % 8 === 0;
    const text = couldBeText && looksLikeText(buf, header, bitOffset, bits);

    fields.push({
      bitOffset,
      name: buf.toString('ascii', off + 0x04, off + 0x08),
      bits,
      // The last descriptor's type dword is not stored -- it is record data.
      type: isLast ? FIELD_TYPE_UNSIGNED : rawType,
      typeUnreliable: isLast,
      isString: text,
      isRaw: bits > 32 && !text,
    });
  }

  return fields.sort((a, b) => a.bitOffset - b.bitOffset);
}

/**
 * Decide whether a wide field holds text by looking at the bytes.
 *
 * The obvious rule -- "wider than 32 bits means string" -- is wrong, and it was
 * wrong in a way that only surfaced once we tried to WRITE. `TEAM.TPIP` (56
 * bits) and `TEAM.JJNM` (104 bits) are binary; decoding them as text truncated
 * them at the first NUL, and re-encoding then destroyed everything after it.
 *
 * Two rules, both learned from real misclassifications:
 *
 * - Reject CONTROL bytes, not high bytes. Several stadium names contain 0xB0 /
 *   0xB1, which are legitimate characters in EA's font. (These are the source
 *   of the phantom trailing digits in names like "Georgia Dome1" -- Node's
 *   'ascii' decoder was masking bit 7 and turning 0xB1 into '1'.) Requiring
 *   pure 7-bit ASCII wrongly demoted `STAD.SNAM` to binary.
 *
 * - Require positive evidence of text. An all-NUL sample is consistent with
 *   both readings, so it is treated as binary: raw bytes are preserved
 *   verbatim, which is the safe default when we genuinely cannot tell.
 */
function looksLikeText(
  buf: Buffer,
  header: TableHeader,
  bitOffset: number,
  bits: number,
): boolean {
  const width = bits >> 3;
  const sample = Math.min(header.currentRecords, 64);
  if (sample === 0) return false;

  let longestPrefix = 0;
  for (let r = 0; r < sample; r++) {
    const start = header.dataOffset + r * header.recordLenBytes + (bitOffset >> 3);
    if (start + width > buf.length) return false;
    // Only the bytes before the terminator are the value; anything after it is
    // residue from a previous longer string and is not evidence either way.
    let prefix = 0;
    for (let i = 0; i < width; i++) {
      const b = buf[start + i];
      if (b === 0) break;
      if (b < 0x20 || b === 0x7f) return false;
      prefix++;
    }
    if (prefix > longestPrefix) longestPrefix = prefix;
  }
  return longestPrefix >= 2;
}

/**
 * Extract `width` bits starting at `bitOffset` within the record that begins at
 * byte `byteBase`.
 *
 * Records are LITTLE-ENDIAN bitfields: bit i lives in byte (i >> 3) at bit
 * position (i & 7) counted from the LSB, and the value is assembled LSB-first.
 * Confirmed via DCHT, whose 16-bit player key decodes to a clean sequential run
 * (72, 73, 74, 74, 75, ...) under this convention and to multiples of 256 under
 * the big-endian one.
 */
export function readBitsLE(
  buf: Buffer,
  byteBase: number,
  bitOffset: number,
  width: number,
): number {
  let value = 0;
  for (let i = 0; i < width; i++) {
    const bit = bitOffset + i;
    value |= ((buf[byteBase + (bit >> 3)] >> (bit & 7)) & 1) << i;
  }
  return value >>> 0;
}

/**
 * Read a fixed-length string field. These are always byte-aligned and NUL-
 * padded (e.g. CONF.CNAM is 160 bits = 20 bytes: "Big Ten").
 *
 * Decoded as latin1, NOT 'ascii'. Node's 'ascii' encoding masks off bit 7, so a
 * byte like 0xB1 silently decodes to 0x31 ('1') and re-encodes as 0x31 --
 * a one-bit data loss that round-trip testing caught in STAD record 123.
 * latin1 is a lossless 1:1 byte mapping.
 */
export function readStringField(
  buf: Buffer,
  recordOffset: number,
  field: FieldDescriptor,
): string {
  const start = recordOffset + (field.bitOffset >> 3);
  const raw = buf.toString('latin1', start, start + (field.bits >> 3));
  const end = raw.indexOf('\0');
  return end === -1 ? raw : raw.slice(0, end);
}

/** Read a non-text wide field as lowercase hex, preserving every byte. */
export function readRawField(
  buf: Buffer,
  recordOffset: number,
  field: FieldDescriptor,
): string {
  const start = recordOffset + (field.bitOffset >> 3);
  return buf.toString('hex', start, start + (field.bits >> 3));
}

/** Read a field, applying two's-complement sign extension for type 2 fields. */
export function readField(
  buf: Buffer,
  recordOffset: number,
  field: FieldDescriptor,
): number | string {
  if (field.isRaw) return readRawField(buf, recordOffset, field);
  if (field.isString) return readStringField(buf, recordOffset, field);

  const raw = readBitsLE(buf, recordOffset, field.bitOffset, field.bits);
  if (field.type === FIELD_TYPE_SIGNED && field.bits > 0) {
    const signBit = 1 << (field.bits - 1);
    if (raw & signBit) return raw - (1 << field.bits);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// WRITE PATH
//
// These are exact inverses of the read functions above. Correctness is not
// asserted -- verifyRoundTrip.ts re-encodes every field of every record of all
// 82 tables and requires the result to be byte-identical to the original file.
// That test exercises the whole schema at once: any gap, overlap or bit-order
// error surfaces immediately as a differing byte.
//
// Edits are applied IN PLACE to a copy of the original buffer, never by
// rebuilding the file. Field edits cannot change any record length, so the TOC,
// table headers and descriptor blocks stay untouched and byte-exact by
// construction. Unmapped padding bits are likewise preserved.
// ---------------------------------------------------------------------------

/**
 * Write `width` bits of `value` at `bitOffset` within the record beginning at
 * byte `byteBase`. Exact inverse of readBitsLE.
 */
export function writeBitsLE(
  buf: Buffer,
  byteBase: number,
  bitOffset: number,
  width: number,
  value: number,
): void {
  for (let i = 0; i < width; i++) {
    const bit = bitOffset + i;
    const byte = byteBase + (bit >> 3);
    const mask = 1 << (bit & 7);
    if ((value >>> i) & 1) buf[byte] |= mask;
    else buf[byte] &= ~mask;
  }
}

/**
 * Write a fixed-length ASCII string.
 *
 * Two details matter for byte-exactness, both discovered by verifyRoundTrip.ts:
 *
 * 1. A string that exactly fills its field has NO terminator. `COCH.CLLN` is 13
 *    bytes and holds "Bama St Coach", which is 13 characters. Demanding room
 *    for a NUL would reject values the game itself stores.
 *
 * 2. Bytes after the terminator are left ALONE rather than zeroed. Some records
 *    carry residue there from a longer previous value (`BOWL.BNME` record 24).
 *    Blanking it is invisible to any reader -- they all stop at the NUL -- but
 *    it perturbs bytes we were not asked to change, which would defeat the
 *    byte-identity guarantee that makes the write path trustworthy.
 */
export function writeStringField(
  buf: Buffer,
  recordOffset: number,
  field: FieldDescriptor,
  value: string,
): void {
  const start = recordOffset + (field.bitOffset >> 3);
  const width = field.bits >> 3;
  if (value.length > width) {
    throw new Error(
      `String "${value}" is ${value.length} bytes but ${field.name} holds only ${width}`,
    );
  }
  buf.write(value, start, 'latin1');
  if (value.length < width) buf[start + value.length] = 0;
}

/** Write a non-text wide field from its hex representation, byte for byte. */
export function writeRawField(
  buf: Buffer,
  recordOffset: number,
  field: FieldDescriptor,
  hex: string,
): void {
  const width = field.bits >> 3;
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length !== width) {
    throw new Error(
      `Raw field ${field.name} needs exactly ${width} bytes (${width * 2} hex chars), got ${bytes.length}`,
    );
  }
  bytes.copy(buf, recordOffset + (field.bitOffset >> 3));
}

/**
 * Write a field, validating that the value actually fits.
 *
 * Range checking is the single most important safety property of the editor:
 * a value wider than its field would silently overwrite the neighbouring
 * field's bits, corrupting unrelated data in a way that is very hard to trace.
 * We throw instead.
 */
export function writeField(
  buf: Buffer,
  recordOffset: number,
  field: FieldDescriptor,
  value: number | string,
): void {
  if (field.isRaw) {
    if (typeof value !== 'string') {
      throw new Error(`Field ${field.name} is raw bytes but got ${typeof value}`);
    }
    writeRawField(buf, recordOffset, field, value);
    return;
  }
  if (field.isString) {
    if (typeof value !== 'string') {
      throw new Error(`Field ${field.name} is a string but got ${typeof value}`);
    }
    writeStringField(buf, recordOffset, field, value);
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Field ${field.name} needs an integer, got ${JSON.stringify(value)}`);
  }

  let raw = value;
  if (field.type === FIELD_TYPE_SIGNED) {
    const min = -(2 ** (field.bits - 1));
    const max = 2 ** (field.bits - 1) - 1;
    if (value < min || value > max) {
      throw new Error(
        `${value} out of range for signed ${field.bits}-bit field ${field.name} (${min}..${max})`,
      );
    }
    if (value < 0) raw = value + 2 ** field.bits;
  } else {
    const max = field.bits >= 32 ? 0xffffffff : 2 ** field.bits - 1;
    if (value < 0 || value > max) {
      throw new Error(
        `${value} out of range for unsigned ${field.bits}-bit field ${field.name} (0..${max})`,
      );
    }
  }

  writeBitsLE(buf, recordOffset, field.bitOffset, field.bits, raw >>> 0);
}

/** Byte offset of a given record within a table. */
export function recordOffsetAt(header: TableHeader, index: number): number {
  return header.dataOffset + index * header.recordLenBytes;
}

/** Decode every used record of a table into plain objects keyed by field name. */
export function readRecords(
  buf: Buffer,
  header: TableHeader,
  fields: FieldDescriptor[],
): Record<string, number | string>[] {
  const records: Record<string, number | string>[] = [];
  for (let i = 0; i < header.currentRecords; i++) {
    const recordOffset = header.dataOffset + i * header.recordLenBytes;
    const record: Record<string, number | string> = {};
    for (const field of fields) {
      record[field.name] = readField(buf, recordOffset, field);
    }
    records.push(record);
  }
  return records;
}

/** Locate a table by FourCC name. */
export function findTable(toc: TocEntry[], name: string): TocEntry {
  const entry = toc.find((e) => e.name === name);
  if (!entry) throw new Error(`Table "${name}" not present in TOC`);
  return entry;
}

/**
 * Decode one 6-bit name character.
 *
 * Names in PLAY are stored as arrays of 6-bit codes (PF01..PF10 for the first
 * name, PL01..PL13 for the last). The charset is:
 *   0      terminator
 *   1-26   'a'-'z'
 *   27-52  'A'-'Z'
 *   54     apostrophe   (O'Connor, O'Neal)
 *   55     period       (T.J., A.J.)
 *   56     hyphen       (John-Paul, Saint-Preux)
 *
 * Derived from PLAY record 0: PL01..PL08 = 49,9,12,12,9,1,13,19 -> "Williams"
 * and PF01..PF06 = 30,5,14,14,9,19 -> "Dennis". Code 53 is unused in this save.
 */
export function decodeNameChar(code: number): string {
  if (code === 0) return '';
  if (code >= 1 && code <= 26) return String.fromCharCode(96 + code);
  if (code >= 27 && code <= 52) return String.fromCharCode(64 + (code - 26));
  if (code === 54) return "'";
  if (code === 55) return '.';
  if (code === 56) return '-';
  // Anything else is unidentified; surface it rather than hide it.
  return `<${code}>`;
}

/**
 * Assemble a name from its per-character fields, stopping at the terminator.
 * `prefix` is 'PF' for first names or 'PL' for last names.
 */
export function decodeName(
  record: Record<string, number | string>,
  prefix: 'PF' | 'PL',
  maxChars: number,
): string {
  let out = '';
  for (let i = 1; i <= maxChars; i++) {
    const key = `${prefix}${String(i).padStart(2, '0')}`;
    const code = record[key];
    if (typeof code !== 'number' || code === 0) break;
    out += decodeNameChar(code);
  }
  return out;
}

/** First name (PF01..PF10) and last name (PL01..PL13) of a PLAY record. */
export function playerName(record: Record<string, number | string>): {
  first: string;
  last: string;
} {
  return {
    first: decodeName(record, 'PF', 10),
    last: decodeName(record, 'PL', 13),
  };
}

/** Longest first and last name PLAY can store. */
export const MAX_FIRST_NAME = 10;
export const MAX_LAST_NAME = 13;

/**
 * Inverse of `decodeNameChar`. Throws on any character the 6-bit charset
 * cannot represent, rather than substituting something close -- silently
 * turning "Peña" into "Pena" would corrupt a name without telling anyone.
 */
export function encodeNameChar(ch: string): number {
  if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 96;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 64 + 26;
  if (ch === "'") return 54;
  if (ch === '.') return 55;
  if (ch === '-') return 56;
  throw new Error(
    `character ${JSON.stringify(ch)} cannot be encoded; ` +
      `the 6-bit charset holds only a-z, A-Z, apostrophe, period and hyphen`,
  );
}

/**
 * Encode a name into its per-character field values.
 *
 * Returns a map of field name -> code, e.g. `{ PF01: 30, ..., PF07: 0 }`, ready
 * to hand to `writeField`. It emits the characters plus ONE terminator, and
 * deliberately says nothing about the slots beyond that.
 *
 * That last part is not an oversight. 6774 of the 7404 players carry non-zero
 * codes after their terminator -- residue from a longer name that previously
 * occupied the row. "Jones" is stored as J,o,n,e,s,0,m,s because the row used
 * to hold "Williams" and only the first five slots were rewritten. The game
 * stops at the terminator and never sees it. Zeroing the tail would be
 * semantically harmless but would change bytes the game did not ask us to
 * change, breaking the byte-attribution guard in editSave.ts. This mirrors the
 * rule already established for the wide string fields.
 *
 * Validated against PLGA, which stores the same 67 Washington players' names as
 * plain text written by the game itself.
 */
export function encodeName(
  name: string,
  prefix: 'PF' | 'PL',
  maxChars: number,
): Record<string, number> {
  if (name.length > maxChars) {
    throw new Error(
      `${JSON.stringify(name)} is ${name.length} characters; ` +
        `${prefix === 'PF' ? 'first' : 'last'} names hold at most ${maxChars}`,
    );
  }
  const field = (i: number) => `${prefix}${String(i).padStart(2, '0')}`;
  const out: Record<string, number> = {};
  for (let i = 1; i <= name.length; i++) out[field(i)] = encodeNameChar(name[i - 1]);
  // A name that exactly fills the field has nowhere to put a terminator. No
  // such name exists in this save, but the game clearly tolerates it -- the
  // same situation occurs in COCH.CLLN.
  if (name.length < maxChars) out[field(name.length + 1)] = 0;
  return out;
}

/**
 * Offset added to `PLAY.PWGT` to get pounds.
 *
 * CONFIRMED by in-game ground truth. The label audit could not settle this from
 * the file alone: the raw field spans 0..226 with a genuine floor (25 players
 * sit at raw 0), so the offset is whatever the lightest representable player
 * weighs, and both 160 and 165 produced believable weights, BMIs and positional
 * ordering. Offset 165 actually fit published positional averages slightly
 * better, but a uniform 5 lb bias was equally explained by those reference
 * averages being 5 lb heavy -- real evidence with no discriminating power.
 *
 * Resolved by reading one weight out of the game: Darius Whitaker, #94 DT,
 * Washington, stored raw 175, listed in-game at 335 lb. 175 + 160 = 335, so the
 * offset is 160 and not 165.
 */
export const PLAYER_WEIGHT_OFFSET = 160;

/** Displayed weight in pounds. */
export function playerWeight(record: Record<string, number | string>): number {
  const raw = record.PWGT;
  return typeof raw === 'number' ? raw + PLAYER_WEIGHT_OFFSET : NaN;
}

/** Displayed height, e.g. 71 -> `5'11"`. PHGT is inches with no offset. */
export function playerHeight(record: Record<string, number | string>): string {
  const inches = record.PHGT;
  if (typeof inches !== 'number') return '';
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/**
 * Number of PGID slots reserved per team.
 *
 * PLAY has no TGID field. Instead a player's team is encoded arithmetically in
 * the PGID: each team owns a contiguous block of 70 ids.
 *
 *     TGID       = floor(PGID / 70)
 *     rosterSlot = PGID % 70
 *
 * Found by gap analysis of the sorted PGID sequence: runs begin at 70, 140,
 * 210, 350, 420, 490, ... all multiples of 70. Verified -- this yields exactly
 * 119 teams (the FBS count), no roster exceeds 70 players, every derived id
 * exists in TEAM.TGID, and all 119 cover a full set of positions.
 *
 * Note the block size is NOT a power of two, which is why bit-shift splits of
 * PGID all failed.
 */
export const TEAM_ROSTER_BLOCK = 70;

/** The team (TGID) that owns a given player id. */
export function playerTeam(pgid: number): number {
  return Math.floor(pgid / TEAM_ROSTER_BLOCK);
}

/** The player's slot within their team's roster block (0..69). */
export function playerRosterSlot(pgid: number): number {
  return pgid % TEAM_ROSTER_BLOCK;
}

/**
 * PPOS enum. Confirmed by physical profile: the OL group is heaviest, K/P are
 * ~1 per team, CB is the most numerous, and depth charts order positions this
 * way.
 */
export const PLAYER_POSITIONS = [
  'QB',
  'HB',
  'FB',
  'WR',
  'TE',
  'LT',
  'LG',
  'C',
  'RG',
  'RT',
  'LE',
  'RE',
  'DT',
  'LOLB',
  'MLB',
  'ROLB',
  'CB',
  'FS',
  'SS',
  'K',
  'P',
] as const;

/** Class year enum for PYER. */
export const PLAYER_YEARS = ['FR', 'SO', 'JR', 'SR'] as const;

/**
 * Full display name for a TEAM record: `TDNA` holds the school ("Air Force")
 * and `TMNA` the nickname ("Falcons"). A handful of teams have no nickname.
 */
export function teamName(rec: Record<string, number | string>): string {
  const school = typeof rec.TDNA === 'string' ? rec.TDNA : '';
  const nickname = typeof rec.TMNA === 'string' ? rec.TMNA : '';
  return [school, nickname].filter(Boolean).join(' ');
}

/**
 * Team prestige and academic prestige are 1..6 star ratings (`TMPR` and
 * `TMAR`). Prestige drives recruiting; academics gates which recruits a school
 * can sign.
 */
export const TEAM_PRESTIGE_MIN = 1;
export const TEAM_PRESTIGE_MAX = 6;

/**
 * Shared "no team" sentinel. 511 is the maximum value of the 9-bit team-id
 * field, and several tables use it to mean "this slot has no team".
 *
 *  - `COCH.TGID` = 511 marks an unemployed coach (93 free agents).
 *  - `SCHD.GATG` / `SCHD.GHTG` = 511 marks a postseason slot whose
 *    participants are not yet determined (34 bowl and championship slots).
 */
export const NO_TEAM = 511;

/**
 * Defensive playbook ids occupy 125..129 in both `COCH.CDID` and `TEAM.TDPB`.
 * Offensive playbooks (`COCH.CPID` / `TEAM.TOPB`) run 0..124, one per school.
 */
export const DEFENSIVE_PLAYBOOK_MIN = 125;
export const DEFENSIVE_PLAYBOOK_MAX = 129;

/** Full name for a COCH record. Most saves ship with generic placeholders. */
export function coachName(rec: Record<string, number | string>): string {
  const first = typeof rec.CLFN === 'string' ? rec.CLFN : '';
  const last = typeof rec.CLLN === 'string' ? rec.CLLN : '';
  return [first, last].filter(Boolean).join(' ');
}

/**
 * `SCHD.GSTA` records the RESULT of a game, not whether it has been played.
 * Verified against the 68 completed games in this save: every one of the 20
 * away-team wins has GSTA=1 and every one of the 48 home-team wins has GSTA=2,
 * with no scored game left at 0.
 */
export const GAME_UNPLAYED = 0;
export const GAME_AWAY_WON = 1;
export const GAME_HOME_WON = 2;

/** Winner of a SCHD game, or null if it has not been played yet. */
export function gameWinner(
  rec: Record<string, number | string>,
): 'away' | 'home' | null {
  const status = rec.GSTA;
  if (status === GAME_AWAY_WON) return 'away';
  if (status === GAME_HOME_WON) return 'home';
  return null;
}

/**
 * `SCHD.GDAT` is a Monday-based day index. Anchored by the eight week-20 bowl
 * slots, which all carry GDAT=0: those are the New Year's Day games, and
 * January 1 2007 fell on a Monday. Saturday (5) holds 691 of the 785 games.
 */
export const GAME_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/**
 * `SCHD.SEWT` labels the kind of week. It tracks `SEWN` exactly through the
 * regular season (0..13) and then switches to a sparse code for the
 * postseason, which is why the two fields diverge after week 13.
 */
export const WEEK_TYPES: Record<number, string> = {
  15: 'Conference Championship',
  30: 'Bowl (early)',
  31: 'Bowl (main)',
  32: 'Bowl (New Year)',
  40: 'National Championship',
};

/**
 * `SCHD.GTOD` is the kickoff time in minutes past midnight. Every value in the
 * file is a multiple of 15 and they span 660 (11:00am) to 1320 (10:00pm).
 */
export function kickoffTime(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, '0')}${hour24 < 12 ? 'am' : 'pm'}`;
}

/**
 * `STAD.STYP` marks a domed stadium. The field is a 1-bit *signed* value, so it
 * reads as -1 rather than 1. All 16 rows that carry it are genuine domes
 * (Carrier Dome, Superdome, Metrodome, Kibbie Dome, ...), and 15 of the 16 have
 * every weather probability pinned to zero.
 */
export const STADIUM_INDOOR = -1;
export const STADIUM_OUTDOOR = 0;

/** True if a STAD record describes an indoor stadium. */
export function isIndoorStadium(rec: Record<string, number | string>): boolean {
  return rec.STYP === STADIUM_INDOOR;
}

/**
 * `STAD.STDR` sentinel. Exactly the 119 stadiums that are *not* an FBS team's
 * home ground carry 127; every FBS home stadium has a value below it. The
 * non-sentinel values are not team ids (they match a TGID's school name only
 * 2/119 times), so STDR is some per-stadium asset index whose target is
 * unidentified.
 */
export const STADIUM_NO_DETAIL = 127;

/**
 * Stadium weather probabilities, as percentages. Validated against real
 * geography: snow concentrates in New England, Montana and Denver, and the
 * rainiest stadium in the file is Autzen Stadium in Eugene, Oregon.
 */
export const STADIUM_WEATHER_FIELDS = ['SWFP', 'SWRP', 'SWSP', 'SWWP'] as const;

/**
 * `STAD.SFTY` is the playing surface. 0 is natural grass (all seven canonical
 * grass stadiums carry it) and 4 is artificial turf (all six canonical turf
 * stadiums carry it). Codes 1, 2, 3 and 5 are further surface variants that
 * this save does not let us separate -- the Rose Bowl is real grass but reads
 * 1, so they are probably visual variants rather than a grass/turf split.
 */
export const SURFACE_GRASS = 0;
export const SURFACE_TURF = 4;



/**
 * `BOWL.SGID` normally points at a `STAD.SGID`, but two of the 34 postseason
 * slots carry 255 instead -- the maximum value of the 8-bit field, and the
 * classic shape of a sentinel.
 *
 * The two slots are the Conference USA championship game and the BCS national
 * championship game, and those are precisely the two whose venue genuinely
 * cannot be known before the season is played: C-USA hosts its title game at
 * the higher-seeded division winner's stadium, and the BCS title game site is
 * not fixed to a bowl. Every bowl with a permanent home resolves.
 */
export const BOWL_VENUE_TBD = 255;

/**
 * `TEAM.DGID` is a foreign key into `DIVI`, but only for the ten teams-per-
 * division conferences that actually split. Everyone else carries 15, which is
 * all-ones in the field's 4 bits — the format's usual "no value" sentinel, the
 * same trick `BOWL.SGID = 255` plays in 8 bits.
 *
 * Do not read 15 as a division id: `DIVI` has no row 15, and the 143 teams that
 * carry it span 17 different conferences, so it cannot be a division.
 */
export const DIVISION_NONE = 15;

/** True when the team belongs to a conference that plays in divisions. */
export function hasDivision(rec: Record<string, number | string>): boolean {
  return typeof rec.DGID === 'number' && rec.DGID !== DIVISION_NONE;
}

/**
 * `AAPL` holds all-conference selections: one row per (conference, team, slot).
 * `TTYP` is the team tier -- 0 = first team, 1 = second team. (The tag is
 * reused from `TEAM.TTYP`, where it means FBS/FCS; here it does not.)
 */
export const ALL_CONF_FIRST_TEAM = 0;
export const ALL_CONF_SECOND_TEAM = 1;

/**
 * An all-conference team is 25 slots: the 21 positions once each, plus a second
 * slot for the four positions a base formation fields two of.
 */
export const ALL_CONF_TEAM_SIZE = 25;
export const ALL_CONF_DOUBLED_POSITIONS = [1, 3, 12, 16];

/**
 * `WQTS` is a quarter-by-quarter line score: four rows per completed game,
 * keyed by `(SEWN, SGNM)` exactly as `BOWL` is. `GHSC` / `GASC` are that
 * quarter's points, not a running total -- they sum to `SCHD`'s final score.
 */
export const QUARTERS_PER_GAME = 4;

/**
 * `PSOF` and `PSDE` are PER-GAME statistic lines, not season totals: every row
 * carries `sgmp == 1`, and only week 0 has been played.
 *
 * `PSOF`'s column names follow `s` + category + stat, where the category letter
 * is the *second* character:
 *   `sa**` passing   -- 100% of nonzero rows are QBs
 *   `sc**` receiving -- WR/HB/TE/FB
 *   `su**` rushing   -- HB/QB/FB/WR
 *
 * This is mnemonic-grade on its own. What establishes it is that the three
 * categories satisfy football's bookkeeping identities across a whole team:
 * receiving yards sum to passing yards, catches to completions, receiving
 * touchdowns to passing touchdowns. See `validateStatTables.ts`.
 */
export const STAT_CATEGORY_PASSING = 'a';
export const STAT_CATEGORY_RECEIVING = 'c';
export const STAT_CATEGORY_RUSHING = 'u';

/** `PSOF` columns, by the identity each one participates in. */
export const PASSING_FIELDS = {
  attempts: 'saat',
  completions: 'sacm',
  yards: 'saya',
  touchdowns: 'satd',
  interceptions: 'sain',
  sacked: 'sasa',
  longest: 'salN',
} as const;

export const RECEIVING_FIELDS = {
  catches: 'scca',
  yards: 'scya',
  touchdowns: 'sctd',
  longest: 'scrL',
  drops: 'scdr',
} as const;

export const RUSHING_FIELDS = {
  carries: 'suat',
  yards: 'suya',
  touchdowns: 'sutd',
  longest: 'sulN',
  brokenTackles: 'subt',
  yardsAfterContact: 'suyh',
  fumbles: 'sufu',
} as const;

export const DEFENSIVE_FIELDS = {
  tackles: 'sdta',
  tacklesForLoss: 'sdtl',
  sacks: 'slsk',
  passesDefended: 'sdpd',
  interceptions: 'ssin',
  interceptionYards: 'ssiy',
  defensiveTouchdowns: 'ssdt',
  forcedFumbles: 'slff',
  fumbleRecoveries: 'slfr',
  fumbleReturnYards: 'slfy',
} as const;

/**
 * `PSOF.scyc` is 13 bits and 24 rows sit at all-ones (8191). That is the
 * format's usual sentinel shape, but the field's meaning is NOT established --
 * it is not reliably bounded by receiving yards, so "yards after catch" does
 * not survive testing. Left unidentified on purpose.
 */
export const STAT_VALUE_SENTINEL = 8191;

/**
 * Only FBS teams have stat rows, because only FBS teams have rosters in `PLAY`
 * (see PLGA). Any offence-versus-defence identity therefore has to be
 * restricted to FBS-versus-FBS games or it will appear to fail.
 */
export function isFbsTeam(tgid: number, fbsTeams: Set<number>): boolean {
  return fbsTeams.has(tgid);
}

/**
 * True when a `SCHD` game has been played. Established via `WQTS`: every game
 * with quarter data has a non-zero score somewhere and sums correctly, and the
 * three week-0 games without quarter data are the three still to be played.
 *
 * Note a 0-0 final is impossible in this data set, so absence of quarter rows
 * is the reliable signal rather than a zero score.
 */
export function hasQuarterData(
  sgnm: number,
  sewn: number,
  quarters: Array<Record<string, number | string>>,
): boolean {
  return quarters.some((q) => q.SGNM === sgnm && q.SEWN === sewn);
}

/**
 * `BOWL.BCI1` / `BCI2` name the two conferences a slot is tied to, as
 * `CONF.CGID` values, and `BCR1` / `BCR2` give the finishing position that
 * conference must supply (1 = champion, 2 = runner-up, ...).
 *
 * An at-large berth is encoded as conference `Generic` with rank 0. In this
 * save that combination appears on exactly the three slots that really are
 * at-large in the BCS: the Fiesta and Sugar Bowls' second team and both sides
 * of the national championship game.
 */
export const CONFERENCE_GENERIC = 17;
export const BOWL_RANK_AT_LARGE = 0;

/**
 * A conference championship game is the degenerate case of a bowl tie-in: both
 * sides are drawn from the same conference, and both are nominally the "#1"
 * finisher because the two division winners each top their own division.
 */
export function isConferenceChampionship(
  rec: Record<string, number | string>,
): boolean {
  return (
    typeof rec.BCI1 === 'number' &&
    rec.BCI1 === rec.BCI2 &&
    rec.BCI1 !== CONFERENCE_GENERIC
  );
}

/**
 * Render a `BOWL` record's `BMON`/`BDAY` as a real date. The bowl season
 * straddles the new year, so the year follows from the month: December belongs
 * to the season's own year and January to the next.
 */
export function bowlDate(
  rec: Record<string, number | string>,
  seasonYear: number,
): Date {
  const month = Number(rec.BMON);
  return new Date(month >= 7 ? seasonYear : seasonYear + 1, month - 1, Number(rec.BDAY));
}



/**
 * `PLGA` is the roster cache for the next game to be played. It holds both
 * participating squads, and it is the only table that stores player names as
 * plain text rather than packed 6-bit characters.
 *
 * Players belonging to an FCS opponent are GENERATED rather than stored: they
 * have no `PLAY` row anywhere in the file, an empty `PFNA`, and a `PLNA` of the
 * form "<position> #<jersey>". That is why `PLAY` only ever contained the 119
 * FBS rosters.
 */
export function isGeneratedPlayer(rec: Record<string, number | string>): boolean {
  return rec.PFNA === '';
}

/** Matches a generated player's placeholder name, e.g. "MLB #52". */
export const GENERATED_NAME_PATTERN = /^([A-Z]+) #(\d+)$/;

/**
 * `PLGA.SNPD` and `SNPO` each flag exactly 22 players: 11 from the home side
 * on offence and 11 from the visitors on defence. They are two saved personnel
 * packages for the same matchup -- in this save a three-receiver set against a
 * nickel secondary, and a two-tight-end set against an extra linebacker.
 *
 * Which of the pair is which is NOT established. Both hold a complete legal
 * lineup, so nothing in this file distinguishes them.
 */
export const LINEUP_SIZE = 11;

/** Positions that line up on offence, used to check a lineup is well formed. */
export const OFFENSIVE_POSITIONS = [
  'QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
] as const;



/**
 * Rating fields that use the shared 5-bit quantised scale.
 *
 * `PRBK` is 6 bits wide but still stores a value in the 0..31 range and maps
 * through the same table (Zach Morris' run block reads raw 0 and displays 40,
 * identical to the 5-bit fields).
 */
export const RATING_FIELDS = [
  'POVR', 'PSPD', 'PSTR', 'PAWR', 'PACC', 'PAGI', 'PCAR', 'PCTH',
  'PJMP', 'PTAK', 'PSTA', 'PINJ', 'PTHP', 'PTHA', 'PBTK', 'PPBK',
  'PRBK', 'PKPR', 'PKAC',
] as const;

/**
 * Convert a stored rating to the value the game displays.
 *
 * Ratings are stored as a 5-bit index (0..31) into a non-uniform quantisation
 * of the displayed 40..99 range. The game spends its limited bit budget
 * coarsely at the bottom -- where the difference between a 40 and a 44 is
 * irrelevant -- and finely at the top, where one point of Speed decides
 * matchups. The result is a piecewise-linear curve with slopes 4, 3, 2, 1:
 *
 *   raw  0..4   slope 4   display 40..56
 *   raw  4..8   slope 3   display 56..68
 *   raw  8..16  slope 2   display 68..84
 *   raw 16..31  slope 1   display 84..99
 *
 * The table is complete. 30 of the 32 entries were observed directly in game
 * across five players; the remaining two (raw 28, 31) are forced by strict
 * monotonicity between confirmed neighbours. The model was also validated
 * out-of-sample, predicting 11 values -- including all three-way ambiguous
 * entries -- before they were looked up. Endpoints are exactly 40 and 99.
 */
export function ratingToDisplay(raw: number): number {
  if (raw <= 4) return 40 + 4 * raw;
  if (raw <= 8) return 56 + 3 * (raw - 4);
  if (raw <= 16) return 68 + 2 * (raw - 8);
  return 84 + (raw - 16);
}

/**
 * Inverse of {@link ratingToDisplay}: the raw value to store for a displayed
 * rating. Values that fall between quantisation steps (e.g. 41 in the coarse
 * lower segment) snap down to the nearest representable rating, so this is
 * lossy by design -- the format simply cannot express them.
 */
export function displayToRating(display: number): number {
  const d = Math.max(40, Math.min(99, display));
  if (d <= 56) return Math.floor((d - 40) / 4);
  if (d <= 68) return 4 + Math.floor((d - 56) / 3);
  if (d <= 84) return 8 + Math.floor((d - 68) / 2);
  return 16 + (d - 84);
}

export function hex(n: number, pad = 8): string {
  return `0x${n.toString(16).toUpperCase().padStart(pad, '0')}`;
}

/* ------------------------------------------------------------------ *
 * TSSE -- team season statistics
 * ------------------------------------------------------------------ */

/**
 * Several TSSE yardage columns are declared unsigned but genuinely hold
 * negative values: a team can finish with negative rushing yards. The same
 * quirk appears in PSOF.suya. Read them through this helper.
 *
 * Idaho is the live example in this save -- 65535 raw, i.e. -1 rushing yard,
 * which is what makes `tsor + tsop == tsoy` hold 109/109 instead of 108/109.
 */
export function signed16(raw: number): number {
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

/**
 * TSSE stores each team's own production AND what it allowed. For every
 * (own, allowed) pair below, a team's value equals its opponent's mirror
 * value. Verified 82/82 on FBS-vs-FBS week-0 games, with 0/11,690 false
 * positives across every non-opponent pairing.
 */
export const TSSE_MIRROR_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['tsop', 'tsdp'], // pass yards gained / allowed
  ['tsor', 'tsdy'], // rush yards gained / allowed
  ['tssa', 'tssk'], // sacks taken / sacks made
  ['tspi', 'tsDi'], // interceptions thrown / made
  ['tsfl', 'tsfr'], // fumbles lost / recovered
  ['tsof', 'tsdf'], // unidentified mirror pair
  ['tsta', 'tsga'], // unidentified mirror pair
] as const;

/**
 * PSKI records field goals in five distance buckets. The ranges were derived
 * empirically from kickers with exactly one make, not assumed: the long-FG
 * column lands inside the bucket's range every time.
 *
 * League-wide make rate falls monotonically across the buckets
 * (100%, 83%, 82%, 29%, 8%), which is what real kicking looks like.
 */
export const FG_BUCKETS: ReadonlyArray<{
  att: string;
  made: string;
  min: number;
  max: number;
  label: string;
}> = [
  { att: 'skaa', made: 'skma', min: 0, max: 19, label: 'under 20' },
  { att: 'skab', made: 'skmb', min: 20, max: 29, label: '20-29' },
  { att: 'skac', made: 'skmc', min: 30, max: 39, label: '30-39' },
  { att: 'skad', made: 'skmd', min: 40, max: 49, label: '40-49' },
  { att: 'skae', made: 'skme', min: 50, max: 99, label: '50+' },
] as const;

/** Points awarded for each scoring play, used to reconstruct a team's total. */
export const POINTS_TOUCHDOWN = 6;
export const POINTS_FIELD_GOAL = 3;
export const POINTS_EXTRA_POINT = 1;
export const POINTS_TWO_POINT = 2;
export const POINTS_SAFETY = 2;
