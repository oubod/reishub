(function (root) {
  const ACTIVE = ["uploading", "queued", "processing", "building_pdf", "cancelling"];
  const LABELS = { uploading: "Téléversement", queued: "En attente", processing: "Génération", building_pdf: "Création du PDF", completed: "Terminée", failed: "Échec", cancelling: "Annulation", cancelled: "Annulée" };
  const $ai = () => document.getElementById("ai");
  const h = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let user, jobs = [], timer, poller, channel;

  async function call(action, payload = {}) {
    const { data, error } = await supabaseClient.functions.invoke("mauritania-ai-jobs", { body: { action, ...payload } });
    if (error) throw new Error(data?.error || error.message || "Service IA indisponible.");
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function refresh() {
    const { data, error } = await supabaseClient.from("mauritania_ai_jobs").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    jobs = data || [];
    renderJobs(); renderLibrary();
  }
  function seconds(job) {
    return Math.max(0, Math.round((Date.now() - new Date(job.started_at || job.created_at).getTime()) / 1000));
  }
  function duration(value) {
    const m = Math.floor(value / 60), s = value % 60;
    return m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
  }
  function jobCard(job) {
    const elapsed = seconds(job), estimate = job.estimated_seconds || job.question_count * 10;
    const remaining = Math.max(0, Math.round(estimate * (1 - (job.progress || 0) / 100)));
    const active = ACTIVE.includes(job.status);
    return `<article class="ai-job" data-job="${h(job.id)}"><div class="ai-job-head"><div><span class="ai-status ${h(job.status)}">${LABELS[job.status] || h(job.status)}</span><h3>${h(job.title || job.source_name)}</h3><p>${job.question_count} questions · ${h(job.question_type?.toUpperCase())} · ${h(job.specialty || "Toutes spécialités")}</p></div><strong>${job.progress || 0} %</strong></div><div class="ai-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${job.progress || 0}"><span style="width:${job.progress || 0}%"></span></div><div class="ai-job-meta"><span>Étape : ${h(job.stage || LABELS[job.status])}</span><span class="ai-clock">Écoulé ${duration(elapsed)}${active ? ` · restant ≈ ${duration(remaining)}` : ""}</span>${job.input_tokens || job.output_tokens ? `<span>${job.input_tokens || 0} jetons d’entrée · ${job.output_tokens || 0} de sortie</span>` : ""}</div>${job.status === "queued" ? `<p class="ai-safe">✓ Le PDF est transmis : vous pouvez fermer l’application.</p>` : ""}${job.error_message ? `<p class="ai-error">${h(job.error_message)}</p>` : ""}<div class="ai-actions">${active ? `<button class="btn" onclick="ResiAiJobs.cancel('${job.id}')">Annuler</button>` : ""}${job.status === "failed" ? `<button class="btn" onclick="ResiAiJobs.retry('${job.id}')">Réessayer</button>` : ""}</div></article>`;
  }
  function renderJobs() {
    const target = document.getElementById("aiJobs"); if (!target) return;
    const active = jobs.filter((j) => ACTIVE.includes(j.status) || j.status === "failed");
    target.innerHTML = active.length ? active.map(jobCard).join("") : `<div class="ai-empty">Aucune génération en cours.</div>`;
  }
  function completed() {
    const q = (document.getElementById("aiSearch")?.value || "").toLowerCase();
    return jobs.filter((j) => j.status === "completed" && (!q || `${j.title} ${j.specialty}`.toLowerCase().includes(q)));
  }
  function renderLibrary() {
    const target = document.getElementById("aiLibrary"); if (!target) return;
    const list = completed();
    target.innerHTML = list.length ? list.map((job) => `<article class="ai-exam"><label><input class="ai-pack" type="checkbox" value="${h(job.id)}"> <span><strong>${h(job.title)}</strong><small>${job.question_count} questions · ${new Date(job.completed_at).toLocaleDateString("fr-FR")}${job.pdf_expires_at ? ` · PDF disponible jusqu’au ${new Date(job.pdf_expires_at).toLocaleDateString("fr-FR")}` : ""}</small></span></label><div class="ai-actions"><button class="btn primary" onclick="ResiAiJobs.solve('${job.id}')">S’entraîner</button><button class="icon-btn" title="Télécharger le PDF" onclick="ResiAiJobs.pdf('${job.id}')"><span class="icon">picture_as_pdf</span></button><button class="icon-btn" title="Exporter le JSON" onclick="ResiAiJobs.json('${job.id}')"><span class="icon">download</span></button><button class="icon-btn" title="Renommer" onclick="ResiAiJobs.rename('${job.id}')"><span class="icon">edit</span></button><button class="icon-btn danger" title="Supprimer" onclick="ResiAiJobs.remove('${job.id}')"><span class="icon">delete</span></button></div></article>`).join("") : `<div class="ai-empty">Aucune épreuve enregistrée.</div>`;
    [...target.querySelectorAll(".ai-exam")].forEach((card, index) => { const button = document.createElement("button"); button.className = "btn"; button.textContent = "Simulation"; button.onclick = () => startSession(list[index].id, "simulation"); card.querySelector(".ai-actions").insertBefore(button, card.querySelector(".ai-actions").children[1]); });
  }
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget, file = form.pdf.files[0], key = form.api_key.value.trim(), status = document.getElementById("aiCreateStatus");
    try {
      if (!file || file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) throw new Error("Sélectionnez un fichier PDF.");
      if (file.size > 20 * 1024 * 1024) throw new Error("Le PDF dépasse 20 Mo.");
      const pendingKey = `resihub:ai-upload:${user.id}`;
      let pending; try { pending = JSON.parse(localStorage.getItem(pendingKey) || "null"); } catch (_) { pending = null; }
      if (!key && !pending) throw new Error("Saisissez votre clé API Gemini.");
      status.textContent = "Préparation du téléversement…";
      const resumable = pending && pending.sourceName === file.name && pending.sourceSize === file.size && jobs.some((j) => j.id === pending.jobId && j.status === "uploading");
      const created = resumable ? await call("resume-upload", { jobId: pending.jobId }) : await call("create", { sourceName: file.name, sourceSize: file.size, title: form.title.value.trim(), specialty: form.specialty.value.trim(), questionCount: Number(form.question_count.value), questionType: form.question_type.value, apiKey: key });
      localStorage.setItem(pendingKey, JSON.stringify({ jobId: created.jobId, sourceName: file.name, sourceSize: file.size }));
      if (form.remember.checked && key) localStorage.setItem(`resihub:gemini:${user.id}`, key); else if (!form.remember.checked) localStorage.removeItem(`resihub:gemini:${user.id}`);
      await upload(file, created, (pct) => { status.textContent = `Téléversement : ${pct} % — gardez l’application ouverte.`; });
      await call("enqueue", { jobId: created.jobId });
      localStorage.removeItem(pendingKey);
      status.textContent = "En attente — vous pouvez fermer l’application en toute sécurité.";
      form.pdf.value = ""; await refresh();
    } catch (error) { status.textContent = error.message; }
  }
  function upload(file, created, progress) {
    return new Promise(async (resolve, reject) => {
      const { data } = await supabaseClient.auth.getSession();
      const task = new tus.Upload(file, { endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`, retryDelays: [0, 3000, 5000, 10000, 20000], headers: { authorization: `Bearer ${data.session.access_token}`, "x-signature": created.uploadToken }, uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: 6 * 1024 * 1024, metadata: { bucketName: "mauritania-ai-inputs", objectName: created.inputPath, contentType: "application/pdf", cacheControl: "3600" }, onError: reject, onProgress: (sent, total) => progress(Math.round(sent / total * 100)), onSuccess: resolve });
      const old = await task.findPreviousUploads(); if (old[0]) task.resumeFromPreviousUpload(old[0]); task.start();
    });
  }
  function downloadBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function quiz(job) { return job.result?.quiz || job.result || {}; }
  async function localPdf(selected) {
    const definitions = selected.map((j) => quiz(j));
    pdfMake.createPdf(ResiAiPdf.buildPdfDefinition(definitions, selected.length > 1 ? "Recueil de mes épreuves" : undefined)).download(selected.length > 1 ? "resihub-recueil.pdf" : `${selected[0].title}.pdf`);
  }
  async function open(currentUser) {
    user = currentUser; clearInterval(timer); clearInterval(poller); if (channel) supabaseClient.removeChannel(channel);
    $ai().innerHTML = `<main class="ai-native"><header class="ai-hero"><div><p class="kicker">RésiHub Medical AI</p><h2>Créer une épreuve depuis un PDF</h2><p>Les questions sont produites uniquement à partir du document transmis. Le contenu médical doit toujours être vérifié.</p></div><span class="ai-durable">Traitement durable</span></header><section class="ai-grid"><article class="ai-panel"><h2>Nouvelle génération</h2><form id="aiCreate"><label>Titre<input name="title" maxlength="100" placeholder="Ex. Cardiologie — insuffisance cardiaque"></label><label>PDF source<input name="pdf" type="file" accept="application/pdf" required><small>PDF uniquement, 20 Mo maximum.</small></label><div class="ai-fields"><label>Questions<select name="question_count"><option>15</option><option>30</option><option>45</option></select></label><label>Format<select name="question_type"><option value="qru">QRU</option><option value="qrm">QRM</option><option value="mixed">Mixte</option></select></label></div><label>Spécialité<input name="specialty" maxlength="80" placeholder="Toutes spécialités"></label><label>Clé API Gemini<input name="api_key" type="password" autocomplete="off" required></label><label class="ai-check"><input name="remember" type="checkbox"> Mémoriser sur cet appareil</label><button class="btn primary wide" type="submit">Générer l’épreuve</button><p id="aiCreateStatus" class="ai-form-status" aria-live="polite"></p></form></article><article class="ai-panel ai-running"><div class="ai-section-title"><div><h2>Générations en cours</h2><p>Durée restante approximative, ajustée pendant le traitement.</p></div></div><div id="aiJobs"></div></article></section><section class="ai-panel ai-vault"><div class="ai-section-title"><div><h2>Mes épreuves</h2><p>Conservées jusqu’à leur suppression. Les PDF expirent après 30 jours.</p></div><div class="ai-toolbar"><input id="aiSearch" type="search" placeholder="Rechercher" oninput="ResiAiJobs.filter()"><label class="btn">Importer JSON<input id="aiImport" type="file" accept="application/json" hidden onchange="ResiAiJobs.importJson(this)"></label><button class="btn" onclick="ResiAiJobs.pack()">PDF groupé</button></div></div><div id="aiLibrary"></div></section></main>`;
    const pdfInput = document.querySelector("#aiCreate [name=pdf]");
    pdfInput.hidden = true;
    const pdfPicker = document.createElement("span");
    pdfPicker.className = "ai-file-picker"; pdfPicker.tabIndex = 0; pdfPicker.setAttribute("role", "button");
    pdfPicker.innerHTML = `<span>Aucun fichier choisi</span><strong>Choisir un PDF</strong>`;
    pdfPicker.onclick = () => pdfInput.click(); pdfPicker.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") pdfInput.click(); };
    pdfInput.before(pdfPicker); pdfInput.onchange = () => { pdfPicker.firstElementChild.textContent = pdfInput.files[0]?.name || "Aucun fichier choisi"; };
    document.getElementById("aiCreate").addEventListener("submit", submit);
    const remembered = localStorage.getItem(`resihub:gemini:${user.id}`); if (remembered) { document.querySelector("[name=api_key]").value = remembered; document.querySelector("[name=remember]").checked = true; }
    await refresh();
    channel = supabaseClient.channel(`ai-jobs-${user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "mauritania_ai_jobs", filter: `user_id=eq.${user.id}` }, refresh).subscribe();
    poller = setInterval(refresh, 10000); timer = setInterval(renderJobs, 1000);
  }
  function startSession(id, mode = "training") {
    const j = jobs.find((x) => x.id === id), list = quiz(j).questions || [];
    state.session = { item: { id, title: j.title }, questions: list.map((q, i) => ({ id: q.id || `ia-${i}`, question: q.question || q.stem, options: Object.entries(q.options || {}).map(([key, text]) => ({ id: key, text, correct: (q.correct_answers || []).includes(key) })), explanation: q.explanation })), index: 0, selected: new Set(), checked: false, score: 0, origin: "ai", mode };
    renderQuestion(); go("quizRunner");
  }
  root.ResiAiJobs = { open, filter: renderLibrary, cancel: async (id) => { await call("cancel", { jobId: id }); refresh(); }, retry: async (id) => { const apiKey = prompt("Clé API Gemini pour la nouvelle tentative"); if (apiKey) { await call("retry", { jobId: id, apiKey }); refresh(); } }, rename: async (id) => { const title = prompt("Nouveau nom"); if (title?.trim()) { await call("rename", { jobId: id, title: title.trim() }); refresh(); } }, remove: async (id) => { if (confirm("Supprimer définitivement cette épreuve ?")) { await call("delete", { jobId: id }); refresh(); } }, solve: (id) => { const j = jobs.find((x) => x.id === id), list = quiz(j).questions || []; state.session = { item: { id, title: j.title }, questions: list.map((q, i) => ({ id: q.id || `ia-${i}`, question: q.question || q.stem, options: Object.entries(q.options || {}).map(([key, text]) => ({ id: key, text, correct: (q.correct_answers || []).includes(key) })), explanation: q.explanation })), index: 0, selected: new Set(), checked: false, score: 0, origin: "ai" }; renderQuestion(); go("quizRunner"); }, pdf: async (id) => { const j = jobs.find((x) => x.id === id); try { const { url } = await call("download", { jobId: id }); location.href = url; } catch (_) { localPdf([j]); } }, json: (id) => { const j = jobs.find((x) => x.id === id); downloadBlob(new Blob([JSON.stringify(quiz(j), null, 2)], { type: "application/json" }), `${j.title}.json`); }, pack: () => { const ids = [...document.querySelectorAll(".ai-pack:checked")].map((n) => n.value), selected = jobs.filter((j) => ids.includes(j.id)); if (selected.length) localPdf(selected); else alert("Sélectionnez au moins une épreuve."); }, importJson: async (input) => { try { const body = JSON.parse(await input.files[0].text()); await call("import", { quiz: body }); await refresh(); } catch (e) { alert(e.message); } input.value = ""; } };
  root.ResiAiJobs.solve = (id) => startSession(id, "training");
  root.ResiAiJobs.simulate = (id) => startSession(id, "simulation");
})(window);
