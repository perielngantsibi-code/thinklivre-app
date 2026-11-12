// THINK LIVRE Studio — version GitHub (gratuite). Les vidéos sont fabriquées par GitHub Actions
// dans le dépôt privé « thinklivre-studio ». La clé GitHub reste uniquement sur ce téléphone.
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const app = $("#app");
const LS = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const LSset = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
let OWNER = LS("tl_owner") || "perielngantsibi-code", REPO = LS("tl_repo") || "thinklivre-studio", TOKEN = LS("tl_token");
let tab = "accueil", livres = [], selection = new Set(), filtre = "tous", vfiltre = "toutes", timer = null;
const WF = "video.yml";

// ---------------- API GitHub
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path ? "/" + path : ""}`, {...opts,
    headers: {Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", ...(opts.body ? {"Content-Type": "application/json"} : {}), ...(opts.headers || {})}})
    .catch(() => { throw new Error("Pas de connexion internet. Réessaie dans un instant."); });
  if (r.status === 401) { reglerCle("Ta clé GitHub n'est plus valide."); throw new Error("connexion"); }
  if (!r.ok && r.status !== 204) { const e = await r.json().catch(() => ({})); throw new Error(e.message || `Erreur GitHub ${r.status}`); }
  return r.status === 204 ? null : r.json();
}
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
const b64enc = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function getJSON(path) {
  const f = await gh(`contents/${path}?ref=main&t=${Date.now()}`);
  if (f.content) return {data: JSON.parse(b64dec(f.content)), sha: f.sha};
  // au-delà de 1 Mo, GitHub ne renvoie pas le contenu : on le demande « brut »
  const data = await gh(`contents/${path}?ref=main&t=${Date.now()}`, {headers: {Accept: "application/vnd.github.raw+json"}});
  return {data, sha: f.sha};
}
async function putFile(path, bytes, sha, message) { return gh(`contents/${path}`, {method: "PUT", body: JSON.stringify({message, content: b64enc(bytes), sha, branch: "main"})}); }
async function putJSON(path, data, sha, message) { return putFile(path, new TextEncoder().encode(JSON.stringify(data, null, 1)), sha, message); }
async function majTextes(fn, message) { // lecture → modification → écriture (réessaie si quelqu'un a modifié entre-temps)
  oublier("textes", "runs");
  for (let i = 0; i < 3; i++) { const {data, sha} = await getJSON("data/textes.json"); fn(data); try { return await putJSON("data/textes.json", data, sha, message); } catch (e) { if (i === 2) throw e; } }
}
async function majConfig(fn, message) { oublier("cfg"); const {data, sha} = await getJSON("data/config.json"); fn(data); await putJSON("data/config.json", data, sha, message); return data; }
async function setSecret(name, value) { // chiffrement « sealed box » exigé par GitHub
  const [{default: nacl}, {blake2b}] = await Promise.all([import("./vendor/tweetnacl.mjs"), import("./vendor/blakejs.mjs")]);
  const {key, key_id} = await gh("actions/secrets/public-key");
  const pk = Uint8Array.from(atob(key), c => c.charCodeAt(0)), eph = nacl.box.keyPair();
  const nonce = blake2b(new Uint8Array([...eph.publicKey, ...pk]), undefined, 24);
  const boxed = nacl.box(new TextEncoder().encode(value), nonce, pk, eph.secretKey);
  await gh(`actions/secrets/${name}`, {method: "PUT", body: JSON.stringify({encrypted_value: b64enc(new Uint8Array([...eph.publicKey, ...boxed])), key_id})});
}

// ---------------- anti double appui : le bouton est bloqué tant que l'action n'est pas finie
const _verrous = new Set();
async function une(cle, fn, bouton) {
  if (_verrous.has(cle)) return; _verrous.add(cle); if (bouton) bouton.disabled = true;
  try { return await fn(); } catch (e) { if (e.message !== "connexion") toast(e.message); } finally { _verrous.delete(cle); if (bouton && bouton.isConnected) bouton.disabled = false; }
}
// ---------------- outils d'affichage
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; setTimeout(() => t.hidden = true, 2400); }
function sheet(html) { const s = $("#sheet"); s.innerHTML = `<div>${html}</div>`; s.hidden = false; s.onclick = e => { if (e.target === s) closeSheet(); }; }
function closeSheet() { $("#sheet").hidden = true; }
const livreTitre = id => (livres.find(b => b.id === id) || {}).titre || id;
const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
const uidDe = name => (name.match(/\[([a-z0-9]+)\]$/) || [])[1];

function reglerCle(msg = "") {
  sheet(`<h1>Connexion<b>.</b></h1>${msg ? `<p class="desc" style="color:#FF5A5A">${esc(msg)}</p>` : ""}
    <p class="desc">Colle ta <b>clé GitHub</b> (elle commence par <b>ghp_</b> ou <b>github_pat_</b>). Elle reste uniquement sur ce téléphone.</p>
    <label>Compte GitHub</label><input id="ow" value="${esc(OWNER)}">
    <label>Dépôt des vidéos</label><input id="rp" value="${esc(REPO)}">
    <label>Clé GitHub</label><input id="tk" type="password" autocomplete="off" value="">
    <button class="btn acc" id="go">Se connecter</button><p id="err" class="desc" style="color:#FF5A5A;margin-top:12px"></p><p class="t2">version 8</p>`);
  $("#go").onclick = () => une("go", async () => {
    OWNER = $("#ow").value.trim(); REPO = $("#rp").value.trim(); TOKEN = $("#tk").value.replace(/[^\x21-\x7e]/g, "");
    let etape = "internet";
    try {
      await fetch("https://api.github.com/zen").then(r => { if (!r.ok && r.status !== 403) throw new Error("GitHub " + r.status); });
      etape = "clé"; await gh("");
      etape = "données"; await chargerLivres();
      LSset("tl_owner", OWNER); LSset("tl_repo", REPO); LSset("tl_token", TOKEN); closeSheet(); render();
    } catch (e) {
      const m = {internet: "Impossible de joindre GitHub (connexion internet ou bloqueur de contenu ?)", clé: "GitHub refuse la clé ou le dépôt", données: "Le dépôt ne contient pas les données attendues"}[etape];
      $("#err").textContent = `${m} — détail : ${e.message}`;
    }
  }, $("#go"));
}

// ---------------- état : textes + exécutions GitHub + vidéos publiées
// ---------------- cache : on affiche tout de suite ce qu'on connaît, puis on met à jour en arrière-plan
let CACHE = {}; try { CACHE = JSON.parse(LS("tl_cache") || "{}"); } catch (e) {}
const sauverCache = () => { try { localStorage.setItem("tl_cache", JSON.stringify({textes: CACHE.textes, cfg: CACHE.cfg, runs: CACHE.runs, rel: CACHE.rel})); } catch (e) {} };
async function charge(key, fn) {
  if (CACHE[key] !== undefined) {
    if (Date.now() - (charge.t[key] || 0) < 15000) return CACHE[key];
    charge.t[key] = Date.now();
    fn().then(v => { if (JSON.stringify(v) !== JSON.stringify(CACHE[key])) { CACHE[key] = v; sauverCache(); if ($("#sheet").hidden) render(true); } }).catch(() => {});
    return CACHE[key];
  }
  CACHE[key] = await fn(); sauverCache(); return CACHE[key];
}
charge.t = {};
const oublier = (...ks) => ks.forEach(k => { delete CACHE[k]; delete charge.t[k]; });
async function etat() {
  const [textes, runs, rel, pub] = await Promise.all([charge("textes", async () => (await getJSON("data/textes.json")).data),
    charge("runs", () => gh(`actions/workflows/${WF}/runs?per_page=40`).catch(() => ({workflow_runs: []}))), charge("rel", () => gh("releases?per_page=100").catch(() => [])), charge("pub", relPubliques)]);
  const PUBS = new Set(pub);
  const releases = Object.fromEntries(rel.filter(r => r.tag_name.startsWith("video-")).map(r => [r.tag_name.slice(6), r]));
  const texteDe = uid => textes.find(x => x.uid === uid || (x.publies || []).includes(uid)) || {};
  const publiee = (t, uid) => (t.publies || []).includes(uid) || (t.statut === "publie" && t.uid === uid);
  const vids = runs.workflow_runs.map(r => {
    const uid = uidDe(r.name || ""); const t = texteDe(uid);
    const statut = releases[uid] ? (publiee(t, uid) ? "publiee" : "prete") : r.status !== "completed" ? (r.status === "in_progress" ? "en_cours" : "attente") : "erreur";
    return {uid, run: r, rel: releases[uid], pub: PUBS.has(uid), texte: t, statut, sujet: t.sujet || (r.name || "").replace(/^🎬 | \[.*$/g, ""), livre: t.livre};
  }).filter(v => v.uid);
  const vus = new Set(vids.map(v => v.uid));
  for (const [uid, rl] of Object.entries(releases)) if (!vus.has(uid)) {
    const t = texteDe(uid); vids.push({uid, run: null, rel: rl, pub: PUBS.has(uid), texte: t, statut: publiee(t, uid) ? "publiee" : "prete", sujet: t.sujet || rl.name || "Vidéo", livre: t.livre});
  }
  return {textes, vids};
}
const statutPill = v => ({attente: `<span class="pill">En attente</span>`, en_cours: `<span class="pill">Fabrication…</span>`,
  prete: `<span class="pill ok">Prête</span>`, publiee: `<span class="pill ok">Publiée</span>`, erreur: `<span class="pill err">Erreur</span>`})[v.statut];
function progression(v) { // estimation : environ 25 min par vidéo
  if (v.statut === "attente") return 2;
  const min = (Date.now() - new Date(v.run.run_started_at || v.run.created_at)) / 60000; return Math.min(95, Math.round(5 + 90 * min / 25));
}
function videoRow(v) {
  return `<div class="card row vrow" data-uid="${v.uid}">
    ${v.pub ? `<img class="thumb" src="${urlPub(v.uid, "miniature.jpg")}" alt="">` : `<div class="thumb" ${v.rel ? `data-thumb="${v.uid}"` : ""}></div>`}
    <div class="grow"><div class="t1">${esc(v.sujet)}</div><div class="t2">${esc(livreTitre(v.livre))}</div>
      ${["attente", "en_cours"].includes(v.statut) ? `<div class="bar"><i style="width:${progression(v)}%"></i></div>` : ""}</div>${statutPill(v)}</div>`;
}
let VIDS = [];
async function miniatures() {
  for (const el of document.querySelectorAll("[data-thumb]")) {
    const v = VIDS.find(x => x.uid === el.dataset.thumb); const a = v && v.rel.assets.find(x => x.name === "miniature.jpg"); if (!a) continue;
    try { const url = await asset(a.id); el.outerHTML = `<img class="thumb" src="${url}" alt="">`; } catch (e) {}
  }
}
// ---------------- copies publiques (dépôt thinklivre-app) : lisibles directement sur iPhone
const PUB = "thinklivre-app";
const urlPub = (uid, f) => `https://github.com/${OWNER}/${PUB}/releases/download/video-${uid}/${f}`;
async function relPubliques() {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${PUB}/releases?per_page=100`, {headers: {Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json"}}).catch(() => null);
  if (!r || !r.ok) return [];
  return (await r.json()).filter(x => x.tag_name.startsWith("video-") && x.assets.some(a => a.name === "video.mp4")).map(x => x.tag_name.slice(6));
}
async function lectureActivee() { try { await gh("actions/secrets/PUBLIER_TOKEN"); return true; } catch (e) { return false; } }
async function activerLecture() { await setSecret("PUBLIER_TOKEN", TOKEN); oublier("lecture"); toast("Lecture activée ✓ pour les prochaines vidéos"); }
const _assets = {};
async function asset(id) {
  if (_assets[id]) return _assets[id];
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${id}`, {headers: {Authorization: `Bearer ${TOKEN}`, Accept: "application/octet-stream"}});
  if (!r.ok) throw new Error("téléchargement"); return _assets[id] = URL.createObjectURL(await r.blob());
}
function bindVideoRows() { document.querySelectorAll(".vrow").forEach(r => r.onclick = () => ouvrirVideo(r.dataset.uid)); }
function poll() { clearTimeout(timer); timer = setTimeout(() => { if (["accueil", "videos"].includes(tab) && $("#sheet").hidden) render(); }, 30000); }

