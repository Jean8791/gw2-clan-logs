"use strict";

// ---------- utilidades ----------
const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("pt-BR");
const num = v => v == null ? "–" : nf.format(Math.round(v));
const dec = (v, d = 1) => v == null ? "–" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const big = v => {
  if (v == null) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return dec(v / 1e6, 2) + " M";
  if (a >= 1e3) return dec(v / 1e3, 1) + " k";
  return num(v);
};
const dur = ms => {
  if (!ms) return "–";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
};
const when = iso => iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "–";
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erro ${r.status}`);
  return r.json();
};
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { } },
};

// Cores por profissão (especializações de elite → profissão base)
const PROF = {
  Guardian: ["#72c1d9", "Dragonhunter Firebrand Willbender Luminary"],
  Revenant: ["#d16e5a", "Herald Renegade Vindicator Conduit"],
  Warrior: ["#ffd166", "Berserker Spellbreaker Bladesworn Paragon"],
  Engineer: ["#d09c59", "Scrapper Holosmith Mechanist Amalgam"],
  Ranger: ["#8cdc82", "Druid Soulbeast Untamed Galeshot"],
  Thief: ["#c08f95", "Daredevil Deadeye Specter Antiquary"],
  Elementalist: ["#f68a87", "Tempest Weaver Catalyst Evoker"],
  Mesmer: ["#b679d5", "Chronomancer Mirage Virtuoso Troubadour"],
  Necromancer: ["#52a76f", "Reaper Scourge Harbinger Ritualist"],
};
const profColor = p => {
  for (const [base, [color, elites]] of Object.entries(PROF))
    if (p === base || elites.split(" ").includes(p)) return color;
  return "#888";
};
const profCell = p => `<span class="prof"><i style="background:${profColor(p)}"></i>${esc(p || "?")}</span>`;
const modeTag = m => m === "wvw" ? `<span class="tag wvw">WvW</span>` : `<span class="tag pve">PvE</span>`;

const charts = [];
const clearCharts = () => { while (charts.length) charts.pop().destroy(); };
const chartColors = () => {
  const cs = getComputedStyle(document.documentElement);
  return { text: cs.getPropertyValue("--muted").trim(), line: cs.getPropertyValue("--line").trim(), gold: cs.getPropertyValue("--gold").trim() };
};
function makeChart(canvas, cfg) {
  if (!window.Chart) return;
  const c = chartColors();
  Chart.defaults.color = c.text;
  Chart.defaults.borderColor = c.line;
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }, cfg.options || {});
  charts.push(new Chart(canvas, cfg));
}

// ---------- tabela ordenável ----------
// cols: [{ key, label, fmt?(value,row), left?:bool, sort?(row) }]
function sortableTable(el, cols, rows, { initial, onRow } = {}) {
  let sortKey = initial || cols[1]?.key, asc = false;
  const render = () => {
    const col = cols.find(c => c.key === sortKey);
    const val = r => col?.sort ? col.sort(r) : r[sortKey];
    const sorted = [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * (asc ? 1 : -1);
    });
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr>${cols.map(c => `<th data-k="${c.key}" class="${c.left ? "l" : ""} ${c.key === sortKey ? "sorted" : ""}" title="${esc(c.title || "")}">${esc(c.label)}${c.key === sortKey ? (asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map((r, i) => `<tr data-i="${rows.indexOf(r)}" class="${onRow ? "click" : ""}">${cols.map(c => `<td class="${c.left ? "l" : ""}">${c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
    el.querySelectorAll("th").forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      if (k === sortKey) asc = !asc; else { sortKey = k; asc = typeof rows[0]?.[k] === "string"; }
      render();
    });
    if (onRow) el.querySelectorAll("tbody tr").forEach(tr => tr.onclick = () => onRow(rows[+tr.dataset.i]));
  };
  render();
}

