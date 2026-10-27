// Reads the training plan workbook (one grid of cell values per tab) into the long format
// of the summary sheet: Block, Week, Date, Exercise, Variation, Set, Weight, Reps.
// Same rules as the extraction used to build the sheet; names come from mappings.js.
(() => {
  const SKIP_SHEETS = new Set(['PRs & Sonstiges', 'Körpergewicht', 'Notizen Telefonat']);
  const DATE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
  const UNIT = /^(\d+(?:[.,]\d+)?)\s*(kg)?$/i;
  const COUNT = /^(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg)?$/i;
  const REP = /^(\d+)(?:\s+(?!sec|sek|s$|min|m$)[a-zäöü]+)?$/i;
  const NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

  const s = (v) => (v == null ? '' : String(v).trim());
  const num = (x) => { const t = x.trim().replaceAll(',', '.'); return NUM.test(t) ? Number(t) : null; };
  const split = (x) => x.split('/').map((p) => p.trim()).filter(Boolean);
  const loadList = (x) => split(x).flatMap((p) => {
    let m = COUNT.exec(p);
    if (m) return Array(Number(m[1])).fill(num(m[2]));
    m = UNIT.exec(p);
    return [m ? num(m[1]) : null];
  });
  const repList = (x) => split(x).map((p) => { const m = REP.exec(p); return m ? Number(m[1]) : null; });
  const colName = (c) => { let n = ''; for (; c > 0; c = Math.floor((c - 1) / 26)) n = String.fromCharCode(65 + ((c - 1) % 26)) + n; return n; };
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  const iso = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // One tab: the training days ("Tag …" titles over Sets/Reps/Load headers) and their sets.
  const parseTab = (title, values, out) => {
    const get = (r, c) => s(values[r - 1]?.[c - 1]);
    const maxRow = values.length;
    const headers = [];
    values.forEach((row, ri) => row.forEach((v, ci) => {
      const r = ri + 1, c = ci + 1;
      if (s(v) === 'Sets' && get(r, c + 1) === 'Reps' && get(r, c + 2) === 'Load') headers.push([r, c]);
    }));
    const cols = new Map();
    headers.sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach(([r, c]) => { if (!cols.has(c)) cols.set(c, []); cols.get(c).push(r); });
    for (const [c, rows] of cols) {
      rows.sort((a, b) => a - b);
      const top = rows[0] - 1;
      let week = '';
      for (const rr of [top - 1, top - 2]) for (let cc = c - 1; cc < c + 4; cc++) {
        const v = get(rr, cc);
        if (v && !v.startsWith('Tag') && !v.startsWith('http')) week = week || v;
      }
      rows.forEach((r, i) => {
        let exCol = null;
        for (let cc = c - 1; cc > Math.max(0, c - 10); cc--) if (get(r, cc).startsWith('Übung')) { exCol = cc; break; }
        let dayTitle = '';
        outer: for (const rr of [r - 1, r - 2]) for (const cc of [c, c - 1, c + 1]) if (get(rr, cc).startsWith('Tag')) { dayTitle = get(rr, cc); break outer; }
        const m = DATE.exec(dayTitle);
        if (!m || exCol == null) return;
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        const date = iso(+m[1], +m[2], y);
        const end = i + 1 < rows.length ? rows[i + 1] - 2 : maxRow;
        let ex = '';
        for (let rr = r + 1; rr <= end; rr++) {
          const name = get(rr, exCol);
          if (name.startsWith('Tag') || get(rr, c).startsWith('Tag')) break;
          if (name) ex = name;
          const nset = get(rr, c), reps = get(rr, c + 1), load = get(rr, c + 2);
          if (!(nset || reps || load)) continue;
          const base = { sheet: title, week, date, exercise: ex, cell: title + '!' + colName(c) + rr, raw: `${nset} | ${reps} | ${load}` };
          let n = num(nset);
          const groups = [...reps.matchAll(/(\d+)\s*x\s*(\d+)/g)];
          const replist = groups.length && !/[a-wyz]/.test(reps.toLowerCase().replaceAll('x', ''))
            ? groups.flatMap((g) => Array(Number(g[1])).fill(Number(g[2])))
            : repList(reps);
          const loads = loadList(load);
          if (n == null || !Number.isInteger(n) || !replist.length || replist.includes(null)) { out.log.push({ ...base, why: 'Sätze/Wdh. nicht lesbar' }); continue; }
          if (groups.length) n = replist.length;
          if (!loads.length || loads.includes(null)) { out.log.push({ ...base, why: 'kein eindeutiges Gewicht' }); continue; }
          const mismatch = ![1, n].includes(replist.length) || ![1, n].includes(loads.length);
          if (mismatch) out.log.push({ ...base, why: 'Sätze/Werte ungleich, mit dem letzten Wert aufgefüllt', kept: true });
          for (let k = 0; k < n; k++) out.sets.push({ ...base, reps: replist[Math.min(k, replist.length - 1)], weight: loads[Math.min(k, loads.length - 1)] });
        }
      });
    }
  };

  // Competition days: "Competition (Weekday, dd.mm.yyyy)" with a Sets/Reps/Load header below
  const parseComp = (title, values, out, MP) => {
    const get = (r, c) => values[r - 1]?.[c - 1];
    values.forEach((row, ri) => row.forEach((v, ci) => {
      const m = typeof v === 'string' && /^Competition \(\w+, (\d{2})\.(\d{2})\.(\d{4})\)/.exec(v);
      if (!m) return;
      const hr = ri + 2;
      const hdr = {};
      (values[hr - 1] || []).forEach((h, k) => { if (h !== '' && h != null) hdr[String(h).trim()] = k + 1; });
      const ueb = Object.entries(hdr).filter(([h, k]) => h.startsWith('Übung') && k < hdr.Sets + 1).map(([, k]) => k);
      const nameCol = Object.keys(hdr).some((h) => h.startsWith('Übung')) ? Math.max(...ueb) : ci + 1 - 4;
      for (let r = hr + 1; r < hr + 8; r++) {
        let name = get(r, nameCol);
        if (!name) continue;
        name = norm(String(name));
        const ex = Object.entries({ squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }).find(([k]) => name.toLowerCase().includes(k))?.[1];
        const loads = String(get(r, hdr.Load)).split('/').map((x) => num(x));
        const reps = Math.trunc(num(String(get(r, hdr.Reps))));
        if (!ex || loads.includes(null) || loads.length !== num(String(get(r, hdr.Sets)))) { out.log.push({ sheet: title, date: iso(+m[1], +m[2], m[3]), exercise: name, cell: title + '!' + colName(nameCol) + r, raw: '', why: 'Wettkampfzeile nicht lesbar' }); continue; }
        loads.forEach((w, i) => out.comp.push([title.trim(), 'Competition', iso(+m[1], +m[2], m[3]), ex, MP.COMP_NAME[ex], i + 1, w, reps]));
      }
    }));
  };

  // tabs: [{ title, values }] in workbook order; untilIso: last date to include (today)
  const extract = (tabs, untilIso, MP = globalThis.MAPPINGS) => {
    const out = { sets: [], log: [], comp: [] };
    for (const t of tabs) {
      parseComp(t.title, t.values, out, MP);
      if (!SKIP_SHEETS.has(t.title)) parseTab(t.title, t.values, out);
    }
    const weekNo = (w) => { const m = /^Week\s*(\d+)/.exec(w.trim()); return m ? m[1] : w.trim(); };
    const main = [], acc = [], notes = [];
    const mainNo = new Map(), accNo = new Map();
    const next = (map, key) => { const n = (map.get(key) || 0) + 1; map.set(key, n); return n; };
    for (const x of out.sets) {
      if (x.date > untilIso) continue;
      const name = norm(x.exercise);
      const sheet = x.sheet.trim();
      const reps = Math.trunc(x.reps);
      if (MP.MAIN[name]) {
        const ex = MP.MAIN[name];
        let w = x.weight;
        if (ex === 'Bench' && w > 200) { notes.push({ date: x.date, cell: x.cell, exercise: name, raw: x.raw, why: `${w} kg als ${w / 10} kg übernommen` }); w = w / 10; }
        main.push([sheet, weekNo(x.week), x.date, ex, name, next(mainNo, x.date + '|' + ex + '|' + name), w, reps]);
      } else {
        const renamed = MP.ACC_RENAME[name.toLowerCase()] || name;
        const [ex, variation] = MP.EXVAR[renamed] || [renamed, ''];
        acc.push([sheet, weekNo(x.week), x.date, ex, variation, next(accNo, x.date + '|' + ex + '|' + variation), x.weight, reps]);
      }
    }
    const byDate = (a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
    const mainRows = [...main, ...out.comp].map((r) => { r[4] = MP.RENAME[r[4].toLowerCase()] || r[4]; return r; }).sort(byDate);
    const rows = [...mainRows, ...acc.sort(byDate)].sort(byDate);
    for (const e of out.log) if (e.date <= untilIso && (e.kept || MP.MAIN[norm(e.exercise)] || e.why.startsWith('Wettkampf'))) notes.push(e);
    const seen = new Set();
    return { rows, notes: notes.filter((n) => { const k = n.cell + n.why; return !seen.has(k) && seen.add(k); }).sort((a, b) => (a.date < b.date ? 1 : -1)) };
  };

  globalThis.Extract = { extract };
  if (typeof module !== 'undefined') module.exports = { extract };
})();
