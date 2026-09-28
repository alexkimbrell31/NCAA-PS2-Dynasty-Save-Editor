/**
 * Fit the rating scale.
 *
 * The rating fields are narrow (mostly 5 bits = 0..31) but the game displays
 * 0..99. We have three known players with their in-game ratings, so we can
 * locate them by the fields we already trust (name, position, jersey, height,
 * weight, class) and then read off the raw rating values.
 */

import {
  PLAYER_POSITIONS,
  PLAYER_YEARS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

interface Known {
  first: string;
  last: string;
  team: string;
  ovr: number;
  spd: number;
  str: number;
  awr: number;
  year: string;
  heightIn: number;
  weightLb: number;
  pos: string;
  jersey: number;
}

const KNOWN: Known[] = [
  {
    first: 'Nick', last: 'Moore', team: 'Oklahoma',
    ovr: 98, spd: 93, str: 80, awr: 87,
    year: 'JR', heightIn: 74, weightLb: 210, pos: 'HB', jersey: 28,
  },
  {
    first: 'Seth', last: 'Harris', team: 'Georgia Tech',
    ovr: 98, spd: 93, str: 74, awr: 90,
    year: 'JR', heightIn: 76, weightLb: 235, pos: 'WR', jersey: 21,
  },
  {
    first: 'Alan', last: 'James', team: 'Notre Dame',
    ovr: 97, spd: 62, str: 65, awr: 95,
    year: 'SR', heightIn: 76, weightLb: 224, pos: 'QB', jersey: 10,
  },
];

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const playEntry = findTable(toc, 'PLAY');
  const playHeader = parseTableHeader(buf, playEntry.realOffset);
  const playFields = parseFieldDescriptors(buf, playHeader);
  const recs = readRecords(buf, playHeader, playFields);

  const teamEntry = findTable(toc, 'TEAM');
  const teamHeader = parseTableHeader(buf, teamEntry.realOffset);
  const teamFields = parseFieldDescriptors(buf, teamHeader);
  const teamRecs = readRecords(buf, teamHeader, teamFields);
  const teamName = new Map<number, string>();
  for (const t of teamRecs) {
    const nm = [t.TMNA, t.TDNA].filter((v) => typeof v === 'string' && v).join(' ');
    teamName.set(num(t.TGID), nm.trim());
  }

  const widths = new Map(playFields.map((f) => [f.name, f.bits]));

  for (const k of KNOWN) {
    const hits = recs.filter((r) => {
      const n = playerName(r);
      return n.first === k.first && n.last === k.last;
    });

    console.log(`\n=== ${k.first} ${k.last} (${k.team}) — ${hits.length} name match(es) ===`);
    for (const r of hits) {
      const tgid = playerTeam(num(r.PGID));
      const pos = PLAYER_POSITIONS[num(r.PPOS)];
      const yr = PLAYER_YEARS[num(r.PYER)];
      const ht = num(r.PHGT);
      const wt = num(r.PWGT) + 160;
      const jer = num(r.PJEN);

      // Score the match against the attributes we already trust.
      const agree = [
        pos === k.pos,
        jer === k.jersey,
        ht === k.heightIn,
        wt === k.weightLb,
        yr === k.year,
        (teamName.get(tgid) ?? '').toLowerCase().includes(k.team.toLowerCase().split(' ')[0]),
      ];
      const score = agree.filter(Boolean).length;

      console.log(
        `  TGID ${String(tgid).padStart(3)} ${(teamName.get(tgid) ?? '?').padEnd(26)} ` +
          `${pos.padEnd(4)} #${String(jer).padStart(2)} ` +
          `${Math.floor(ht / 12)}'${ht % 12}" ${wt}lb ${yr}  match ${score}/6`,
      );

      if (score >= 5) {
        console.log(`  >>> CONFIRMED. Raw rating values:`);
        const ratingFields = playFields
          .filter((f) => /^P(OVR|SPD|STR|AWR|ACC|AGI|CAR|CTH|JMP|TAK|INJ|STA|KPR|KAC|THP|THA|BTK|ELU|RBK|PBK)$/.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        const rows = ratingFields.map((f) => ({
          field: f.name,
          bits: f.bits,
          max: (1 << f.bits) - 1,
          raw: num(r[f.name]),
        }));
        console.table(rows);

        console.log('  Known in-game:');
        console.table([
          { stat: 'Overall', field: 'POVR', bits: widths.get('POVR'), raw: num(r.POVR), inGame: k.ovr },
          { stat: 'Speed', field: 'PSPD', bits: widths.get('PSPD'), raw: num(r.PSPD), inGame: k.spd },
          { stat: 'Strength', field: 'PSTR', bits: widths.get('PSTR'), raw: num(r.PSTR), inGame: k.str },
          { stat: 'Awareness', field: 'PAWR', bits: widths.get('PAWR'), raw: num(r.PAWR), inGame: k.awr },
        ]);
      }
    }
  }
}

main();