// ---------- páginas ----------
async function pageFights(params) {
  const mode = params.get("mode") || "all";
  $app.innerHTML = `
    <div class="page-head">
      <div><h1>Lutas</h1><div class="muted" id="summary">Carregando…</div></div>
      <div class="controls">
        <div class="seg" id="mode">
          ${[["all", "Todas"], ["wvw", "WvW"], ["pve", "PvE"]].map(([k, l]) => `<button data-m="${k}" class="${k === mode ? "on" : ""}">${l}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="fight-list" id="list"></div>`;
  document.querySelectorAll("#mode button").forEach(b => b.onclick = () => location.hash = b.dataset.m === "all" ? "#/" : `#/?mode=${b.dataset.m}`);

  const [fights, stats] = await Promise.all([api(`/api/fights?limit=200${mode !== "all" ? "&mode=" + mode : ""}`), api("/api/stats")]);
  const s = Object.fromEntries(stats.map(x => [x.mode, x]));
  document.getElementById("summary").textContent = stats.length
    ? `${num(s.wvw?.fights || 0)} lutas de WvW · ${num(s.pve?.fights || 0)} de PvE · ${num(Math.max(s.wvw?.players || 0, s.pve?.players || 0))} jogadores`
    : "Nenhum log ainda.";

  const list = document.getElementById("list");
  if (!fights.length) {
    list.innerHTML = `<div class="empty panel">Nenhuma luta por aqui ainda.<br><br><a class="btn btn-primary" href="#/upload">Enviar o primeiro log</a></div>`;
    return;
  }
  list.innerHTML = fights.map(f => {
    if (f.status !== "done") {
      const st = f.status === "error" ? `<span class="err">Erro: ${esc(f.error)}</span>` : `<span class="muted">${f.status === "parsing" ? "Processando…" : "Na fila…"}</span>`;
      return `<div class="fight"><div><div class="title">${esc(f.file_name)}</div><div class="meta">${st}</div></div></div>`;
    }
    const nums = f.mode === "wvw"
      ? [["Squad", f.squad_count], ["Inimigos", f.enemy_count], ["Kills", f.squad_kills], ["Mortes", f.squad_deaths], ["DPS squad", big(f.squad_dps)]]
      : [["Jogadores", f.squad_count], ["DPS grupo", big(f.squad_dps)], ["Mortes", f.squad_deaths]];
    return `<a class="fight" href="#/fight/${encodeURIComponent(f.id)}">
      <div>
        <div class="title">${modeTag(f.mode)} ${esc(f.fight_name)}
          ${f.mode === "pve" ? (f.success ? `<span class="tag ok">Sucesso</span>` : `<span class="tag fail">Falhou</span>`) : ""}
          ${f.is_cm ? `<span class="tag">CM</span>` : ""}</div>
        <div class="meta">${when(f.time_start)} · ${dur(f.duration_ms)} · gravado por ${esc(f.recorded_by || "?")}${f.uploader ? " · enviado por " + esc(f.uploader) : ""}</div>
      </div>
      <div class="nums">${nums.map(([k, v]) => `<div><b>${typeof v === "string" ? v : num(v)}</b><span>${k}</span></div>`).join("")}</div>
    </a>`;
  }).join("");

  // Atualiza sozinho enquanto houver logs sendo processados
  if (fights.some(f => f.status === "queued" || f.status === "parsing"))
    pending = setTimeout(() => route(), 4000);
}

