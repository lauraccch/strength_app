// Stand-in for the dashboard runtime: reads both sheets through the Google Sheets API
// after a Google sign-in, keeps the last answer for offline use and serves it
// to the page's loaders and calcs.
(() => {
  // read and write: „Plan übernehmen“ writes the summary sheet (and only that one, see sync below)
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const cfg = window.APP_CONFIG;
  const clientId = () => cfg.clientId || store.get('clientId') || '';

  let raw = store.get('sheetData');          // { training: {values}, training_plan: {values}, fetchedAt }
  const loaders = {}, calcs = {}, subs = [];
  let cache = {};
  let params = { exercise: 'Squat' };
  const get = (id) => {
    if (cache[id]) return cache[id];
    try {
      if (calcs[id]) {
        const ins = calcs[id].inputs.map(get);
        const bad = ins.find((d) => d.status !== 'ok');
        cache[id] = bad ? { status: bad.status, data: [] } : { status: 'ok', data: calcs[id].fn(...ins.map((d) => d.data)) };
      } else if (loaders[id]) {
        if (!raw || !raw[id]) cache[id] = { status: 'loading', data: [] };
        else { const r = loaders[id].fn({ answer: raw[id] }); cache[id] = { status: 'ok', data: r.rows, columns: r.columns }; }
      } else cache[id] = { status: 'missing', data: [] };
    } catch (e) { console.error(id, e); cache[id] = { status: 'error', data: [], message: String(e) }; }
    return cache[id];
  };
  const run = () => subs.forEach((fn) => fn());
  let timer; window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  window.dash = {
    loader: (id, o) => { loaders[id] = o; },
    calc: (id, o) => { calcs[id] = o; },
    data: get,
    onData: (fn) => { subs.push(fn); fn(); },
    params: () => ({ ...params }),
    setParams: (p) => { params = { ...params, ...p }; run(); },
    resetParams: () => { params = { exercise: 'Squat' }; run(); },
    colors: ['#3b6fb6', '#e0742c', '#3a9a6a', '#c2457a', '#8a63c9', '#b8902a', '#2f9bb3', '#7d7d7d'],
  };

  // App bar
  const $ = (id) => document.getElementById(id);
  const status = (t, bad) => { const s = $('app-status'); s.textContent = t; s.classList.toggle('bad', !!bad); };
  const fStamp = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const showStamp = () => status(raw ? 'Stand: ' + fStamp(raw.fetchedAt) + (navigator.onLine ? '' : ' · offline') : 'Noch keine Daten geladen.');

  // Google sign-in (token flow: an access token for one hour, nothing stored at Google's side by the app)
  let tokenClient = null, pending = null;
  const token = () => { const t = store.get('token'); return t && t.exp > Date.now() + 60e3 ? t.value : null; };
  const initAuth = () => {
    if (tokenClient || !window.google?.accounts?.oauth2 || !clientId()) return !!tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope: SCOPE,
      callback: (r) => {
        const p = pending; pending = null;
        if (r.error) return p?.reject(new Error(r.error_description || r.error));
        store.set('token', { value: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 });
        p?.resolve(r.access_token);
      },
      error_callback: (e) => { const p = pending; pending = null; p?.reject(new Error(e.message || e.type || 'Anmeldung abgebrochen')); },
    });
    return true;
  };
  const signIn = () => new Promise((resolve, reject) => {
    if (!initAuth()) return reject(new Error('Google-Anmeldung ist noch nicht geladen. Bitte kurz warten.'));
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: store.get('consented') ? '' : 'consent' });
  });

  const api = async (t, path, init = {}) => {
    const r = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    if (r.status === 401) { store.del('token'); throw Object.assign(new Error('Anmeldung abgelaufen'), { auth: true }); }
    if (!r.ok) { const j = await r.json().catch(() => null); throw new Error('Google Sheets: ' + (j?.error?.message || r.status)); }
    return r.json();
  };
  const fetchSheet = (t, { id, range }) => api(t, `${id}/values/${encodeURIComponent(range)}`);
  // a token, signing in when needed; retries once when Google says the token is no longer valid
  const withToken = async (fn) => {
    let t = token();
    if (!t) { t = await signIn(); store.set('consented', true); }
    try { return await fn(t); }
    catch (e) { if (!e.auth) throw e; t = await signIn(); return fn(t); }
  };
  const refresh = async (interactive) => {
    if (!navigator.onLine) { showStamp(); return; }
    let t = token();
    if (!t && !interactive) { status(raw ? 'Stand: ' + fStamp(raw.fetchedAt) + ' · tippe „Aktualisieren“' : 'Tippe „Mit Google anmelden“, um die Daten zu laden.'); return; }
    $('app-refresh').disabled = true;
    try {
      status('Lade Daten …');
      const ids = Object.keys(cfg.sheets);
      const vals = await withToken((tk) => Promise.all(ids.map((k) => fetchSheet(tk, cfg.sheets[k]))));
      raw = Object.fromEntries(ids.map((k, i) => [k, { values: vals[i].values || [] }]));
      raw.fetchedAt = Date.now();
      if (!store.set('sheetData', raw)) console.warn('Offline-Kopie konnte nicht gespeichert werden.');
      cache = {}; run(); showStamp();
    } catch (e) {
      console.error(e);
      status((raw ? 'Stand: ' + fStamp(raw.fetchedAt) + ' · ' : '') + 'Aktualisieren fehlgeschlagen: ' + e.message, true);
    } finally { $('app-refresh').disabled = false; setButtons(); }
  };
  // „Plan übernehmen“: read the training plan, extract with the same rules and names as before,
  // compare with the summary sheet, show what would change and write only after a tap.
  const TARGET = cfg.sheets.training_plan, TAB = TARGET.range.split('!')[0];
  const HEAD = ['Block', 'Week', 'Date', 'Exercise', 'Variation', 'Set', 'Weight', 'Reps'];
  const EPOCH = Date.UTC(1899, 11, 30);
  const serialToIso = (n) => new Date(EPOCH + Math.round(n) * 864e5).toISOString().slice(0, 10);
  const isoToSerial = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - EPOCH) / 864e5);
  const cellIso = (v) => {
    if (typeof v === 'number') return serialToIso(v);
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(v).trim());
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(v);
  };
  const numKey = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && String(v).trim() !== '' ? String(n) : String(v).trim(); };
  const rowKey = (r) => [String(r[0] ?? '').trim(), numKey(r[1] ?? ''), cellIso(r[2] ?? ''), String(r[3] ?? '').trim(), String(r[4] ?? '').trim(), numKey(r[5] ?? ''), numKey(r[6] ?? ''), numKey(r[7] ?? '')].join('\u0001');
  const fDate = (d) => d.split('-').reverse().join('.');
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  let plan = null;

  const syncBox = () => $('app-sync');
  const syncShow = (...nodes) => { const b = syncBox(); b.replaceChildren(...nodes); b.hidden = false; };
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (text, cls, fn) => { const b = h('button', 'app-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const setList = (title, rows) => {
    const d = h('details', 'app-sync-list');
    d.append(h('summary', null, title));
    const byDay = new Map();
    rows.forEach((r) => { const k = cellIso(r[2]); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(r); });
    const days = [...byDay].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const ul = h('ul');
    days.slice(0, 40).forEach(([day, rs]) => {
      const li = h('li'); li.append(h('b', null, fDate(day) + ': '));
      li.append(rs.map((r) => `${r[3]}${r[4] ? ' · ' + r[4] : ''} ${numKey(r[6]).replace('.', ',')}×${numKey(r[7])}`).join(', '));
      ul.append(li);
    });
    if (days.length > 40) ul.append(h('li', null, '… und ' + (days.length - 40) + ' weitere Tage'));
    d.append(ul);
    return d;
  };

  const syncPreview = async () => {
    if (!window.Extract || !window.MAPPINGS) throw new Error('Extraktion nicht geladen');
    if ([cfg.plan.id, cfg.sheets.training.id].includes(TARGET.id)) throw new Error('Ziel-Sheet ist eine Quelle; es wird nichts geschrieben.');
    syncShow(h('p', null, 'Lese Trainingsplan …'));
    const res = await withToken(async (t) => {
      const meta = await api(t, `${cfg.plan.id}?fields=sheets.properties.title`);
      const titles = meta.sheets.map((x) => x.properties.title);
      const q = titles.map((x) => 'ranges=' + encodeURIComponent(`'${x.replaceAll("'", "''")}'`)).join('&');
      const vals = await api(t, `${cfg.plan.id}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
      const tmeta = await api(t, `${TARGET.id}?fields=sheets.properties(sheetId,title,gridProperties.rowCount)`);
      const cur = await api(t, `${TARGET.id}/values/${encodeURIComponent(TAB + '!A1:H')}?valueRenderOption=UNFORMATTED_VALUE`);
      return { titles, vals, tmeta, cur };
    });
    const tabs = res.titles.map((title, i) => ({ title, values: res.vals.valueRanges[i].values || [] }));
    const { rows, notes } = Extract.extract(tabs, todayIso());
    const sheet = res.tmeta.sheets.find((x) => x.properties.title === TAB)?.properties;
    if (!sheet) throw new Error(`Tab „${TAB}“ fehlt im Ziel-Sheet.`);
    const [head = [], ...current] = res.cur.values || [];
    if (HEAD.some((x, i) => String(head[i] ?? '').trim() !== x)) throw new Error('Kopfzeile im Ziel-Sheet ist nicht Block, Week, Date, Exercise, Variation, Set, Weight, Reps. Es wird nichts geschrieben.');
    const cur = current.filter((r) => r.some((c) => String(c).trim() !== ''));
    const count = (rs) => rs.reduce((m, r) => { const k = rowKey(r); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
    const A = count(rows), B = count(cur);
    const minus = (rs, X, Y) => { const left = new Map(); for (const [k, v] of X) left.set(k, v - (Y.get(k) || 0)); return rs.filter((r) => { const k = rowKey(r); if (left.get(k) > 0) { left.set(k, left.get(k) - 1); return true; } return false; }); };
    plan = { rows, sheet, oldCount: current.length, added: minus(rows, A, B), removed: minus(cur, B, A), notes };
    renderPlan();
  };

  const renderPlan = () => {
    const { rows, added, removed, notes, oldCount } = plan;
    const nodes = [h('h2', null, 'Plan übernehmen')];
    const recent = notes.filter((n) => n.date >= isoMinusDays(todayIso(), 42));
    if (!added.length && !removed.length) {
      nodes.push(h('p', null, `Dein Sheet ist aktuell: ${rows.length} Sätze bis heute, nichts zu ändern.`));
    } else {
      nodes.push(h('p', null, `Aus dem Trainingsplan gelesen: ${rows.length} Sätze bis heute. Im Sheet würden sich ${added.length} Sätze neu oder geändert eintragen und ${removed.length} entfallen.`));
      if (added.length) nodes.push(setList(`Neu oder geändert (${added.length})`, added));
      if (removed.length) nodes.push(setList(`Entfällt (${removed.length})`, removed));
      const big = removed.length > Math.max(50, oldCount * 0.05);
      if (big) nodes.push(h('p', 'app-warn', `Achtung: ${removed.length} Sätze würden entfallen. Das ist ungewöhnlich viel. Prüfe die Liste, bevor du schreibst.`));
      nodes.push(h('p', 'app-muted', 'Das Sheet wird komplett aus dem Plan neu geschrieben. Änderungen, die du direkt im Sheet gemacht hast, gehen dabei verloren; Korrekturen also im Trainingsplan machen.'));
    }
    if (recent.length) {
      const d = h('details', 'app-sync-list'); d.append(h('summary', null, `Hinweise der letzten 6 Wochen (${recent.length})`));
      const ul = h('ul'); recent.forEach((n) => { const li = h('li'); li.append(h('b', null, fDate(n.date) + ': '), `${n.exercise} (${n.raw.trim() || n.cell}): ${n.why}`); ul.append(li); });
      d.append(ul); nodes.push(d);
    }
    const bar = h('div', 'app-sync-actions');
    if (added.length || removed.length) bar.append(btn('Ins Sheet schreiben', 'primary', () => runSync(syncWrite)));
    bar.append(btn(added.length || removed.length ? 'Abbrechen' : 'Schließen', 'link', () => { plan = null; syncBox().hidden = true; }));
    nodes.push(bar);
    syncShow(...nodes);
  };
  const isoMinusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);

  const syncWrite = async () => {
    const { rows, sheet, oldCount } = plan;
    syncShow(h('p', null, 'Schreibe ' + rows.length + ' Sätze …'));
    const values = rows.map((r) => [r[0], /^\d+$/.test(r[1]) ? Number(r[1]) : r[1], isoToSerial(r[2]), r[3], r[4], r[5], r[6], r[7]]);
    const n = values.length;
    await withToken(async (t) => {
      const reqs = [];
      if (sheet.gridProperties.rowCount < n + 1) reqs.push({ appendDimension: { sheetId: sheet.sheetId, dimension: 'ROWS', length: n + 1 - sheet.gridProperties.rowCount } });
      if (reqs.length) await api(t, `${TARGET.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
      await api(t, `${TARGET.id}/values/${encodeURIComponent(`${TAB}!A2:H${n + 1}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
      if (oldCount > n) await api(t, `${TARGET.id}/values/${encodeURIComponent(`${TAB}!A${n + 2}:H${oldCount + 1}`)}:clear`, { method: 'POST', body: '{}' });
      await api(t, `${TARGET.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ repeatCell: {
        range: { sheetId: sheet.sheetId, startRowIndex: 1, endRowIndex: n + 1, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd.mm.yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } }] }) });
    });
    const done = plan; plan = null;
    syncShow(h('p', null, `Fertig: ${done.added.length} neu oder geändert, ${done.removed.length} entfernt. Das Sheet hat jetzt ${n} Sätze.`), btn('Schließen', 'link', () => { syncBox().hidden = true; }));
    await refresh(true);
  };
  const runSync = async (fn) => {
    if (!navigator.onLine) { syncShow(h('p', 'app-warn', 'Offline: Plan übernehmen geht nur mit Internet.'), btn('Schließen', 'link', () => { syncBox().hidden = true; })); return; }
    $('app-sync-btn').disabled = true;
    try { await fn(); }
    catch (e) { console.error(e); syncShow(h('p', 'app-warn', 'Fehlgeschlagen: ' + e.message + (fn === syncWrite ? ' Das Schreiben wurde evtl. unterbrochen; tippe noch einmal auf „Plan übernehmen“, dann wird der Rest korrigiert.' : ' Im Sheet wurde nichts geändert.')), btn('Schließen', 'link', () => { syncBox().hidden = true; })); }
    finally { $('app-sync-btn').disabled = false; }
  };

  const setButtons = () => {
    $('app-refresh').textContent = token() || store.get('consented') ? 'Aktualisieren' : 'Mit Google anmelden';
    $('app-signout').hidden = !store.get('consented');
  };

  // First start without a client ID: ask for it
  const setup = () => {
    const box = $('app-setup');
    box.hidden = false;
    $('app-setup-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = $('app-client-id').value.trim();
      if (!/\.apps\.googleusercontent\.com$/.test(v)) { $('app-setup-err').textContent = 'Die Client-ID endet auf „.apps.googleusercontent.com“.'; return; }
      store.set('clientId', v); box.hidden = true; initAuth(); refresh(true);
    });
  };

  window.addEventListener('DOMContentLoaded', () => {
    $('app-refresh').addEventListener('click', () => refresh(true));
    $('app-sync-btn').addEventListener('click', () => runSync(syncPreview));
    $('app-signout').addEventListener('click', () => {
      const t = token(); if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
      ['token', 'consented', 'sheetData'].forEach(store.del); raw = null; cache = {}; run(); setButtons(); showStamp();
    });
    window.addEventListener('online', () => refresh(false));
    window.addEventListener('offline', showStamp);
    setButtons(); showStamp();
    if (!clientId()) setup();
    // the sign-in library loads async; refresh on its own if a token from the last hour is still valid
    const wait = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(wait); initAuth(); refresh(false); } }, 200);
    setTimeout(() => clearInterval(wait), 15000);
  });

  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js');
})();
