/* Viral Content Machine — tableau de bord (sans dépendance). En mode instantané (window.__SNAPSHOT__), lecture seule. */
(() => {
  const SNAP = window.__SNAPSHOT__ || null;
  const RO = !!SNAP;
  if (RO) document.documentElement.classList.add('ro');

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
    comptes: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z"/>',
    concurrence: '<path d="M3 17l6-6 4 4 8-8v4h2V3h-8v2h4l-6 6-4-4-8 8z"/>',
    base: '<path d="M12 3C7 3 4 4.6 4 6.5v11C4 19.4 7 21 12 21s8-1.6 8-3.5v-11C20 4.6 17 3 12 3zm0 2c3.9 0 6 1.1 6 1.5S15.9 8 12 8 6 6.9 6 6.5 8.1 5 12 5z"/>',
    generateur: '<path d="M11 2l2.4 6.6L20 11l-6.6 2.4L11 20l-2.4-6.6L2 11l6.6-2.4z"/>',
    templates: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    calendrier: '<path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm-2 8h14v9H5v-9z"/>',
    publications: '<path d="M2 21l21-9L2 3v7l15 2-15 2z"/>',
    analytics: '<path d="M4 19h16v2H2V3h2v16zm3-2V9h3v8H7zm5 0V5h3v12h-3zm5 0v-6h3v6h-3z"/>',
    parametres: '<path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
    integrations: '<path d="M7 7h4v2H7a3 3 0 0 0 0 6h4v2H7A5 5 0 0 1 7 7zm6 0h4a5 5 0 0 1 0 10h-4v-2h4a3 3 0 0 0 0-6h-4V7zm-4 4h6v2H9z"/>',
    videos: '<path d="M4 5h11a2 2 0 0 1 2 2v2.5l4-2.5v10l-4-2.5V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
    audio: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm7 9a7 7 0 0 1-6 6.9V21h-2v-2.1A7 7 0 0 1 5 12h2a5 5 0 0 0 10 0h2z"/>',
  };
  const PAGES = [
    ['dashboard', 'Dashboard', 'Vue d’ensemble'],
    ['comptes', 'Comptes', 'Un tableau de bord par compte'],
    ['concurrence', 'Analyse concurrentielle', 'Ce qui marche dans la niche'],
    ['base', 'Base de publications', 'Publications analysées et notées sur 100'],
    ['videos', 'Vidéos', 'Production par lots, contrôle qualité et lecteur'],
    ['audio', 'Audio Studio', 'Voix, musique, effets sonores et sous-titres, par compte'],
    ['generateur', 'Générateur de slideshows', 'Idées et carrousels, par compte'],
    ['templates', 'Bibliothèque de templates', '10 styles visuels'],
    ['calendrier', 'Calendrier', 'Programmation par compte'],
    ['publications', 'Publications', 'File d’attente, validations et historique'],
    ['analytics', 'Analytics', 'Nos résultats et ce que la machine apprend'],
    ['parametres', 'Paramètres', 'Comptes, IA, règles'],
    ['integrations', 'Intégrations MCP', 'Connexions et API'],
  ];

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR'));
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris'}) : '—');
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris'}) : '—');

  const STATUS = {
    draft: ['Brouillon', ''], rendered: ['Rendu', 'b-info'], qc_failed: ['Contrôle échoué', 'b-bad'], awaiting_approval: ['À valider', 'b-warn'],
    approved: ['Validé', 'b-good'], rejected: ['Refusé', ''], scheduled: ['Programmé', 'b-accent'], publishing: ['En cours', 'b-info'],
    published: ['Publié', 'b-good'], failed: ['Échec', 'b-bad'], planned: ['Planifié', 'b-accent'], queued_remote: ['Confié à la plateforme', 'b-info'],
    deferred: ['Reporté (limite)', 'b-warn'], manual_required: ['À publier à la main', 'b-warn'], cancelled: ['Annulé', ''],
  };
  const badge = (s) => {
    const [l, c] = STATUS[s] || [s, ''];
    return `<span class="badge ${c}">${esc(l)}</span>`;
  };
  const scoreBadge = (s) => (s === null || s === undefined ? '<span class="badge">—</span>' : `<span class="badge ${s >= 65 ? 'b-good' : s >= 50 ? 'b-info' : s >= 35 ? 'b-warn' : 'b-bad'}">${Number(s).toFixed(0)}</span>`);

  async function api(path, opts) {
    if (RO) {
      if (opts && opts.method && opts.method !== 'GET') throw new Error('Instantané en lecture seule : lance le tableau de bord local pour agir.');
      const key = path.replace(/^\/api\//, '').split('?')[0];
      if (key.startsWith('slideshows/')) return (SNAP.slideshows || {})[key.split('/')[1]] || null;
      return SNAP[key] ?? null;
    }
    const res = await fetch(path, opts ? {...opts, headers: {'Content-Type': 'application/json', ...(opts.headers || {})}} : undefined);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }
  const post = (path, data) => api(path, {method: 'POST', body: JSON.stringify(data || {})});

  function toast(msg, ms = 3800) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function barChart(rows, key, label) {
    if (!rows || !rows.length) return '<div class="empty">Pas encore de données</div>';
    const max = Math.max(...rows.map((r) => r[key] || 0), 1);
    const w = 100 / rows.length;
    const bars = rows.map((r, i) => {
      const h = ((r[key] || 0) / max) * 150;
      return `<g><rect x="${i * w + w * 0.15}%" y="${165 - h}" width="${w * 0.7}%" height="${h}" rx="3" fill="var(--accent)"><title>${esc(r[label])} : ${fmt(r[key])}</title></rect></g>`;
    });
    return `<div class="chart"><svg viewBox="0 0 100 180" preserveAspectRatio="none" role="img">${bars.join('')}</svg><div class="row small muted" style="justify-content:space-between"><span>${esc(rows[0][label])}</span><span>${esc(rows[rows.length - 1][label])}</span></div></div>`;
  }

  function hbars(items, valueKey, labelFn, max) {
    if (!items.length) return '<div class="empty">Pas encore assez de données</div>';
    const m = max || Math.max(...items.map((i) => i[valueKey] || 0), 1);
    return `<div class="bars">${items.map((i) => `<div class="bar"><span title="${esc(labelFn(i))}">${esc(labelFn(i))}</span><div class="track"><div class="fill" style="width:${Math.max(2, ((i[valueKey] || 0) / m) * 100)}%"></div></div><span class="num">${Number(i[valueKey] || 0).toFixed(valueKey === 'lift' ? 2 : 0)}</span></div>`).join('')}</div>`;
  }

  function thumbs(list) {
    if (!list || !list.length) return '<div class="empty">Aucun carrousel pour l’instant</div>';
    return `<div class="thumbs">${list.map((s) => `<div class="thumb" data-ss="${esc(s.id)}"><div class="img" style="${s.cover ? `background-image:url('${esc(s.cover)}')` : ''}">${s.cover ? '' : 'pas encore rendu'}</div><div class="meta"><div class="t">${esc(s.hook)}</div><div class="row">${badge(s.status)}<span class="badge">${esc(s.template)}</span>${s.predicted ? `<span class="badge b-accent" title="score prévu">≈${Math.round(s.predicted)}</span>` : ''}</div><div class="small muted">${esc(s.account)} · ${s.slides} slides</div></div></div>`).join('')}</div>`;
  }

  async function openSlideshow(id) {
    const s = await api(`/api/slideshows/${id}`);
    if (!s) return toast('Carrousel indisponible dans cet instantané');
    const m = document.createElement('div');
    m.className = 'modal';
    const qc = s.qc;
    m.innerHTML = `<div class="box"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(s.hook)}</h2><div class="small muted">${esc(s.account)} · ${esc(s.template)} · ${esc(s.format)} · ${s.slides} slides · moteur ${esc(s.engine)}</div></div><button class="btn" data-close>Fermer</button></div>
      <div class="row" style="margin:14px 0">${badge(s.status)} ${qc ? `<span class="badge ${qc.ok ? 'b-good' : 'b-bad'}">Contrôle qualité ${qc.score}/100</span>` : '<span class="badge">Contrôle non fait</span>'} ${s.approvedBy ? `<span class="badge b-good">Validé par ${esc(s.approvedBy)}</span>` : ''}</div>
      <div class="slides">${(s.images || []).map((i) => `<img src="${esc(i.url)}" alt="slide ${i.slide_index + 1}">`).join('') || '<div class="empty">Pas encore rendu</div>'}</div>
      <div class="grid g2" style="margin-top:14px"><div><h3>Légende</h3><pre class="caption">${esc(s.caption)}</pre></div><div><h3>Contrôle qualité</h3>${qc ? `<ul class="list">${qc.errors.map((e) => `<li><span class="badge b-bad">Bloquant</span> ${esc(e.where)} : ${esc(e.message)}</li>`).join('')}${qc.warnings.map((e) => `<li><span class="badge b-warn">À voir</span> ${esc(e.where)} : ${esc(e.message)}</li>`).join('')}${!qc.errors.length && !qc.warnings.length ? '<li><span class="badge b-good">OK</span> Aucun problème détecté</li>' : ''}</ul><div class="small muted" style="margin-top:8px">${Object.entries(qc.checks).map(([k, v]) => `${esc(k)} : ${esc(v)}`).join(' · ')}</div>` : ''}
      <h3>Faits utilisés</h3><div class="small">${(s.facts || []).map((f) => `<span class="badge">${esc(f)}</span>`).join(' ') || '—'}</div></div></div>
      <div class="row act" style="margin-top:16px"><button class="btn primary" data-a="approve">Valider</button><button class="btn" data-a="schedule">Programmer au prochain créneau</button><button class="btn" data-a="render">Refaire le rendu + contrôle</button><button class="btn" data-a="export">Exporter (ZIP)</button><button class="btn danger" data-a="reject">Refuser</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', async (e) => {
      if (e.target === m || e.target.dataset.close !== undefined) return m.remove();
      const a = e.target.dataset.a;
      if (!a) return;
      try {
        if (a === 'approve') await post(`/api/slideshows/${id}/approve`, {by: 'tableau de bord'});
        if (a === 'schedule') {
          const r = await post(`/api/slideshows/${id}/schedule`, {});
          toast(`Programmé pour ${r.at}`);
        }
        if (a === 'render') await post(`/api/slideshows/${id}/render`, {});
        if (a === 'export') {
          const r = await post(`/api/slideshows/${id}/export`, {});
          toast(`Export prêt : ${r.zip}`);
        }
        if (a === 'reject') {
          const reason = prompt('Raison du refus ?');
          if (!reason) return;
          await post(`/api/slideshows/${id}/reject`, {reason});
        }
        m.remove();
        route();
      } catch (err) {
        toast(err.message, 6000);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ss]');
    if (t) openSlideshow(t.dataset.ss);
  });

  /* ---------------- pages ---------------- */

  const views = {};
  let baseParams = new URLSearchParams('limit=100');

  views.dashboard = async () => {
    const d = await api('/api/overview');
    const k = d.kpis;
    return `<div class="grid g4">
      ${[['Comptes connectés', k.accounts, `${k.accountsCarousel} publient des carrousels`], ['Contenus générés', k.generated, `${k.qcFailed} bloqués par le contrôle`], ['Publications', k.published, `${fmt(k.ownPosts)} posts suivis au total`], ['Programmées', k.scheduled, `${k.failed} en échec`]]
        .map(([l, v, s]) => `<div class="card kpi"><span class="l">${l}</span><span class="v">${fmt(v)}</span><span class="s">${esc(s)}</span></div>`).join('')}
      ${[['En attente', k.pending, 'validations + publications manuelles'], ['Performance moyenne', k.ownAvgScore === null ? '—' : `${k.ownAvgScore}/100`, `${fmt(k.ownViews)} vues · ${fmt(k.ownInteractions)} interactions`], ['Veille', k.marketPosts, `${k.competitors} comptes concurrents`], ['Coûts IA (30 j)', `${(k.aiCost30d || 0).toFixed(2)} $`, `${fmt(k.aiCalls30d)} appels`]]
        .map(([l, v, s]) => `<div class="card kpi"><span class="l">${l}</span><span class="v">${typeof v === 'number' ? fmt(v) : esc(v)}</span><span class="s">${esc(s)}</span></div>`).join('')}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Vues de nos publications (45 jours)</h2>${barChart(d.viewsByDay, 'views', 'day')}</div>
      <div class="card"><h2>Ce qui marche dans la niche</h2>${d.insights.length ? `<ul class="list">${d.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<div class="empty">Importe des publications concurrentes (Analyse concurrentielle)</div>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Meilleurs contenus prêts <a href="#generateur" class="small">tout voir</a></h2>${thumbs(d.best)}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Tendances détectées</h2>${d.trends.length ? `<table><tr><th>Tendance</th><th>Statut</th><th class="num">Récents</th><th class="num">Évolution</th></tr>${d.trends.map((t) => `<tr><td>${esc(t.kind === 'hook_type' ? 'Accroche' : t.kind === 'topic' ? 'Sujet' : 'Hashtag')} : <b>${esc(t.label)}</b></td><td><span class="badge ${t.status === 'emergente' || t.status === 'nouvelle' ? 'b-good' : t.status === 'en baisse' ? 'b-bad' : 'b-info'}">${esc(t.status)}</span></td><td class="num">${t.recent_n}</td><td class="num">${t.growth > 0 ? '+' : ''}${Math.round(t.growth * 100)} %</td></tr>`).join('')}</table>` : '<div class="empty">Pas assez de publications datées</div>'}</div>
      <div class="card"><h2>Nos meilleures publications</h2>${d.bestOwn.length ? `<table><tr><th>Publication</th><th class="num">Vues</th><th class="num">Score</th></tr>${d.bestOwn.map((p) => `<tr><td>${esc(p.platform)} · ${esc((p.hook || '').slice(0, 70))}</td><td class="num">${fmt(p.views)}</td><td class="num">${scoreBadge(p.score)}</td></tr>`).join('')}</table>` : '<div class="empty">Importe les statistiques (Analytics)</div>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Historique</h2><div class="scroll"><table><tr><th>Quand</th><th>Type</th><th>Événement</th></tr>${d.history.map((h) => `<tr><td class="small">${dt(h.at)}</td><td><span class="badge ${h.level === 'error' ? 'b-bad' : h.level === 'warn' ? 'b-warn' : ''}">${esc(h.kind)}</span></td><td>${esc(h.message)}</td></tr>`).join('')}</table></div></div>`;
  };

  views.comptes = async () => {
    const list = await api('/api/accounts');
    return `<div class="grid g2">${list.map((a) => `<div class="card">
      <h2><span>${esc(a.platform.toUpperCase())} · @${esc(a.handle)}</span>${a.slideshows ? '<span class="badge b-good">Carrousels</span>' : '<span class="badge">Pas de carrousel</span>'}</h2>
      <div class="small muted">Niche : ${esc(a.niche)} · publication par ${esc(a.provider)}${a.fallbackProvider ? ` (secours : ${esc(a.fallbackProvider)})` : ''} · santé : ${esc(a.health?.status ?? 'non vérifiée')}</div>
      ${a.notes ? `<div class="notice warn" style="margin-top:10px">${esc(a.notes)}</div>` : ''}
      <h3>Identité visuelle</h3><div class="row"><div class="swatches">${Object.values(a.brand.palette).map((c) => `<span class="sw" style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}</div><span class="small">${esc(a.brand.fonts.heading)} / ${esc(a.brand.fonts.body)} · ${esc(a.brand.defaultFormat)}</span></div>
      <div class="small muted" style="margin-top:6px">Modèles : ${a.brand.templates.map(esc).join(', ')}</div>
      <div class="grid g4" style="margin-top:12px">${[['Générés', a.counts.generated], ['Programmés', a.counts.scheduled], ['Publiés', a.counts.published], ['À la main', a.counts.manual]].map(([l, v]) => `<div class="kpi"><span class="l">${l}</span><span class="v" style="font-size:22px">${fmt(v)}</span></div>`).join('')}</div>
      <h3>Statistiques</h3><div class="small">${fmt(a.stats?.posts)} publications suivies · ${fmt(a.stats?.avgViews)} vues en moyenne · score moyen ${a.stats?.avgScore ?? '—'}</div>
      <h3>Meilleurs contenus</h3>${a.best.length ? `<ul class="list">${a.best.map((p) => `<li>${scoreBadge(p.score)} ${esc((p.hook || '').slice(0, 80))} <span class="muted small">· ${fmt(p.views)} vues</span></li>`).join('')}</ul>` : '<div class="small muted">—</div>'}
      <h3>Prochaines publications</h3>${a.next.length ? `<ul class="list">${a.next.map((n) => `<li>${esc(n.local)} · ${esc(n.hook)}</li>`).join('')}</ul>` : '<div class="small muted">Rien de programmé</div>'}
      <h3>Réglages</h3><div class="row small"><span class="badge ${a.settings.requireApproval ? 'b-warn' : 'b-good'}">Validation humaine : ${a.settings.requireApproval ? 'oui' : 'non'}</span><span class="badge ${a.settings.autoPublish ? 'b-good' : ''}">Publication auto : ${a.settings.autoPublish ? 'oui' : 'non'}</span><span class="badge">${a.limits.maxPerDay}/jour · ${a.limits.maxPerWeek}/semaine · écart ${a.limits.minGapMinutes} min</span></div>
      <div class="row act" style="margin-top:10px"><button class="btn" data-toggle="requireApproval" data-acc="${esc(a.id)}" data-val="${!a.settings.requireApproval}">${a.settings.requireApproval ? 'Désactiver' : 'Activer'} la validation humaine</button><button class="btn" data-toggle="autoPublish" data-acc="${esc(a.id)}" data-val="${!a.settings.autoPublish}">${a.settings.autoPublish ? 'Couper' : 'Autoriser'} la publication auto</button></div>
    </div>`).join('')}</div>`;
  };

  views.concurrence = async () => {
    const d = await api('/api/competitors');
    const dims = {hook_type: 'Types d’accroche', structure: 'Structures', cta_type: 'Appels à l’action', emotion: 'Émotions et leviers', slides: 'Nombre de slides', topic: 'Sujets'};
    return `<div class="grid g4">${[['Publications analysées', d.totals.posts], ['Comptes', d.totals.authors], ['Plateformes', d.totals.platforms], ['Depuis', d.totals.since ? day(d.totals.since) : '—']].map(([l, v]) => `<div class="card kpi"><span class="l">${l}</span><span class="v">${typeof v === 'number' ? fmt(v) : esc(v)}</span></div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><h2>Ajouter des publications <span class="small muted">JSON / CSV : export Firecrawl, Metricool, Zernio…</span></h2><div class="row act"><input type="file" id="imp" accept=".json,.jsonl,.csv"><button class="btn primary" id="impbtn">Importer et analyser</button></div><div class="small muted" style="margin-top:8px">Sources : ${d.sources.map((s) => `${esc(s.source)} (${esc(s.platform)}) : ${s.n}`).join(' · ') || '—'}</div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Ce qui marche</h2>${d.insights.length ? `<ul class="list">${d.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<div class="empty">Pas encore assez de données</div>'}</div>
      <div class="card"><h2>Formats répétés chez plusieurs concurrents</h2>${d.shared.length ? `<ul class="list">${d.shared.map((s) => `<li>${esc(s.label)} <span class="muted small">· ×${s.lift} · ${s.authors} comptes</span></li>`).join('')}</ul>` : '<div class="empty">—</div>'}</div></div>
      <div class="grid g3" style="margin-top:16px">${Object.entries(dims).map(([k, label]) => `<div class="card"><h2>${label}</h2>${hbars(d.patterns.filter((p) => p.dimension === k && p.n >= 2).sort((a, b) => b.shrunk_score - a.shrunk_score).slice(0, 8), 'shrunk_score', (p) => `${p.label} (${p.n})`, 100)}</div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><h2>Comptes concurrents</h2><div class="scroll"><table><tr><th>Compte</th><th>Plateforme</th><th class="num">Abonnés</th><th class="num">Posts</th><th class="num">Vues (médiane)</th><th class="num">Score moyen</th><th class="num">Meilleur</th></tr>${d.competitors.slice(0, 60).map((c) => `<tr><td>@${esc(c.handle)}${c.tracked ? ' <span class="badge b-accent">suivi</span>' : ''}</td><td>${esc(c.platform)}</td><td class="num">${fmt(c.followers)}</td><td class="num">${c.posts_count}</td><td class="num">${fmt(c.median_views)}</td><td class="num">${scoreBadge(c.avg_score)}</td><td class="num">${scoreBadge(c.top_score)}</td></tr>`).join('')}</table></div></div>
      <div class="card" style="margin-top:16px"><h2>Tendances</h2>${d.trends.length ? `<table><tr><th>Type</th><th>Libellé</th><th>Statut</th><th class="num">Récents</th><th class="num">Avant</th><th class="num">Score</th></tr>${d.trends.map((t) => `<tr><td>${esc(t.kind)}</td><td>${esc(t.label)}</td><td>${esc(t.status)}</td><td class="num">${t.recent_n}</td><td class="num">${t.previous_n}</td><td class="num">${t.mean_score}</td></tr>`).join('')}</table>` : '<div class="empty">—</div>'}</div>`;
  };

  views.base = async () => {
    const params = baseParams;
    const d = await api(`/api/posts?${params.toString() || 'limit=100'}`);
    return `<div class="card"><div class="row act" style="margin-bottom:12px"><select id="fpf"><option value="">Toutes plateformes</option>${['tiktok', 'instagram', 'threads', 'youtube'].map((p) => `<option ${params.get('platform') === p ? 'selected' : ''}>${p}</option>`).join('')}</select><select id="fown"><option value="">Tout</option><option value="0" ${params.get('own') === '0' ? 'selected' : ''}>Concurrents</option><option value="1" ${params.get('own') === '1' ? 'selected' : ''}>Nos publications</option></select><input id="fq" placeholder="Rechercher…" value="${esc(params.get('q') || '')}"><select id="fsort"><option value="score">Tri : score</option><option value="views" ${params.get('sort') === 'views' ? 'selected' : ''}>Tri : vues</option><option value="date" ${params.get('sort') === 'date' ? 'selected' : ''}>Tri : date</option></select><button class="btn" id="fgo">Filtrer</button></div>
      <div class="small muted" style="margin-bottom:8px">${fmt(d.total)} publications</div><div class="scroll"><table><tr><th class="num">Score</th><th>Plateforme</th><th>Compte</th><th>Accroche</th><th>Type</th><th>Structure</th><th>CTA</th><th class="num">Slides</th><th class="num">Vues</th><th class="num">J’aime</th><th class="num">Comm.</th><th class="num">Partages</th><th class="num">Relatif</th><th>Date</th></tr>
      ${d.items.map((p) => `<tr><td class="num">${scoreBadge(p.score)}</td><td>${esc(p.platform)}${p.is_own ? ' <span class="badge b-accent">nous</span>' : ''}</td><td>@${esc(p.author)}</td><td style="min-width:260px">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc((p.hook || '').slice(0, 90))}</a>` : esc((p.hook || '').slice(0, 90))}</td><td>${esc(p.hook_type)}</td><td>${esc(p.structure)}</td><td>${esc(p.cta_type)}</td><td class="num">${p.slide_count ?? '—'}</td><td class="num">${fmt(p.views)}</td><td class="num">${fmt(p.likes)}</td><td class="num">${fmt(p.comments)}</td><td class="num">${fmt(p.shares)}</td><td class="num">${p.relative_perf ? `×${p.relative_perf}` : '—'}</td><td class="small">${p.published_at ? day(p.published_at) : '—'}</td></tr>`).join('')}</table></div></div>`;
  };

  views.generateur = async () => {
    const m = await api('/api/generator');
    return `${RO ? '<div class="notice">Instantané en lecture seule : la génération se lance depuis le tableau de bord local ou en ligne de commande.</div>' : ''}
      <div class="card act"><h2>Nouvelle génération</h2><div class="form">
        <label>Compte<select id="g-acc">${m.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.platform)} @${esc(a.handle)}</option>`).join('')}</select></label>
        <label>Niche<input value="${esc(m.niche.label)}" disabled></label>
        <label>Sujet<input id="g-topic" list="topics" placeholder="au choix de la machine"><datalist id="topics">${m.topics.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</datalist></label>
        <label>Nombre de slides<select id="g-slides"><option value="">automatique</option>${[5, 6, 7, 8, 9, 10, 12].map((n) => `<option>${n}</option>`).join('')}</select></label>
        <label>Style (modèle)<select id="g-tpl"><option value="">selon le compte</option>${m.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
        <label>Format<select id="g-structure"><option value="">automatique</option>${m.structures.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</select></label>
        <label>Dimensions<select id="g-format"><option value="">selon la plateforme</option>${m.formats.map((f) => `<option>${f}</option>`).join('')}</select></label>
        <label>Ton<select id="g-tone">${m.tones.map((t) => `<option>${t}</option>`).join('')}</select></label>
        <label>Langue<select id="g-lang">${m.languages.map((l) => `<option>${l}</option>`).join('')}</select></label>
        <label>Quantité<select id="g-qty">${m.quantities.map((q) => `<option ${q === 10 ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        <label>Produire<select id="g-mode"><option value="slideshows">des carrousels complets</option><option value="ideas">seulement des idées</option></select></label>
        <label>Moteur<select id="g-engine"><option value="auto">IA puis hors ligne</option><option value="ai">IA uniquement</option><option value="composer">Hors ligne (bibliothèque)</option></select></label>
      </div><div class="row" style="margin-top:14px"><button class="btn primary" id="g-go">Générer</button><span class="small muted">IA prévue pour la rédaction : ${esc(m.ai.modelId || 'aucune')}${m.ai.skipped.length ? ` (indisponibles : ${esc(m.ai.skipped.map((s) => s.split(' : ')[0]).join(', '))})` : ''}</span></div><div id="g-job" style="margin-top:12px"></div></div>
      <div class="card" style="margin-top:16px"><h2>Carrousels récents</h2>${thumbs(m.recent)}</div>
      <div class="card" style="margin-top:16px"><h2>Idées en réserve</h2>${m.ideas.length ? `<table><tr><th>Accroche</th><th>Structure</th><th>Modèle</th><th class="num">Prévu</th></tr>${m.ideas.map((i) => `<tr><td>${esc(i.hook)}</td><td>${esc(i.structure)}</td><td>${esc(i.template)}</td><td class="num">${Math.round(i.predicted)}</td></tr>`).join('')}</table>` : '<div class="empty">Aucune idée en réserve</div>'}</div>`;
  };


  /* ---------------- vidéos ---------------- */

  const VST = {en_cours: ['En production', 'b-info']};
  const vbadge = (s) => (VST[s] ? `<span class="badge ${VST[s][1]}">${VST[s][0]}</span>` : badge(s));
  let videoFilter = '';

  views.videos = async () => {
    const m = await api('/api/videos');
    if (!m) return '<div class="empty">Aucune vidéo dans cet instantané</div>';
    const c = m.counts;
    const tiles = [['generees', 'Générées', ''], ['en_cours', 'En cours', 'en_cours'], ['terminees', 'Terminées', 'ok'], ['a_verifier', 'À vérifier', 'awaiting_approval'], ['programmees', 'Programmées', 'scheduled'], ['publiees', 'Publiées', 'published'], ['echouees', 'Échouées', 'qc_failed']];
    const list = m.videos.filter((v) => !videoFilter || (videoFilter === 'ok' ? v.video && v.qc && v.qc.ok : v.status === videoFilter));
    const cost = (m.costs || []).reduce((a, r) => a + (r.cost_eur || 0), 0);
    return `<div class="grid g4">${tiles.map(([k, l, f]) => `<div class="card kpi" data-vf="${f}" style="cursor:pointer"><span class="l">${l}</span><span class="v">${fmt(c[k])}</span></div>`).join('')}<div class="card kpi"><span class="l">Coûts de génération</span><span class="v">${cost.toFixed(2)} €</span><span class="s">voix, plans et IA payants</span></div></div>
      ${RO ? '<div class="notice">Instantané en lecture seule : la production se lance depuis le tableau de bord local (npm run dashboard) ou en ligne de commande (factory:run).</div>' : ''}
      <div class="card act" style="margin-top:16px"><h2>Nouvelle production</h2><div class="form">
        <label>Compte<select id="v-acc">${m.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('')}</select></label>
        <label>Nombre de vidéos<select id="v-qty">${[1, 5, 10, 50, 100, 500].map((q) => `<option>${q}</option>`).join('')}</select></label>
        <label>Format<select id="v-format"><option value="">mélange choisi par la machine</option>${m.formats.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select></label>
        <label>Durée<select id="v-dur"><option value="">selon le compte</option>${[15, 30, 45, 60, 90].map((d) => `<option value="${d}">${d} s</option>`).join('')}</select></label>
        <label>Visuels<select id="v-vis"><option value="auto">automatique</option><option value="motion">animation 3D</option><option value="stock">plans vidéo sous licence</option><option value="images">images animées</option><option value="ai">séquences IA${m.aiVideo.some((p) => p.configured) ? '' : ' (aucune clé : plans sous licence)'}</option></select></label>
        <label>Budget payant (€)<input id="v-budget" type="number" min="0" step="0.5" value="0"></label>
      </div><div class="row" style="margin-top:14px"><button class="btn primary" id="v-go">Lancer la production</button><span class="small muted">Voix, musique et sous-titres : réglages de l’Audio Studio du compte.</span></div><div id="v-job" style="margin-top:12px"></div></div>
      ${m.jobs.length ? `<div class="card" style="margin-top:16px"><h2>En cours</h2><table><tr><th>Vidéo</th><th>Format</th><th>Étape</th><th class="num">Avancement</th><th>Dernières lignes</th></tr>${m.jobs.map((j) => `<tr><td>${esc(j.slideshow_id || '—')}</td><td>${esc(j.params.format)} ${esc(j.params.duration)} s</td><td>${esc(j.step || 'en attente')}</td><td class="num">${Math.round(j.progress * 100)} %</td><td class="small">${j.log.map(esc).join('<br>')}</td></tr>`).join('')}</table></div>` : ''}
      <div class="card" style="margin-top:16px"><h2>Bibliothèque${videoFilter ? ` · filtre « ${esc(videoFilter)} » <a href="#videos" data-vf="">(tout voir)</a>` : ''}</h2>${list.length ? `<div class="thumbs">${list.map((v) => `<div class="thumb" data-vid="${esc(v.id)}"><div class="img" style="${v.poster ? `background-image:url('${esc(v.poster)}')` : ''}">${v.poster ? '' : 'pas encore montée'}</div><div class="meta"><div class="t">${esc(v.hook)}</div><div class="row">${vbadge(v.status)}${v.qc ? `<span class="badge ${v.qc.ok ? 'b-good' : 'b-bad'}">QC ${v.qc.score}</span>` : ''}</div><div class="small muted">${esc(v.formatLabel)} · ${v.duration ? `${v.duration} s` : '—'} · ${esc(v.voice)} · ${esc(v.music)}</div><div class="small muted">${esc(v.account)}${v.perf ? ` · ${fmt(v.perf.views)} vues` : ''}${v.costEur ? ` · ${v.costEur} €` : ''}</div></div></div>`).join('')}</div>` : '<div class="empty">Aucune vidéo</div>'}</div>
      ${m.batches.length ? `<div class="card" style="margin-top:16px"><h2>Lots</h2><table><tr><th>Lot</th><th>Compte</th><th class="num">Faites</th><th class="num">Échouées</th><th class="num">Quantité</th><th>Statut</th><th class="num">Dépense</th></tr>${m.batches.map((b) => `<tr><td>${esc(b.id)}</td><td>${esc(b.account_id)}</td><td class="num">${b.done}</td><td class="num">${b.failed}</td><td class="num">${b.quantity}</td><td>${esc(b.status)}</td><td class="num">${(b.spent_eur || 0).toFixed(2)} €</td></tr>`).join('')}</table></div>` : ''}`;
  };

  async function openVideo(id) {
    const v = await api(`/api/videos/${id}`);
    if (!v) return toast('Vidéo indisponible dans cet instantané');
    const f = (v.files || [])[0] || {};
    const qc = f.qc;
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="box"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(v.hook)}</h2><div class="small muted">${esc(v.account)} · ${esc(v.spec.format)} · ${esc(v.spec.aspect)} · voix ${esc(v.spec.voice && v.spec.voice.id)} · musique ${esc(v.spec.music && v.spec.music.mood)}</div></div><button class="btn" data-close>Fermer</button></div>
      <div class="grid g2" style="margin-top:14px"><div>${f.url ? `<video controls playsinline preload="metadata" src="${esc(f.url)}" poster="${esc(f.poster || '')}" style="width:100%;max-height:70vh;background:#000;border-radius:12px"></video>` : '<div class="empty">Pas encore montée</div>'}
        <div class="small muted" style="margin-top:6px">${(v.files || []).map((x) => `${esc(x.aspect)} : ${x.duration ? x.duration.toFixed(1) : '—'} s, ${x.mo} Mo${x.srt ? ` · <a href="${esc(x.srt)}">sous-titres</a>` : ''}`).join(' · ')}</div></div>
        <div>${badge(v.status)} ${qc ? `<span class="badge ${qc.ok ? 'b-good' : 'b-bad'}">Contrôle ${qc.score}/100</span>` : ''}
        <h3>Contrôle qualité</h3>${qc ? `<div class="small">${Object.entries(qc.checks).map(([k, s]) => `<span class="badge ${s === 'ok' ? 'b-good' : s === 'échec' ? 'b-bad' : s === 'avertissement' ? 'b-warn' : ''}">${esc(k)}</span>`).join(' ')}</div><ul class="list">${qc.errors.map((e) => `<li><span class="badge b-bad">Bloquant</span> ${esc(e.message)}</li>`).join('')}${qc.warnings.map((e) => `<li><span class="badge b-warn">À voir</span> ${esc(e.message)}</li>`).join('')}</ul><div class="small muted">${Object.entries(qc.measures || {}).map(([k, x]) => `${esc(k)} : ${esc(x)}`).join(' · ')}</div>` : '<div class="empty">Non contrôlée</div>'}
        <h3>Script</h3><ol class="small">${v.script.map((x) => `<li><b>${esc(x.role)}</b> — ${esc(x.narration || x.title)}</li>`).join('')}</ol>
        <h3>Droits des médias</h3><ul class="list small">${v.assets.map((a) => `<li>${esc(a.role)} : ${esc(a.provider)}${a.author ? ` (${esc(a.author)})` : ''} — ${esc(a.license)}</li>`).join('')}</ul>
        <h3>Description</h3><pre class="caption">${esc(v.caption)}</pre></div></div>
      <div class="row act" style="margin-top:16px"><button class="btn primary" data-va="approve">Valider</button><button class="btn" data-va="schedule">Programmer au prochain créneau</button><button class="btn" data-va="render">Remonter + contrôler</button><button class="btn" data-va="export">Paquet manuel (ZIP)</button><button class="btn danger" data-va="reject">Refuser</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', async (e) => {
      if (e.target === m || e.target.dataset.close !== undefined) return m.remove();
      const a = e.target.dataset.va;
      if (!a) return;
      try {
        if (a === 'approve') await post(`/api/slideshows/${id}/approve`, {});
        if (a === 'reject') await post(`/api/slideshows/${id}/reject`, {reason: prompt('Raison du refus ?') || 'refusé'});
        if (a === 'schedule') toast(`Programmée : ${dt((await post(`/api/slideshows/${id}/schedule`, {})).at)}`);
        if (a === 'render') pollJob((await post(`/api/videos/${id}/render`, {})).id, m.querySelector('.act'));
        if (a === 'export') toast(`Paquet prêt : ${(await post(`/api/videos/${id}/export`, {})).zip}`, 6000);
        if (a !== 'render' && a !== 'export') (m.remove(), route());
      } catch (err) {
        toast(err.message, 6000);
      }
    });
  }

  /* ---------------- Audio Studio ---------------- */

  let audioAccount = null;
  views.audio = async () => {
    const m = await api('/api/audio');
    if (!m) return '<div class="empty">Audio Studio indisponible</div>';
    const acc = m.accounts.find((a) => a.id === audioAccount) || m.accounts[0];
    audioAccount = acc.id;
    const A = acc.audio, C = acc.captions, V = acc.voice;
    const langs = [...new Set(m.voices.flatMap((v) => v.languages))];
    const opt = (vals, cur, lab = (x) => x) => vals.map((x) => `<option value="${esc(x)}" ${String(x) === String(cur) ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
    const player = (u) => (u ? `<audio controls preload="none" src="${esc(u)}" style="width:100%;height:34px"></audio>` : '<span class="small muted">aperçu : npm run viral -- audio:previews</span>');
    return `${RO ? '<div class="notice">Instantané en lecture seule : les aperçus s’écoutent ici ; les réglages se changent depuis le tableau de bord local ou par « audio:set ».</div>' : ''}
      <div class="card act"><div class="form"><label>Compte<select id="au-acc">${m.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === acc.id ? 'selected' : ''}>${esc(a.platform)} @${esc(a.handle)}</option>`).join('')}</select></label>
        <label>Mode<select id="au-auto"><option value="true" ${A.auto ? 'selected' : ''}>AUTOMATIQUE : la machine choisit tout selon le script</option><option value="false" ${!A.auto ? 'selected' : ''}>Manuel : mes choix ci-dessous</option></select></label></div></div>
      <div class="card" style="margin-top:16px"><h2>Voix</h2><div class="form act"><label>Voix du compte<select id="au-voice"><option value="auto">automatique (${V.gender === 'male' ? 'masculine' : 'féminine'})</option>${m.voices.map((v) => `<option value="${esc(v.id)}" ${v.id === V.id ? 'selected' : ''}>${esc(v.label)} · ${v.gender === 'male' ? 'homme' : v.gender === 'female' ? 'femme' : '—'} · ${esc(v.language)}</option>`).join('')}</select></label>
        <label>Genre (voix automatique)<select id="au-gender">${opt(['female', 'male'], V.gender, (x) => (x === 'male' ? 'masculine' : 'féminine'))}</select></label>
        <label>Langue<select id="au-lang">${opt(langs, V.language)}</select></label>
        <label>Vitesse<input id="au-speed" type="number" min="0.7" max="1.4" step="0.05" value="${V.speed}"></label>
        <label>Ton (demi-tons)<input id="au-pitch" type="number" min="-4" max="4" step="0.5" value="${A.pitch}"></label>
        <label>Intonation<select id="au-into">${opt(['neutre', 'expressive', 'calme'], V.intonation)}</select></label></div>
        <table style="margin-top:12px"><tr><th>Voix</th><th>Langue · accent</th><th>Style</th><th>Licence</th><th style="width:260px">Écouter</th></tr>${m.voices.map((v) => `<tr><td><b>${esc(v.label)}</b><div class="small muted">${v.gender === 'male' ? 'homme' : v.gender === 'female' ? 'femme' : '—'} · ${v.local ? 'locale, gratuite' : 'service en ligne'}</div></td><td>${esc(v.language)}${v.languages.length > 1 ? ` <span class="small muted">(+${v.languages.length - 1})</span>` : ''} · ${esc(v.accent)}</td><td class="small">${esc(v.style)}<div class="muted">${esc(v.speed)}</div></td><td class="small">${esc(v.license)}<div class="muted">usage commercial : ${esc(v.commercial)}</div></td><td>${player(v.preview)}</td></tr>`).join('')}</table>
        <div class="form act" style="margin-top:12px"><label style="grid-column:1/-1">Écouter une phrase à moi<input id="au-text" maxlength="400" placeholder="Tape une phrase, puis « Écouter » (voix, vitesse et ton ci-dessus)"></label></div><div class="row act"><button class="btn" id="au-try">Écouter</button><span id="au-tryout"></span></div></div>
      <div class="card" style="margin-top:16px"><h2>Musique</h2><div class="form act"><label>Ambiance<select id="au-music"><option value="auto" ${A.musicCategory === 'auto' ? 'selected' : ''}>automatique selon le sujet</option>${m.music.map((x) => `<option value="${esc(x.id)}" ${x.id === A.musicCategory ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
        <label>Source<select id="au-msrc">${opt(['original', 'licence', 'aucune'], acc.music, (x) => ({original: 'musique originale (aucun droit tiers)', licence: 'pistes sous licence (bibliothèque)', aucune: 'pas de musique'})[x])}</select></label>
        <label>Volume sous la voix<input id="au-mvol" type="range" min="0" max="1" step="0.05" value="${A.musicVolume}"></label>
        <label>Baisse pendant la voix<select id="au-duck">${opt(['leger', 'normal', 'fort'], A.ducking, (x) => ({leger: 'légère', normal: 'normale', fort: 'forte'})[x])}</select></label>
        <label>Fondu d’entrée (s)<input id="au-fin" type="number" min="0" max="5" step="0.1" value="${A.fadeIn}"></label>
        <label>Fondu de sortie (s)<input id="au-fout" type="number" min="0" max="8" step="0.1" value="${A.fadeOut}"></label></div>
        <div class="grid g3" style="margin-top:12px">${m.music.map((x) => `<div class="card" style="padding:12px"><b>${esc(x.label)}</b><div class="small muted">${esc(x.description)}</div>${player(x.preview)}</div>`).join('')}</div>
        <h3>Pistes sous licence</h3>${m.tracks.length ? `<ul class="list small">${m.tracks.map((t) => `<li>${esc(t.title)} — ${esc(t.artist)} · ${esc(t.license)} · ${esc((t.platforms || []).join(', ') || 'tous réseaux')}${t.problems.length ? ` <span class="badge b-bad">${esc(t.problems.join(' ; '))}</span>` : ''}</li>`).join('')}</ul>` : '<div class="small muted">Aucune : ajoutez une piste avec sa preuve de licence (music:add). La musique originale est utilisée en attendant.</div>'}</div>
      <div class="card" style="margin-top:16px"><h2>Effets sonores</h2><div class="form act"><label>Effets<select id="au-sfx">${opt(['true', 'false'], String(A.sfx), (x) => (x === 'true' ? 'activés (placés automatiquement)' : 'désactivés'))}</select></label><label>Volume des effets<input id="au-sfxv" type="range" min="0" max="2" step="0.1" value="${A.sfxVolume}"></label><label>Ambiances de fond<select id="au-amb">${opt(['true', 'false'], String(A.ambience), (x) => (x === 'true' ? 'oui' : 'non'))}</select></label><label>Volume de la voix<input id="au-vvol" type="range" min="0.5" max="1.5" step="0.05" value="${A.voiceVolume}"></label></div>
        <div class="grid g3" style="margin-top:12px">${m.sfx.map((x) => `<div><div class="small">${esc(x.label)}</div>${player(x.preview)}</div>`).join('')}</div></div>
      <div class="card" style="margin-top:16px"><h2>Sous-titres</h2><div class="form act"><label>Style<select id="au-cst">${opt(m.captionStyles, C.style, (x) => ({auto: 'selon le format', mot: 'mot par mot', phrase: 'phrase par phrase', tiktok: 'style TikTok', documentaire: 'documentaire', minimal: 'minimaliste', cinematique: 'cinématique'})[x])}</select></label>
        <label>Police<select id="au-cfont"><option value="">selon le modèle</option>${opt(['Inter', 'Montserrat', 'Poppins', 'Anton', 'Archivo Black', 'Space Grotesk', 'Playfair Display', 'DM Serif Display', 'Lora', 'Caveat'], C.font || '')}</select></label>
        <label>Couleur<input id="au-ccol" type="color" value="${esc(C.color)}"></label><label>Mots importants<input id="au-chi" type="color" value="${esc(C.highlight || '#FFC857')}"></label>
        <label>Taille<input id="au-csize" type="range" min="0.6" max="1.6" step="0.05" value="${C.size}"></label><label>Position<select id="au-cpos">${opt(['haut', 'milieu', 'bas'], C.position)}</select></label>
        <label>Animation<select id="au-canim">${opt(m.animations, C.animation)}</select></label><label>Mettre en évidence<select id="au-cemph">${opt(['true', 'false'], String(C.emphasis), (x) => (x === 'true' ? 'chiffres, marque, mots clés' : 'non'))}</select></label></div></div>
      <div class="row act" style="margin-top:16px"><button class="btn primary" id="au-save">Enregistrer pour ce compte</button><span class="small muted">Synchronisation automatique : coupes calées sur la voix et le rythme, sous-titres sur chaque mot dit.</span></div>`;
  };

  views.templates = async () => {
    const list = await api('/api/templates');
    return `<div class="grid g2">${list.map((t) => `<div class="card"><h2>${esc(t.name)} <span class="badge">${esc(t.category)}</span></h2><div class="small">${esc(t.description)}</div><div class="small muted" style="margin:6px 0 10px">Polices : ${esc(t.fonts.heading)} / ${esc(t.fonts.body)} · idéal pour : ${t.bestFor.map(esc).join(', ')}</div><div class="slides">${t.previews.length ? t.previews.map((p) => `<img src="${esc(p)}" style="height:240px" alt="">`).join('') : '<div class="empty">Aperçus : npm run viral -- dashboard:previews</div>'}</div></div>`).join('')}</div>`;
  };

  views.calendrier = async () => {
    const d = await api('/api/calendar');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const days = Array.from({length: 28}, (_, i) => new Date(start.getTime() + i * 86400000));
    const key = (x) => new Date(x).toLocaleDateString('fr-CA', {timeZone: 'Europe/Paris'});
    const today = key(new Date());
    return `<div class="row act" style="margin-bottom:14px"><button class="btn primary" id="auto-sched">Programmer automatiquement les carrousels validés</button><span class="small muted">${d.reserved ? esc(d.reserved.note) : ''}</span></div>
      <div class="cal">${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((w) => `<div class="small muted" style="font-weight:800;padding:0 4px">${w}</div>`).join('')}
      ${days.map((x) => {
        const k = key(x);
        const ev = d.items.filter((i) => key(i.scheduled_for) === k);
        return `<div class="day ${k === today ? 'today' : ''}"><span class="d">${x.toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'})}</span>${ev.map((e) => `<div class="ev" data-ss="${esc(e.slideshow_id)}" style="cursor:pointer"><b>${esc(e.local.slice(11, 16))}</b> ${esc(e.account_id.split('-')[0])} · ${badge(e.status)}<br>${esc((e.hook || '').slice(0, 60))}</div>`).join('')}</div>`;
      }).join('')}</div>`;
  };

  views.publications = async () => {
    const d = await api('/api/publications');
    return `<div class="row act" style="margin-bottom:14px"><button class="btn" id="pub-dry">Vérifier ce qui est dû (simulation)</button><button class="btn primary" id="pub-run">Publier ce qui est dû</button><span class="small muted">Publication réelle seulement pour les comptes où « publication auto » est autorisée ; sinon un paquet à poster à la main est préparé.</span></div>
      <div class="card"><h2>À valider et validés</h2>${thumbs(d.awaiting)}</div>
      <div class="card" style="margin-top:16px"><h2>File de publication</h2><div class="scroll"><table><tr><th>Quand (Paris)</th><th>Compte</th><th>Carrousel</th><th>Par</th><th>Statut</th><th>Détail</th><th class="act"></th></tr>${d.queue.map((q) => `<tr><td class="small">${esc(q.local)}</td><td>${esc(q.account_id)}</td><td><a href="javascript:void 0" data-ss="${esc(q.slideshow_id)}">${esc((q.hook || '').slice(0, 60))}</a></td><td>${esc(q.provider)}</td><td>${badge(q.status)}</td><td class="small">${q.permalink ? `<a href="${esc(q.permalink)}" target="_blank" rel="noopener">voir le post</a>` : esc(q.last_error || q.provider_post_id || '')}</td><td class="act">${['failed', 'deferred', 'manual_required'].includes(q.status) ? `<button class="btn" data-retry="${esc(q.id)}">Relancer</button>` : ''}${['planned', 'deferred', 'manual_required'].includes(q.status) ? `<button class="btn danger" data-cancel="${esc(q.id)}">Annuler</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">File vide</td></tr>'}</table></div></div>
      <div class="card" style="margin-top:16px"><h2>Historique des publications</h2><table>${d.log.map((l) => `<tr><td class="small">${dt(l.at)}</td><td><span class="badge ${l.level === 'error' ? 'b-bad' : l.level === 'warn' ? 'b-warn' : ''}">${esc(l.level)}</span></td><td>${esc(l.message)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>`;
  };

  views.analytics = async () => {
    const d = await api('/api/analytics');
    return `<div class="grid g4">${d.byPlatform.map((p) => `<div class="card kpi"><span class="l">${esc(p.platform)}</span><span class="v">${fmt(p.views)}</span><span class="s">${p.posts} publications · ${fmt(p.avgViews)} vues en moyenne · score ${p.avgScore}</span></div>`).join('') || '<div class="card empty">Importe les statistiques de tes comptes</div>'}</div>
      <div class="card act" style="margin-top:16px"><h2>Importer des statistiques <span class="small muted">export Zernio ou Metricool (JSON)</span></h2><div class="row"><input type="file" id="ana" accept=".json,.jsonl,.csv"><button class="btn primary" id="anabtn">Importer, noter et apprendre</button></div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Ce qui marche chez nous</h2>${d.ownPatterns.length ? `<ul class="list">${d.ownPatterns.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<div class="empty">Il faut quelques publications notées</div>'}</div>
      <div class="card"><h2>Apprentissage (moyenne des scores par choix)</h2><div class="scroll" style="max-height:360px"><table><tr><th>Dimension</th><th>Valeur</th><th class="num">n</th><th class="num">Score</th></tr>${d.learning.map((l) => `<tr><td>${esc(l.dimension)}</td><td>${esc(l.value)}</td><td class="num">${l.n}</td><td class="num">${scoreBadge(l.mean)}</td></tr>`).join('')}</table></div></div></div>
      <div class="card" style="margin-top:16px"><h2>Nos publications</h2><div class="scroll"><table><tr><th class="num">Score</th><th>Plateforme</th><th>Accroche</th><th>Type</th><th class="num">Vues</th><th class="num">J’aime</th><th class="num">Comm.</th><th class="num">Partages</th><th class="num">Enreg.</th><th>Date</th></tr>${d.own.map((p) => `<tr><td class="num">${scoreBadge(p.score)}</td><td>${esc(p.platform)}</td><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc((p.hook || '').slice(0, 80))}</a>` : esc((p.hook || '').slice(0, 80))}</td><td>${esc(p.hook_type)}</td><td class="num">${fmt(p.views)}</td><td class="num">${fmt(p.likes)}</td><td class="num">${fmt(p.comments)}</td><td class="num">${fmt(p.shares)}</td><td class="num">${fmt(p.saves)}</td><td class="small">${day(p.published_at)}</td></tr>`).join('')}</table></div></div>`;
  };

  views.parametres = async () => {
    const d = await api('/api/settings');
    return `<div class="card"><h2>Comptes</h2><div class="scroll"><table><tr><th>Compte</th><th>Carrousels</th><th>Validation humaine</th><th>Publication auto</th><th class="num">Par jour</th><th class="num">Par semaine</th><th class="num">Écart (min)</th><th>Plage</th><th>Heures préférées</th></tr>${d.accounts.map((a) => `<tr><td>${esc(a.id)}</td><td>${a.slideshows ? 'oui' : 'non'}</td><td>${a.settings.requireApproval ? 'oui' : 'non'}</td><td>${a.settings.autoPublish ? 'oui' : 'non'}</td><td class="num">${a.limits.maxPerDay}</td><td class="num">${a.limits.maxPerWeek}</td><td class="num">${a.limits.minGapMinutes}</td><td>${esc(a.limits.window.join('–'))}</td><td>${esc(a.limits.preferredTimes.join(', '))}</td></tr>`).join('')}</table></div></div>
      <div class="card" style="margin-top:16px"><h2>Modèles d’IA <span class="small muted">budget global ${d.budget} $ / jour</span></h2><div class="scroll"><table><tr><th>Modèle</th><th>Rôles</th><th>Prêt</th><th class="num">Entrée $/M</th><th class="num">Sortie $/M</th><th class="num">Appels (jour)</th><th class="num">Coût (jour)</th><th class="act"></th></tr>${d.ai.map((m) => `<tr><td>${esc(m.id)}</td><td class="small">${m.roles.map(esc).join(', ')}</td><td>${m.reason ? `<span class="badge b-warn">${esc(m.reason)}</span>` : '<span class="badge b-good">oui</span>'}</td><td class="num">${m.inputPerMTok}</td><td class="num">${m.outputPerMTok}</td><td class="num">${m.callsToday}</td><td class="num">${Number(m.costToday).toFixed(3)}</td><td class="act"><button class="btn" data-ai="${esc(m.id)}" data-en="${!m.enabled}">${m.enabled ? 'Désactiver' : 'Activer'}</button></td></tr>`).join('')}</table></div>
      <h3>Rôles</h3><ul class="list">${Object.entries(d.roles).map(([k, r]) => `<li><b>${esc(r.label)}</b> <span class="small muted">→ ${r.order.map(esc).join(' → ')}</span></li>`).join('')}</ul></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Mentions et conformité</h2><ul class="list"><li>Mention : « ${esc(d.compliance.disclosure.badge)} » ${d.compliance.disclosure.everySlide ? 'sur chaque slide' : 'sur la première slide'}, légende commençant par « ${esc(d.compliance.disclosure.captionPrefix)} »</li><li>${esc(d.compliance.disclosure.law)}</li><li>Lien affilié : ${esc(d.compliance.affiliateUrl)}</li><li>Faits vérifiés utilisables : ${d.facts.usable}/${d.facts.total} (mis à jour le ${dt(d.facts.updatedAt)})</li></ul></div>
      <div class="card"><h2>Règles des plateformes <span class="small muted">vérifiées le ${esc(d.platforms.checkedOn)}</span></h2><ul class="list">${Object.entries(d.platforms.platforms).map(([k, p]) => `<li><b>${esc(p.label)}</b> : ${p.carousel ? `${p.minSlides}–${p.maxSlides} slides, légende ${p.captionMax} caractères, plafond ${p.dailyCap}/24 h` : 'pas de carrousel'}<div class="small muted">${p.sources.map(esc).join(' · ')}</div></li>`).join('')}</ul></div></div>`;
  };

  views.integrations = async () => {
    const d = await api('/api/integrations');
    return `<div class="card"><h2>Connecteurs MCP (audit)</h2>${d.mcp.length ? `<table><tr><th>Connecteur</th><th>État</th><th>Usage dans la machine</th><th>Constat</th></tr>${d.mcp.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td><span class="badge ${c.status === 'connecté' ? 'b-good' : c.status === 'introuvable' ? 'b-bad' : 'b-warn'}">${esc(c.status)}</span></td><td class="small">${esc(c.use)}</td><td class="small">${esc(c.note)}</td></tr>`).join('')}</table>` : '<div class="empty">Audit non enregistré</div>'}</div>
      <div class="card" style="margin-top:16px"><h2>API (exécution autonome)</h2><table><tr><th>API</th><th>Usage</th><th>Clé</th><th>Note</th></tr>${d.apis.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td class="small">${esc(a.use)}</td><td>${a.configured ? '<span class="badge b-good">présente</span>' : '<span class="badge b-warn">absente</span>'}</td><td class="small">${esc(a.note)}</td></tr>`).join('')}</table></div>
      <div class="card" style="margin-top:16px"><h2>IA disponibles</h2><table><tr><th>Modèle</th><th>État</th></tr>${d.ai.map((m) => `<tr><td>${esc(m.id)}</td><td>${m.reason ? `<span class="badge b-warn">${esc(m.reason)}</span>` : '<span class="badge b-good">prêt</span>'}</td></tr>`).join('')}</table></div>`;
  };

  /* ---------------- events ---------------- */

  async function readFile(input) {
    const f = input.files && input.files[0];
    if (!f) throw new Error('Choisis un fichier');
    return {filename: f.name, content: await f.text()};
  }

  async function pollJob(id, el) {
    for (;;) {
      const j = await api(`/api/jobs/${id}`);
      el.innerHTML = `<div class="small">${esc(j.progress)}</div>${j.status === 'running' ? '<div class="progress-line"><i></i></div>' : ''}`;
      if (j.status === 'done') {
        const r = j.result;
        toast(`${(r.slideshowIds || []).length || (r.ideaIds || []).length} créés (${r.engine})${r.controleKo ? ` · ${r.controleKo} bloqués par le contrôle` : ''}`, 6000);
        return route();
      }
      if (j.status === 'error') return (el.innerHTML = `<div class="notice warn">${esc(j.error)}</div>`);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  document.addEventListener('click', async (e) => {
    const t = e.target;
    try {
      if (t.closest && t.closest('[data-vid]')) return openVideo(t.closest('[data-vid]').dataset.vid);
      if (t.closest && t.closest('[data-vf]')) {
        videoFilter = t.closest('[data-vf]').dataset.vf;
        return route();
      }
      if (t.id === 'v-go') {
        const f = $('#v-format').value, d = $('#v-dur').value;
        const job = await post('/api/factory', {accountId: $('#v-acc').value, quantity: Number($('#v-qty').value), formats: f ? [f] : undefined, durations: d ? [Number(d)] : undefined, visuals: $('#v-vis').value, budgetEur: Number($('#v-budget').value || 0)});
        toast(`Lot ${job.batchId} lancé : ${job.plan.length} vidéo(s)`);
        pollJob(job.id, $('#v-job'));
      }
      if (t.id === 'au-try') {
        const job = await post('/api/audio/preview', {voice: $('#au-voice').value === 'auto' ? undefined : $('#au-voice').value, text: $('#au-text').value, speed: $('#au-speed').value, pitch: $('#au-pitch').value, language: $('#au-lang').value});
        $('#au-tryout').textContent = 'synthèse en cours…';
        const wait = async () => {
          const j = await api(`/api/jobs/${job.id}`);
          if (j.status === 'running') return setTimeout(wait, 1500);
          $('#au-tryout').innerHTML = j.status === 'done' ? `<audio controls autoplay src="${esc(j.result.url)}?t=${Date.now()}"></audio>` : `<span class="badge b-bad">${esc(j.error)}</span>`;
        };
        wait();
      }
      if (t.id === 'au-save') {
        const v = (id) => $(id).value;
        await post(`/api/audio/settings/${encodeURIComponent(audioAccount)}`, {
          voice: {id: v('#au-voice'), gender: v('#au-gender'), language: v('#au-lang'), speed: Number(v('#au-speed')), intonation: v('#au-into')},
          audio: {auto: v('#au-auto') === 'true', musicCategory: v('#au-music'), musicVolume: Number(v('#au-mvol')), ducking: v('#au-duck'), fadeIn: Number(v('#au-fin')), fadeOut: Number(v('#au-fout')), sfx: v('#au-sfx') === 'true', sfxVolume: Number(v('#au-sfxv')), ambience: v('#au-amb') === 'true', voiceVolume: Number(v('#au-vvol')), pitch: Number(v('#au-pitch'))},
          captions: {style: v('#au-cst'), font: v('#au-cfont') || undefined, color: v('#au-ccol'), highlight: v('#au-chi'), size: Number(v('#au-csize')), position: v('#au-cpos'), animation: v('#au-canim'), emphasis: v('#au-cemph') === 'true'},
          music: v('#au-msrc'),
        });
        toast('Identité sonore enregistrée pour ce compte');
      }
      if (t.id === 'g-go') {
        const v = (id) => $(id).value || undefined;
        const job = await post('/api/generate', {accountId: v('#g-acc'), topic: v('#g-topic'), slides: v('#g-slides'), template: v('#g-tpl'), structure: v('#g-structure'), format: v('#g-format'), tone: v('#g-tone'), language: v('#g-lang'), quantity: Number(v('#g-qty')), mode: v('#g-mode'), engine: v('#g-engine')});
        pollJob(job.id, $('#g-job'));
      }
      if (t.id === 'fgo') {
        const p = new URLSearchParams();
        if ($('#fpf').value) p.set('platform', $('#fpf').value);
        if ($('#fown').value) p.set('own', $('#fown').value);
        if ($('#fq').value) p.set('q', $('#fq').value);
        p.set('sort', $('#fsort').value);
        p.set('limit', '200');
        baseParams = p;
        route();
      }
      if (t.id === 'impbtn') {
        const r = await post('/api/import', await readFile($('#imp')));
        toast(`Import ${r.kind} : ${r.saved.inserted} nouvelles publications`);
        route();
      }
      if (t.id === 'anabtn') {
        const r = await post('/api/import', await readFile($('#ana')));
        toast(`Statistiques importées : ${r.saved.inserted} nouvelles, ${r.saved.updated} mises à jour`);
        route();
      }
      if (t.id === 'auto-sched') {
        const r = await post('/api/schedule/auto', {});
        toast(`${r.length} carrousel(s) programmé(s)`);
        route();
      }
      if (t.id === 'pub-dry' || t.id === 'pub-run') {
        if (t.id === 'pub-run' && !confirm('Publier maintenant ce qui est dû sur les comptes où la publication automatique est autorisée ?')) return;
        const r = await post('/api/publish', {dryRun: t.id === 'pub-dry'});
        toast(`${r.considered} élément(s) dû(s) · publiés ${r.published} · confiés ${r.queued} · manuels ${r.manual} · reportés ${r.deferred} · échecs ${r.failed}`, 7000);
        route();
      }
      if (t.dataset.retry) {
        await post(`/api/schedule/${t.dataset.retry}/retry`);
        route();
      }
      if (t.dataset.cancel) {
        await post(`/api/schedule/${t.dataset.cancel}/cancel`);
        route();
      }
      if (t.dataset.toggle) {
        await post(`/api/accounts/${t.dataset.acc}`, {settings: {[t.dataset.toggle]: t.dataset.val === 'true'}});
        route();
      }
      if (t.dataset.ai) {
        await post(`/api/ai/${encodeURIComponent(t.dataset.ai)}`, {enabled: t.dataset.en === 'true'});
        route();
      }
    } catch (err) {
      toast(err.message, 6000);
    }
  });

  /* ---------------- router ---------------- */

  function nav(current) {
    $('#nav').innerHTML = PAGES.map(([id, label]) => `<a href="#${id}" class="${id === current ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS[id]}</svg>${label}</a>`).join('');
  }

  async function route() {
    document.querySelectorAll('.modal').forEach((m) => m.remove());
    const id = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard').trim();
    const page = PAGES.find((p) => p[0] === id) || PAGES[0];
    nav(page[0]);
    const view = $('#view');
    try {
      const html = await views[page[0]]();
      view.innerHTML = `<div class="head"><div><h1>${page[1]}</h1><p>${page[2]}${RO ? ` · instantané du ${esc(SNAP.takenAt || '')}` : ''}</p></div></div>${html}`;
    } catch (err) {
      view.innerHTML = `<div class="notice warn">${esc(err.message)}</div>`;
    }
  }

  document.addEventListener('change', (e) => {
    if (e.target.id === 'au-acc') {
      audioAccount = e.target.value;
      route();
    }
  });

  window.addEventListener('hashchange', route);
  route();
})();