const FIGHT_TABS = {
  dano: {
    label: "Dano", initial: "damage", cols: [
      { key: "damage", label: "Dano", fmt: big }, { key: "dps", label: "DPS", fmt: num },
      { key: "power_dps", label: "DPS físico", fmt: num }, { key: "condi_dps", label: "DPS condição", fmt: num },
      { key: "down_contrib", label: "Contrib. down", fmt: big, title: "Dano causado em inimigos que depois foram derrubados" },
      { key: "downs", label: "Downs", fmt: num }, { key: "kills", label: "Kills", fmt: num },
    ]
  },
  suporte: {
    label: "Suporte", initial: "strips", cols: [
      { key: "strips", label: "Strips", fmt: num, title: "Boons removidos de inimigos" },
      { key: "cleanses", label: "Cleanses", fmt: num, title: "Condições removidas (aliados + próprias)" },
      { key: "healing", label: "Cura", fmt: big }, { key: "barrier", label: "Barreira", fmt: big },
      { key: "resurrects", label: "Revives", fmt: num }, { key: "stun_breaks", label: "Stun breaks", fmt: num },
    ]
  },
  boons: {
    label: "Boons (geração p/ squad)", initial: "stab_gen", cols: [
      { key: "stab_gen", label: "Estabilidade", fmt: v => dec(v, 2) }, { key: "quick_gen", label: "Rapidez %", fmt: v => dec(v) },
      { key: "alac_gen", label: "Alacridade %", fmt: v => dec(v) }, { key: "prot_gen", label: "Proteção %", fmt: v => dec(v) },
      { key: "might_gen", label: "Poder", fmt: v => dec(v, 2) }, { key: "aegis_gen", label: "Égide %", fmt: v => dec(v) },
      { key: "resist_gen", label: "Resistência %", fmt: v => dec(v) }, { key: "superspeed_gen", label: "Superveloc. %", fmt: v => dec(v) },
    ]
  },
  defesa: {
    label: "Defesa", initial: "damage_taken", cols: [
      { key: "damage_taken", label: "Dano recebido", fmt: big }, { key: "times_downed", label: "Caiu", fmt: num },
      { key: "deaths", label: "Morreu", fmt: num }, { key: "dodges", label: "Esquivas", fmt: num },
      { key: "blocked", label: "Bloqueios", fmt: num }, { key: "dist_to_com", label: "Dist. comandante", fmt: v => num(v), title: "Distância média até a tag do comandante" },
    ]
  },
};