// ---------------- Accueil
async function accueil() {
  const {textes, vids} = await etat(); VIDS = vids;
  const prets = textes.filter(t => t.statut === "pret"); const p = prets[0];
  app.innerHTML = `
  <div class="top"><div class="brand">think<b>.</b>livre</div><img class="logo" src="icon-192.png" alt="Logo THINK LIVRE"></div>
  <h1>Prêt à<br>poster ?<b>↗</b></h1>
  ${p ? `<div class="hero"><div class="lab"><span>VIDÉO DU JOUR</span><span>${prets.length} en réserve</span></div>
      <h3>${esc(p.sujet || "Sans titre")}</h3><p>${esc(livreTitre(p.livre))}</p><button class="btn dark" id="creer">● Créer la vidéo</button></div>`
    : `<div class="card empty">Plus aucun texte en réserve.<br>Ajoute des textes dans l'onglet Textes.</div>`}
  <div class="grid2"><div class="card stat"><div class="n">${prets.length}</div><div class="l">textes en réserve</div></div>
    <div class="card stat"><div class="n">${vids.filter(v => v.statut === "prete").length}</div><div class="l">vidéos à publier</div></div></div>
  <h2>Récentes</h2>${vids.slice(0, 6).map(videoRow).join("") || `<div class="empty">Aucune vidéo pour l'instant.</div>`}`;
  if (p) $("#creer").onclick = () => une("creer", () => creer([p]), $("#creer"));
  bindVideoRows(); miniatures();
  if (vids.some(v => ["attente", "en_cours"].includes(v.statut))) poll();
}

// ---------------- Créer (une ou plusieurs vidéos)
async function creer(ts) {
  if (!ts.length) return;
  const {data: cfg} = await getJSON("data/config.json");
  const voixAuto = cfg.comptes.some(c => c.actif !== false) && cfg.voice_id;
  if (!voixAuto && ts.length > 1) return toast("Branche d'abord un compte ElevenLabs (Profil) pour créer en lot");
  if (!voixAuto) {
    sheet(`<h1>Voix<b>.</b></h1><p class="desc">Aucun compte ElevenLabs activé. Envoie le fichier MP3 de la voix pour ce texte.</p>
      <label>Fichier voix (MP3)</label><input type="file" id="mp3" accept="audio/*"><button class="btn acc" id="envoyer">Créer avec ce fichier</button>`);
    $("#envoyer").onclick = async () => {
      const f = $("#mp3").files[0]; if (!f) return toast("Choisis un fichier");
      $("#envoyer").disabled = true; $("#envoyer").textContent = "Envoi de la voix…";
      const uid = Math.random().toString(36).slice(2, 10); const path = `data/voix/${uid}.mp3`;
      try { await putFile(path, new Uint8Array(await f.arrayBuffer()), undefined, "Voix " + ts[0].sujet); await lancer(ts[0], uid, path); closeSheet(); }
      catch (e) { toast(e.message); $("#envoyer").disabled = false; $("#envoyer").textContent = "Créer avec ce fichier"; }
    };
    return;
  }
  for (const t of ts) await lancer(t, Math.random().toString(36).slice(2, 10), "");
  selection.clear();
}
async function lancer(t, uid, voix) {
  await gh(`actions/workflows/${WF}/dispatches`, {method: "POST", body: JSON.stringify({ref: "main", inputs: {texte: t.id, sujet: (t.sujet || "vidéo").slice(0, 80), uid, voix}})});
  try { await majTextes(d => { const x = d.find(y => y.id === t.id); if (x) { x.statut = "en_cours"; x.uid = uid; } }, "Création : " + t.sujet); }
  catch (e) { toast("Vidéo lancée, mais le texte n'a pas pu être mis à jour"); }
  toast("Vidéo lancée 🎬 (environ 30 min)"); setTimeout(() => go("videos"), 1500);
}

// ---------------- Textes
async function textes() {
  const ts = await charge("textes", async () => (await getJSON("data/textes.json")).data);
  const prets = ts.filter(t => t.statut === "pret");
  const ids = [...new Set(prets.map(t => t.livre))]; const vis = prets.filter(t => filtre === "tous" || t.livre === filtre);
  app.innerHTML = `<h1>Textes<b>.</b></h1>
    <div class="chips"><button class="chip ${filtre === "tous" ? "on" : ""}" data-f="tous">Tous les livres</button>
      ${ids.map(i => `<button class="chip ${filtre === i ? "on" : ""}" data-f="${i}">${esc(livreTitre(i))}</button>`).join("")}</div>
    ${vis.map(t => `<div class="card row trow" data-id="${t.id}"><div class="check ${selection.has(t.id) ? "on" : ""}">${selection.has(t.id) ? "✓" : ""}</div>
        <div class="grow"><div class="t1">${esc(t.sujet || "Sans titre")}</div><div class="t2">${esc(livreTitre(t.livre))}</div></div><span class="pill voir">Lire</span></div>`).join("") || `<div class="empty">Aucun texte prêt.</div>`}
    <button class="btn ghost" id="ajouter" style="margin-top:8px">＋ Ajouter un texte</button>
    ${selection.size ? `<div class="sticky"><button class="btn acc" id="lot">● Créer les ${selection.size} vidéo${selection.size > 1 ? "s" : ""}</button></div>` : ""}`;
  document.querySelectorAll(".chip").forEach(c => c.onclick = () => { filtre = c.dataset.f; textes(); });
  document.querySelectorAll(".trow").forEach(r => r.onclick = e => {
    if (e.target.classList.contains("voir")) return voirTexte(ts.find(t => t.id === r.dataset.id));
    selection.has(r.dataset.id) ? selection.delete(r.dataset.id) : selection.add(r.dataset.id); textes();
  });
  $("#ajouter").onclick = ajouterTexte;
  if (selection.size) $("#lot").onclick = () => une("creer", () => creer(ts.filter(t => selection.has(t.id))), $("#lot"));
}
function voirTexte(t) {
  sheet(`<h1>${esc(t.sujet || "Texte")}<b>.</b></h1><div class="t2" style="margin-bottom:12px">${esc(livreTitre(t.livre))}</div>
    <div class="card desc">${esc(t.script)}</div><button class="btn acc" id="c1">● Créer cette vidéo</button>
    <button class="btn ghost" id="del" style="margin-top:10px">Supprimer ce texte</button>`);
  $("#c1").onclick = () => une("creer", async () => { closeSheet(); await creer([t]); }, $("#c1"));
  $("#del").onclick = () => une("del", async () => { if (confirm("Supprimer ce texte ?")) { await majTextes(d => { const i = d.findIndex(x => x.id === t.id); if (i >= 0) d.splice(i, 1); }, "Suppression d'un texte"); closeSheet(); textes(); } }, $("#del"));
}
function ajouterTexte() {
  sheet(`<h1>Nouveau texte<b>.</b></h1>
    <label>Livre</label><select id="l">${livres.map(b => `<option value="${b.id}">${esc(b.titre)} — ${esc(b.auteur)}</option>`).join("")}</select>
    <label>Sujet (ex. « La dispute de couple »)</label><input id="s">
    <label>Texte de la voix (une phrase par ligne)</label><textarea id="sc"></textarea>
    <label>Description TikTok</label><textarea id="d" style="min-height:120px"></textarea><button class="btn acc" id="ok">Enregistrer</button>`);
  $("#ok").onclick = () => une("ok", async () => {
    const t = {id: Math.random().toString(36).slice(2, 10), livre: $("#l").value, sujet: $("#s").value.trim(), hook: "", script: $("#sc").value.trim(), description: $("#d").value.trim(), statut: "pret", cree: Date.now() / 1000};
    if (t.script.length < 50) return toast("Le texte est trop court");
    await majTextes(d => { if (!d.some(x => x.id === t.id)) d.push(t); }, "Nouveau texte : " + t.sujet); closeSheet(); toast("Texte ajouté"); textes();
  }, $("#ok"));
}

// ---------------- Vidéos
async function videos() {
  const {vids} = await etat(); VIDS = vids;
  const f = {toutes: () => true, publier: v => v.statut === "prete", publiees: v => v.statut === "publiee", cours: v => ["attente", "en_cours", "erreur"].includes(v.statut)}[vfiltre];
  app.innerHTML = `<h1>Vidéos<b>.</b></h1>
    <div class="chips">${[["toutes", "Toutes"], ["publier", "À publier"], ["cours", "En cours"], ["publiees", "Publiées"]].map(([k, l]) => `<button class="chip ${vfiltre === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
    ${vids.filter(f).map(videoRow).join("") || `<div class="empty">Rien ici pour l'instant.</div>`}`;
  document.querySelectorAll(".chip").forEach(c => c.onclick = () => { vfiltre = c.dataset.f; videos(); });
  bindVideoRows(); miniatures();
  if (vids.some(v => ["attente", "en_cours"].includes(v.statut))) poll();
}
async function ouvrirVideo(uid) {
  const v = VIDS.find(x => x.uid === uid); if (!v) return;
  if (v.statut === "erreur") {
    sheet(`<h1>Erreur<b>.</b></h1><p class="desc">La fabrication a échoué. Tu peux remettre le texte en réserve pour le relancer, ou voir le détail sur GitHub.</p>
      <a class="btn ghost" href="${esc(v.run.html_url)}" target="_blank" rel="noopener" style="text-decoration:none">Voir le détail</a>
      <button class="btn acc" id="re" style="margin-top:10px">Remettre le texte en réserve</button>`);
    $("#re").onclick = () => une("re", async () => { await majTextes(d => { const x = d.find(y => y.uid === uid); if (x) x.statut = "pret"; }, "Texte remis en réserve"); closeSheet(); render(); }, $("#re"));
    return;
  }
  if (!v.rel) return sheet(`<h1>En cours<b>.</b></h1><div class="card"><div class="t1">Fabrication par GitHub</div><div class="bar"><i style="width:${progression(v)}%"></i></div></div>
      <p class="t2" style="white-space:normal">Environ 25 minutes. Tu peux fermer l'appli, la vidéo continue.</p><button class="btn ghost" onclick="closeSheet()">Fermer</button>`);
  const mp4 = v.rel.assets.find(a => a.name === "video.mp4");
  sheet(`<h1>${esc(v.sujet)}<b>.</b></h1><div id="lecteur" class="card empty">Chargement de la vidéo…</div>
    <h2>Description TikTok</h2><div class="card desc">${esc(v.rel.body || "")}</div>
    <button class="btn ghost sm" id="copier">📋 Copier la description</button>
    <div class="card" style="margin-top:12px;font-size:13px;line-height:1.5">Après la publication : réponds aux commentaires « LIVRE » avec le lien du livre 📚</div>
    ${v.statut === "prete" ? `<button class="btn ghost" id="pub">✓ Marquer comme publiée</button>` : `<span class="pill ok">Publiée</span>`}`);
  $("#copier").onclick = () => navigator.clipboard.writeText(v.rel.body || "").then(() => toast("Description copiée"));
  if ($("#pub")) $("#pub").onclick = () => une("pub", async () => { await majTextes(d => { const x = d.find(y => y.uid === uid || (y.publies || []).includes(uid)); if (x) { x.publies = [...new Set([...(x.publies || []), uid])]; if (x.uid === uid) x.statut = "publie"; } }, "Vidéo publiée"); closeSheet(); toast("Bravo 🎉"); render(); }, $("#pub"));
  if (v.pub) {
    const u = urlPub(uid, "video.mp4");
    $("#lecteur").outerHTML = `<video src="${u}" controls playsinline preload="metadata"></video>
      <a class="btn acc" href="${u}" target="_blank" rel="noopener" style="text-decoration:none">⬇ Enregistrer la vidéo</a>
      <p class="t2" style="white-space:normal;margin-top:8px">La vidéo s'ouvre : appuie sur <b>Partager ↑</b> puis <b>« Enregistrer la vidéo »</b> pour la mettre dans Photos.</p>`;
  } else {
    const active = await charge("lecture", lectureActivee);
    $("#lecteur").outerHTML = `${active ? "" : `<div class="card"><div class="t1">Lire les vidéos dans l'appli</div><p class="t2" style="white-space:normal">À activer une seule fois : les prochaines vidéos se liront et s'enregistreront directement ici.</p><button class="btn acc sm" id="activer">Activer</button></div>`}
      <a class="btn ghost" href="${esc(mp4.browser_download_url || v.rel.html_url)}" target="_blank" rel="noopener" style="text-decoration:none">Ouvrir cette vidéo sur GitHub</a>`;
    if ($("#activer")) $("#activer").onclick = () => une("activer", async () => { await activerLecture(); closeSheet(); }, $("#activer"));
  }
}

// ---------------- Profil
async function profil() {
  const cfg = await charge("cfg", async () => (await getJSON("data/config.json")).data);
  app.innerHTML = `<h1>Profil<b>.</b></h1>
    <h2>Comptes ElevenLabs</h2>
    ${cfg.comptes.map(c => `<div class="card" style="${c.actif !== false ? "" : "opacity:.55"}"><div class="row"><div class="grow"><div class="t1">${esc(c.nom)}</div>
      <div class="t2">${c.actif !== false ? "Activé" : "En pause"}</div></div>
      <button class="chip ${c.actif !== false ? "on" : ""} bascule" data-s="${c.secret}">${c.actif !== false ? "Activé" : "Désactivé"}</button>
      <span class="pill err suppr" data-s="${c.secret}">Retirer</span></div></div>`).join("") || `<div class="empty">Aucun compte connecté.</div>`}
    <div class="card"><label>Nom du compte (ex. « Compte de Paul »)</label><input id="cn">
      <label>Clé API ElevenLabs</label><input id="ck" type="password" autocomplete="off"><button class="btn acc sm" id="addc">＋ Ajouter ce compte</button></div>
    <p class="t2" style="white-space:normal">La clé est enregistrée chiffrée dans les secrets GitHub. Quand un compte n'a plus de crédits, l'appli passe au suivant.</p>
    <h2>Voix officielle</h2>
    <div class="card"><label>Nom de la voix</label><input id="vn" value="${esc(cfg.voice_nom)}">
      <label>Voice ID (ElevenLabs → la voix → « ID »)</label><input id="vi" value="${esc(cfg.voice_id)}"><button class="btn acc sm" id="savev">Enregistrer la voix</button></div>
    <h2>Lecture des vidéos</h2>
    <div class="card" id="lect"><div class="t2">Vérification…</div></div>
    <h2>Connexion GitHub</h2>
    <div class="card"><div class="t2">Dépôt : ${esc(OWNER)}/${esc(REPO)}</div><button class="btn ghost sm" id="cle" style="margin-top:10px">Changer la clé GitHub</button>
      <button class="btn ghost sm" id="deco" style="margin-top:10px">Se déconnecter de ce téléphone</button></div>`;
  document.querySelectorAll(".bascule").forEach(b => b.onclick = () => une("cfg", async () => { await majConfig(c => { const x = c.comptes.find(y => y.secret === b.dataset.s); if (x) x.actif = x.actif === false; }, "Compte ElevenLabs activé/désactivé"); profil(); }, b));
  document.querySelectorAll(".suppr").forEach(b => b.onclick = () => une("cfg", async () => {
    if (!confirm("Retirer ce compte ?")) return;
    await gh(`actions/secrets/${b.dataset.s}`, {method: "DELETE"}).catch(() => {});
    await majConfig(c => { c.comptes = c.comptes.filter(y => y.secret !== b.dataset.s); }, "Compte ElevenLabs retiré"); profil();
  }));
  $("#addc").onclick = () => une("cfg", async () => {
    const nom = $("#cn").value.trim(), key = $("#ck").value.trim(); if (!nom || !key) return toast("Nom et clé obligatoires");
    const secret = "EL_" + Math.random().toString(36).slice(2, 10).toUpperCase();
    try { await setSecret(secret, key); await majConfig(c => c.comptes.push({nom, secret, actif: true}), "Compte ElevenLabs ajouté"); toast("Compte ajouté"); profil(); }
    catch (e) { toast(e.message); }
  }, $("#addc"));
  $("#savev").onclick = () => une("cfg", async () => { await majConfig(c => { c.voice_nom = $("#vn").value.trim(); c.voice_id = $("#vi").value.trim(); }, "Voix officielle"); toast("Voix enregistrée"); }, $("#savev"));
  charge("lecture", lectureActivee).then(ok => { const el = $("#lect"); if (!el) return;
    el.innerHTML = ok ? `<div class="t1">✓ Activée</div><div class="t2" style="white-space:normal">Les nouvelles vidéos se lisent et s'enregistrent dans l'appli.</div>`
      : `<div class="t1">Pas encore activée</div><p class="t2" style="white-space:normal">Une fois activée, les nouvelles vidéos se lisent directement dans l'appli.</p><button class="btn acc sm" id="activer2">Activer</button>`;
    if ($("#activer2")) $("#activer2").onclick = () => une("activer", async () => { await activerLecture(); profil(); }, $("#activer2")); });
  $("#cle").onclick = () => reglerCle();
  $("#deco").onclick = () => { if (confirm("Effacer la clé GitHub de ce téléphone ?")) { LSset("tl_token", ""); TOKEN = ""; reglerCle(); } };
}

// ---------------- navigation
function go(t) { tab = t; render(); }
async function render(silencieux) {
  if (!silencieux && !CACHE.textes) app.innerHTML = `<div class="empty" style="padding-top:40vh">Chargement…</div>`;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  if (!TOKEN) return reglerCle();
  try { await ({accueil, textes, videos, profil})[tab](); } catch (e) { if (e.message !== "connexion") toast(e.message); }
}
async function chargerLivres() {
  const {data} = await getJSON("catalogue/livres.json"); livres = data.livres.map(b => ({...b, id: slug(b.titre)}));
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
(async () => { if (TOKEN) { try { await chargerLivres(); } catch (e) {} } render(); })();
