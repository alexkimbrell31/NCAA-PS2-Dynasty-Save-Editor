/**
 * Find how a player maps to a team.
 *
 * PLAY has no TGID field, so the roster relationship lives elsewhere. This
 * scans every table for:
 *   - fields named like team keys (TGID/TEAM/...)
 *   - fields whose value domain matches the ~119-250 team range
 *   - fields that reference PLAY.PGID
 *
 * and reports which tables could carry the player->team edge.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const fileHeader = parseFileHeader(buf);
  const toc = parseToc(buf, fileHeader);

  // Reference sets.
  const play = (() => {
    const e = findTable(toc, 'PLAY');
    const h = parseTableHeader(buf, e.realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { header: h, records: readRecords(buf, h, f) };
  })();
  const pgids = new Set(play.records.map((r) => num(r.PGID)));

  console.log(`PLAY: ${play.records.length} players, PGID set size ${pgids.size}\n`);

  // Where is the team list?
  console.log('=== Tables whose record count is near the team count (~119 FBS / ~250 total) ===');
  for (const entry of toc) {
    const h = parseTableHeader(buf, entry.realOffset);
    if (h.currentRecords >= 100 && h.currentRecords <= 260) {
      const f = parseFieldDescriptors(buf, h);
      console.log(
        `  ${entry.name}: ${h.currentRecords} records, fields: ${f.map((x) => x.name).join(' ')}`,
      );
    }
  }

  // Which tables carry a field that looks like a team id or references players?
  console.log('\n=== Fields referencing PLAY.PGID, or named like a team key ===');
  for (const entry of toc) {
    const h = parseTableHeader(buf, entry.realOffset);
    if (h.currentRecords === 0) continue;
    const fields = parseFieldDescriptors(buf, h);
    const recs = readRecords(buf, h, fields);

    for (const f of fields) {
      if (f.isString) continue;
      const vals = recs.map((r) => num(r[f.name]));
      const distinct = new Set(vals);
      const min = Math.min(...vals);
      const max = Math.max(...vals);

      const looksLikeTeam =
        /TGID|TEAM|TID/i.test(f.name) || (min >= 0 && max <= 260 && distinct.size >= 100);
      const refsPlayers =
        f.bits >= 14 && vals.filter((v) => pgids.has(v)).length / vals.length > 0.9;

      if (looksLikeTeam || refsPlayers) {
        console.log(
          `  ${entry.name}.${f.name} (${f.bits}b) rows=${h.currentRecords} ` +
            `distinct=${distinct.size} range=${min}..${max}` +
            (refsPlayers ? '  <-- references PLAY.PGID' : '') +
            (looksLikeTeam ? '  <-- team-like' : ''),
        );
      }
    }
  }
}

main();