async function pageFight(id, params) {
  const tab = params.get("tab") || "dano";
  const { fight: f, players } = await api(`/api/fights/${encodeURIComponent(id)}`);
  if (f.status !== "done") {
    $app.innerHTML = `<div class="panel">${f.status === "error" ? `<span class="err">Erro ao processar: ${esc(f.error)}</span>` : "Este log ainda está sendo processado…"}</div>`;
    if (f.status !== "error") pending = setTimeout(() => route(), 4000);
    return;
  }
  const wvw = f.mode === "wvw";
  const cards = wvw
    ? [["Duração", dur(f.duration_ms)], ["Squad", num(f.squad_count)], ["Inimigos", num(f.enemy_count)], ["Kills", num(f.squad_kills)],
       ["Downs", num(f.squad_downs)], ["Mortes do squad", num(f.squad_deaths)], ["Dano total", big(f.squad_damage)], ["DPS do squad", big(f.squad_dps)]]
    : [["Duração", dur(f.duration_ms)], ["Resultado", f.success ? "Sucesso" : "Falhou"], ["Jogadores", num(f.squad_count)],
       ["DPS do grupo", big(f.squad_dps)], ["Mortes", num(f.squad_deaths)]];

  $app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="muted small"><a href="#/">← Lutas</a></div>
        <h1>${modeTag(f.mode)} ${esc(f.fight_name)}</h1>
        <div class="muted">${when(f.time_start)} · gravado por ${esc(f.recorded_by || "?")}${f.uploader ? " · enviado por " + esc(f.uploader) : ""}</div>
      </div>
      <a class="btn" href="/api/fights/${encodeURIComponent(f.id)}/report" target="_blank" rel="noopener">Relatório completo do Elite Insights ↗</a>
    </div>
    <div class="cards">${cards.map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
    <div class="panel"><h2>Dano por jogador</h2><div class="chart-box" style="height:${Math.max(220, players.length * 22)}px"><canvas id="c-dmg"></canvas></div></div>
    <div class="controls" style="margin-bottom:10px">
      <div class="seg" id="tabs">${Object.entries(FIGHT_TABS).map(([k, t]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${t.label}</button>`).join("")}</div>
    </div>
    <div id="tbl"></div>`;

  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => location.hash = `#/fight/${encodeURIComponent(id)}?tab=${b.dataset.t}`);

  const base = [
    { key: "name", label: "Jogador", left: true, fmt: (v, r) => `<a href="#/player/${encodeURIComponent(r.account)}">${esc(v)}</a> ${r.commander ? `<span class="tag cmd">Tag</span>` : ""}<div class="muted small">${esc(r.account)}</div>` },
    { key: "profession", label: "Classe", left: true, fmt: profCell },
    { key: "grp", label: "Grupo", fmt: num },
  ];
  const t = FIGHT_TABS[tab] || FIGHT_TABS.dano;
  sortableTable(document.getElementById("tbl"), [...base, ...t.cols], players, { initial: t.initial });

  const top = [...players].sort((a, b) => b.damage - a.damage);
  makeChart(document.getElementById("c-dmg"), {
    type: "bar",
    data: { labels: top.map(p => p.name), datasets: [{ data: top.map(p => p.damage), backgroundColor: top.map(p => profColor(p.profession)), borderRadius: 3 }] },
    options: { indexAxis: "y", scales: { x: { ticks: { callback: v => big(v) } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${big(c.raw)} · ${top[c.dataIndex].profession}` } } } },
  });
}

const RANK_COLS = [
  { key: "fights", label: "Lutas", fmt: num },
  { key: "damage", label: "Dano", fmt: big, per: true }, { key: "dps", label: "DPS médio", fmt: num },
  { key: "down_contrib", label: "Contrib. down", fmt: big, per: true }, { key: "downs", label: "Downs", fmt: num, per: true },
  { key: "kills", label: "Kills", fmt: num, per: true }, { key: "strips", label: "Strips", fmt: num, per: true },
  { key: "cleanses", label: "Cleanses", fmt: num, per: true }, { key: "healing", label: "Cura", fmt: big, per: true },
  { key: "barrier", label: "Barreira", fmt: big, per: true }, { key: "resurrects", label: "Revives", fmt: num, per: true },
  { key: "stab_gen", label: "Estab. (média)", fmt: v => dec(v, 2) }, { key: "quick_gen", label: "Rapidez %", fmt: v => dec(v) },
  { key: "alac_gen", label: "Alac. %", fmt: v => dec(v) },
  { key: "deaths", label: "Mortes", fmt: num, per: true }, { key: "times_downed", label: "Caiu", fmt: num, per: true },
  { key: "dist_to_com", label: "Dist. com.", fmt: num },
];

async function pageRanking(params) {
  const mode = params.get("mode") || "wvw";
  const days = params.get("days") || "30";
  const view = params.get("view") || "total";
  const set = (k, v) => { const p = new URLSearchParams({ mode, days, view }); p.set(k, v); location.hash = "#/ranking?" + p; };

  $app.innerHTML = `
    <div class="page-head">
      <div><h1>Ranking do clã</h1><div class="muted">Clique num jogador para ver o histórico dele. Clique no título de uma coluna para ordenar.</div></div>
      <div class="controls">
        <div class="seg" id="r-mode">${[["wvw", "WvW"], ["pve", "PvE"]].map(([k, l]) => `<button data-v="${k}" class="${k === mode ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="seg" id="r-days">${[["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["0", "Tudo"]].map(([k, l]) => `<button data-v="${k}" class="${k === days ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="seg" id="r-view">${[["total", "Total"], ["min", "Por minuto"]].map(([k, l]) => `<button data-v="${k}" class="${k === view ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
    </div>
    <div id="tbl"><div class="muted">Carregando…</div></div>`;
  for (const [id, k] of [["r-mode", "mode"], ["r-days", "days"], ["r-view", "view"]])
    document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => set(k, b.dataset.v));

  let rows = await api(`/api/ranking?mode=${mode}&days=${days}`);
  if (!rows.length) { document.getElementById("tbl").innerHTML = `<div class="empty panel">Sem lutas de ${mode === "wvw" ? "WvW" : "PvE"} nesse período.</div>`; return; }

  if (view === "min") rows = rows.map(r => {
    const min = (r.active_ms || 0) / 60000;
    const o = { ...r };
    for (const c of RANK_COLS) if (c.per) o[c.key] = min > 0 ? r[c.key] / min : null;
    return o;
  });
  const cols = [
    { key: "name", label: "Jogador", left: true, fmt: (v, r) => `${esc(v || r.account)}<div class="muted small">${esc(r.account)}</div>` },
    { key: "profession", label: "Última classe", left: true, fmt: profCell },
    ...RANK_COLS.map(c => view === "min" && c.per ? { ...c, fmt: v => dec(v, v != null && Math.abs(v) >= 100 ? 0 : 2) } : c),
  ];
  sortableTable(document.getElementById("tbl"), cols, rows, { initial: "damage", onRow: r => location.hash = `#/player/${encodeURIComponent(r.account)}` });
}

async function pagePlayer(account) {
  const d = await api(`/api/players/${encodeURIComponent(account)}`);
  const h = d.history;
  const last = h[h.length - 1];
  const tot = Object.fromEntries(d.totals.map(t => [t.mode, t]));
  const card = (k, v) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const w = tot.wvw, p = tot.pve;

  $app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="muted small"><a href="#/ranking">← Ranking</a></div>
        <h1>${esc(last.name)}</h1>
        <div class="muted">${esc(d.account)} · ${d.professions.map(x => `${profCell(x.profession)} <span class="muted">(${x.fights})</span>`).join(" &nbsp; ")}</div>
      </div>
    </div>
    ${w ? `<h2>WvW</h2><div class="cards">${card("Lutas", num(w.fights))}${card("Tempo em luta", dur(w.active_ms))}${card("Dano total", big(w.damage))}${card("DPS médio", num(w.dps))}${card("Kills", num(w.kills))}${card("Downs", num(w.downs))}${card("Strips", num(w.strips))}${card("Cleanses", num(w.cleanses))}${card("Mortes", num(w.deaths))}</div>` : ""}
    ${p ? `<h2>PvE</h2><div class="cards">${card("Lutas", num(p.fights))}${card("DPS médio", num(p.dps))}${card("Dano total", big(p.damage))}${card("Mortes", num(p.deaths))}</div>` : ""}
    <div class="grid-2">
      <div class="panel"><h2>DPS por luta</h2><div class="chart-box"><canvas id="c-dps"></canvas></div></div>
      <div class="panel"><h2>Strips e cleanses por luta (WvW)</h2><div class="chart-box"><canvas id="c-sup"></canvas></div></div>
    </div>
    <h2>Histórico de lutas</h2>
    <div id="tbl"></div>`;

  const labels = h.map(x => new Date(x.time_start).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
  const c = chartColors();
  makeChart(document.getElementById("c-dps"), {
    type: "line",
    data: { labels, datasets: [{ data: h.map(x => x.dps), borderColor: c.gold, backgroundColor: c.gold, cubicInterpolationMode: "monotone", pointRadius: 3 }] },
    options: { scales: { y: { beginAtZero: true, ticks: { callback: v => big(v) } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `${h[i[0].dataIndex].fight_name} · ${when(h[i[0].dataIndex].time_start)}` } } } },
  });
  const hw = h.filter(x => x.mode === "wvw");
  makeChart(document.getElementById("c-sup"), {
    type: "bar",
    data: {
      labels: hw.map(x => new Date(x.time_start).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })),
      datasets: [
        { label: "Strips", data: hw.map(x => x.strips), backgroundColor: "#d16e5a", borderRadius: 3 },
        { label: "Cleanses", data: hw.map(x => x.cleanses), backgroundColor: "#4c9aff", borderRadius: 3 },
      ]
    },
    options: { plugins: { legend: { display: true, position: "bottom" } }, scales: { y: { beginAtZero: true } } },
  });

  sortableTable(document.getElementById("tbl"), [
    { key: "time_start", label: "Data", left: true, fmt: v => when(v) },
    { key: "fight_name", label: "Luta", left: true, fmt: (v, r) => `${modeTag(r.mode)} ${esc(v)}` },
    { key: "profession", label: "Classe", left: true, fmt: profCell },
    { key: "dps", label: "DPS", fmt: num }, { key: "damage", label: "Dano", fmt: big },
    { key: "kills", label: "Kills", fmt: num }, { key: "downs", label: "Downs", fmt: num },
    { key: "strips", label: "Strips", fmt: num }, { key: "cleanses", label: "Cleanses", fmt: num },
    { key: "healing", label: "Cura", fmt: big }, { key: "deaths", label: "Mortes", fmt: num },
  ], [...h].reverse(), { initial: "time_start", onRow: r => location.hash = `#/fight/${encodeURIComponent(r.fight_id)}` });
}

async function pageUpload() {
  const cfg = await api("/api/config");
  $app.innerHTML = `
    <div class="page-head"><div>
      <h1>Enviar logs</h1>
      <div class="muted">Os logs do ArcDPS ficam em <code>Documentos\\Guild Wars 2\\addons\\arcdps\\arcdps.cbtlogs</code>. Pode arrastar vários de uma vez.</div>
    </div></div>
    <div class="panel controls">
      <label class="field">Seu nome (opcional)<input type="text" id="uploader" maxlength="60" placeholder="ex.: Jean.1234"></label>
      ${cfg.uploadKeyRequired ? `<label class="field">Senha do clã<input type="password" id="key" placeholder="pergunte no Discord"></label>` : ""}
    </div>
    <label class="drop" id="drop">
      <strong>Arraste os arquivos .zevtc aqui</strong>
      <span class="muted">ou clique para escolher</span>
      <input type="file" id="file" accept=".zevtc,.evtc,.zip,.json" multiple hidden>
    </label>
    <div class="upload-list" id="ul"></div>`;

  const up = document.getElementById("uploader"), key = document.getElementById("key");
  up.value = store.get("uploader") || "";
  if (key) key.value = store.get("uploadKey") || "";
  const drop = document.getElementById("drop"), input = document.getElementById("file"), ul = document.getElementById("ul");

  const send = async files => {
    store.set("uploader", up.value.trim());
    if (key) store.set("uploadKey", key.value);
    for (const file of files) {
      const item = document.createElement("div");
      item.className = "upload-item";
      item.innerHTML = `<span>${esc(file.name)} <span class="muted small">(${dec(file.size / 1048576)} MB)</span></span><span class="muted">Enviando…</span>`;
      ul.prepend(item);
      const status = item.lastElementChild;
      try {
        const fd = new FormData();
        fd.append("uploader", up.value.trim());
        fd.append("file", file);
        const [r] = await api("/api/upload", { method: "POST", body: fd, headers: key ? { "X-Upload-Key": key.value } : {} });
        if (r.error) { status.innerHTML = `<span class="err">${esc(r.error)}</span>`; continue; }
        status.innerHTML = r.duplicate
          ? `<a href="#/fight/${encodeURIComponent(r.id)}">Já enviado antes →</a>`
          : `<a href="#/fight/${encodeURIComponent(r.id)}">Recebido, processando… →</a>`;
      } catch (e) {
        status.innerHTML = `<span class="err">${esc(e.message)}</span>`;
      }
    }
  };
  input.onchange = () => send([...input.files]);
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => send([...e.dataTransfer.files]));
}

// ---------- roteador ----------
let pending = null;
async function route() {
  clearTimeout(pending);
  clearCharts();
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(qs || "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const navKey = { ranking: "ranking", player: "ranking", upload: "upload" }[parts[0]] || "fights";
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === navKey && navKey !== "upload"));
  try {
    if (parts[0] === "fight" && parts[1]) await pageFight(parts[1], params);
    else if (parts[0] === "ranking") await pageRanking(params);
    else if (parts[0] === "player" && parts[1]) await pagePlayer(parts[1]);
    else if (parts[0] === "upload") await pageUpload();
    else await pageFights(params);
  } catch (e) {
    $app.innerHTML = `<div class="panel err">Não foi possível carregar: ${esc(e.message)}</div>`;
  }
}
window.addEventListener("hashchange", route);
route();
