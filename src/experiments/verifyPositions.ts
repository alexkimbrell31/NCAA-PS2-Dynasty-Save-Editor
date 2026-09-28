/**
 * Verify the PPOS enum by physical profile.
 *
 * The roster ordering suggests the standard NCAA position order, but position
 * names should be earned, not assumed. Offensive linemen must be the heaviest
 * group, kickers and punters the lightest and least numerous, cornerbacks the
 * most numerous, and so on. This prints the profile of each PPOS value so the
 * mapping can be confirmed against expectations.
 */

import {
  PLAYER_POSITIONS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const fileHeader = parseFileHeader(buf);
  const toc = parseToc(buf, fileHeader);

  const e = findTable(toc, 'PLAY');
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  const recs = readRecords(buf, h, f);

  const teams = new Set(recs.map((r) => playerTeam(num(r.PGID)))).size;

  const groups = new Map<number, typeof recs>();
  for (const r of recs) {
    const p = num(r.PPOS);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(r);
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  console.table(
    [...groups.keys()]
      .sort((a, b) => a - b)
      .map((p) => {
        const g = groups.get(p)!;
        const ht = avg(g.map((r) => num(r.PHGT)));
        const wt = avg(g.map((r) => num(r.PWGT) + 160));
        return {
          PPOS: p,
          proposed: PLAYER_POSITIONS[p] ?? '?',
          count: g.length,
          perTeam: (g.length / teams).toFixed(2),
          avgHeight: `${Math.floor(ht / 12)}'${Math.round(ht % 12)}"`,
          avgWeight: Math.round(wt),
          avgSpeed: avg(g.map((r) => num(r.PSPD))).toFixed(1),
          avgStrength: avg(g.map((r) => num(r.PSTR))).toFixed(1),
        };
      }),
  );

  console.log(
    '\nExpectations: OL (LT/LG/C/RG/RT) heaviest; K/P lightest and ~1 per team;\n' +
      'CB most numerous; QB ~3-4 per team; FB fewest of the skill positions.',
  );
}

main();
