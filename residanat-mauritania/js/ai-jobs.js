(function (root) {
  "use strict";

  const ACTIVE = ["queued", "processing", "cancelling"];
  const LABELS = { queued: "En attente", processing: "Génération", completed: "Terminée", failed: "À recommencer", cancelling: "Annulation", cancelled: "Annulée" };
  const DB_NAME = "resihub-medical-ai";
  const STORE = "exams";
  const MAX_SOURCE_CHARS = 175000;
  const localExams = new Map();
  const $ai = () => document.getElementById("ai");
  const h = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const errorText = () => "La demande n’a pas abouti. Vérifiez votre connexion puis réessayez.";
  let user, jobs = [], poller, timer, channel, refreshPending, syncPending;

  async function call(action, payload = {}) {
    const { data, error } = await supabaseClient.functions.invoke("mauritania-ai-jobs", { body: { action, ...payload } });
    if (error) throw new Error(data?.error || error.message || "Service IA indisponible.");
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbRequest(mode, operation) {
    const database = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const request = operation(transaction.objectStore(STORE));
        let result;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }

  async function loadLocalExams() {
    localExams.clear();
    const records = await dbRequest("readonly", (store) => store.getAll()).catch(() => []);
    records.filter((record) => record.userId === user.id).forEach((record) => localExams.set(record.jobId, record));
  }

  const putLocal = (record) => dbRequest("readwrite", (store) => store.put(record));
  const deleteLocal = (jobId) => dbRequest("readwrite", (store) => store.delete(`${user.id}:${jobId}`));

  function createPdfBlob(quiz) {
    return new Promise((resolve, reject) => {
      try { pdfMake.createPdf(ResiAiPdf.buildPdfDefinition([quiz])).getBlob(resolve); }
      catch (error) { reject(error); }
    });
  }

  async function saveLocal(job, quiz) {
    const storedQuiz = { ...quiz, title: job.title, source_name: job.source_name, specialty: job.specialty };
    const record = { id: `${user.id}:${job.id}`, userId: user.id, jobId: job.id, quiz: storedQuiz, pdf: await createPdfBlob(storedQuiz), savedAt: new Date().toISOString() };
    await putLocal(record);
    localExams.set(job.id, record);
    return record;
  }

  async function localizeCompleted() {
    for (const job of jobs.filter((item) => item.status === "completed" && item.result?.quiz)) {
      try {
        if (!localExams.has(job.id)) await saveLocal(job, job.result.quiz);
        await call("ack-local", { jobId: job.id });
        job.result = null;
        job.result_localized_at = new Date().toISOString();
      } catch (_) { /* The server copy remains available for the next attempt. */ }
    }
  }

  async function refresh() {
    if (refreshPending) return refreshPending;
    refreshPending = (async () => {
      const { data, error } = await supabaseClient.from("mauritania_ai_jobs").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      jobs = data || [];
      await localizeCompleted();
      renderJobs();
      renderLibrary();
    })();
    try { return await refreshPending; } finally { refreshPending = null; }
  }

  async function syncAndRefresh() {
    if (syncPending) return syncPending;
    syncPending = (async () => { await call("sync").catch(() => {}); await refresh(); })();
    try { return await syncPending; } finally { syncPending = null; }
  }

  function relativeTime(job) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(job.started_at || job.created_at).getTime()) / 1000));
    if (seconds < 60) return "À l’instant";
    const minutes = Math.floor(seconds / 60);
    return `Depuis ${minutes} min`;
  }

  function jobCard(job) {
    const active = ACTIVE.includes(job.status);
    const message = job.status === "failed" ? "La génération n’a pas abouti. Sélectionnez à nouveau le PDF pour recommencer." : active ? "Vous pouvez fermer l’application. La génération continuera." : "";
    return `<article class="ai-job ai-job-simple" data-job="${h(job.id)}"><div class="ai-job-head"><div><span class="ai-status ${h(job.status)}">${LABELS[job.status] || h(job.status)}</span><h3>${h(job.title || job.source_name)}</h3><p>${job.question_count} questions · ${h(job.question_type?.toUpperCase())}</p></div>${active ? `<span class="ai-pulse" aria-hidden="true"></span>` : ""}</div><p class="ai-job-message">${h(message)}</p><div class="ai-job-foot"><span class="ai-clock">${relativeTime(job)}</span><div class="ai-actions">${active ? `<button class="btn" onclick="ResiAiJobs.cancel('${job.id}')">Annuler</button>` : ""}${job.status === "failed" ? `<button class="btn primary" onclick="ResiAiJobs.retry('${job.id}')">Recommencer</button>` : ""}${!active ? `<button class="btn" onclick="ResiAiJobs.remove('${job.id}')">Supprimer</button>` : ""}</div></div></article>`;
  }

  function renderJobs() {
    const target = document.getElementById("aiJobs");
    const section = document.getElementById("aiRunningSection");
    if (!target || !section) return;
    const visible = jobs.filter((job) => ACTIVE.includes(job.status) || job.status === "failed");
    section.hidden = !visible.length;
    target.innerHTML = visible.map(jobCard).join("");
  }

  function quiz(job) {
    return localExams.get(job.id)?.quiz || job.result?.quiz || job.result || null;
  }

  function completed() {
    const search = (document.getElementById("aiSearch")?.value || "").toLocaleLowerCase("fr");
    return jobs.filter((job) => job.status === "completed" && (!search || `${job.title} ${job.specialty}`.toLocaleLowerCase("fr").includes(search)));
  }

  function renderLibrary() {
    const target = document.getElementById("aiLibrary");
    if (!target) return;
    const list = completed();
    target.innerHTML = list.length ? list.map((job) => {
      const available = !!quiz(job);
      return `<article class="ai-exam"><label><input class="ai-pack" type="checkbox" value="${h(job.id)}" ${available ? "" : "disabled"}><span><strong>${h(job.title)}</strong><small>${job.question_count} questions · ${available ? "Enregistrée sur cet appareil" : "Disponible sur l’appareil d’origine"}</small></span></label><div class="ai-actions">${available ? `<button class="btn primary" onclick="ResiAiJobs.solve('${job.id}')">S’entraîner</button><button class="btn" onclick="ResiAiJobs.pdf('${job.id}')">PDF</button><button class="btn" onclick="ResiAiJobs.json('${job.id}')">JSON</button>` : job.output_path ? `<button class="btn" onclick="ResiAiJobs.pdf('${job.id}')">PDF</button>` : ""}<button class="icon-btn" title="Renommer" onclick="ResiAiJobs.rename('${job.id}')"><span class="icon">edit</span></button><button class="icon-btn danger" title="Supprimer" onclick="ResiAiJobs.remove('${job.id}')"><span class="icon">delete</span></button></div></article>`;
    }).join("") : `<div class="ai-empty">Vos épreuves terminées apparaîtront ici.</div>`;
  }

  function compactPages(pages) {
    const readable = pages.filter((page) => page.text.trim());
    const full = readable.map((page) => `--- PAGE ${page.number} ---\n${page.text}`).join("\n\n");
    if (full.length <= MAX_SOURCE_CHARS) return full;
    const allowance = Math.max(200, Math.floor((MAX_SOURCE_CHARS - readable.length * 24) / readable.length));
    return readable.map((page) => `--- PAGE ${page.number} ---\n${page.text.slice(0, allowance)}`).join("\n\n").slice(0, MAX_SOURCE_CHARS);
  }

  async function extractPdf(file, status) {
    if (!root.pdfjsLib) throw new Error("Lecteur PDF indisponible.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendors/pdf.worker.min.js";
    const documentTask = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await documentTask.promise;
    const pages = [];
    try {
      for (let number = 1; number <= pdf.numPages; number += 1) {
        status.textContent = `Lecture du PDF · page ${number} sur ${pdf.numPages}`;
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        const text = content.items.map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`).join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        pages.push({ number, text });
        page.cleanup();
      }
    } finally { await pdf.destroy(); }
    const result = compactPages(pages);
    if (result.length < 600) throw new Error("Ce PDF semble numérisé et ne contient pas assez de texte lisible.");
    return result;
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.pdf.files[0];
    const status = document.getElementById("aiCreateStatus");
    const button = form.querySelector("button[type=submit]");
    try {
      if (!file || file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) throw new Error("Sélectionnez un fichier PDF.");
      if (file.size > 20 * 1024 * 1024) throw new Error("Le PDF dépasse 20 Mo.");
      button.disabled = true;
      const sourceText = await extractPdf(file, status);
      status.textContent = "Envoi sécurisé à Replicate…";
      await call("create", { sourceName: file.name, sourceSize: file.size, sourceText, title: form.title.value.trim(), specialty: form.specialty.value.trim(), questionCount: Number(form.question_count.value), questionType: form.question_type.value });
      status.textContent = "En attente · vous pouvez fermer l’application.";
      form.pdf.value = "";
      const picker = form.querySelector(".ai-file-picker span");
      if (picker) picker.textContent = "Aucun fichier choisi";
      await refresh();
    } catch (error) {
      status.textContent = /numérisé|Sélectionnez|20 Mo/.test(error.message) ? error.message : errorText();
    } finally { button.disabled = false; }
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = String(name || "epreuve").replace(/[\\/:*?"<>|]/g, "-");
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function localPdf(selected) {
    if (selected.length === 1) {
      const stored = localExams.get(selected[0].id);
      if (stored?.pdf) return downloadBlob(stored.pdf, `${selected[0].title}.pdf`);
    }
    const definitions = selected.map(quiz).filter(Boolean);
    pdfMake.createPdf(ResiAiPdf.buildPdfDefinition(definitions, selected.length > 1 ? "Recueil de mes épreuves" : undefined)).download(selected.length > 1 ? "resihub-recueil.pdf" : `${selected[0].title}.pdf`);
  }

  function questionOptions(question) {
    if (Array.isArray(question.options)) return question.options.map((option, index) => ({ id: option.id || String.fromCharCode(65 + index), text: option.text || option, correct: option.correct === true }));
    const correct = question.correct_answers || [];
    return Object.entries(question.options || {}).map(([id, text]) => ({ id, text, correct: correct.includes(id) }));
  }

  function startSession(id, mode = "training") {
    const job = jobs.find((item) => item.id === id);
    const questions = quiz(job)?.questions || [];
    if (!questions.length) return alert("Cette épreuve n’est pas enregistrée sur cet appareil.");
    state.session = { item: { id, title: job.title }, questions: questions.map((question, index) => ({ id: question.id || `ia-${index}`, question: question.question || question.stem, options: questionOptions(question), explanation: question.explanation })), index: 0, selected: new Set(), checked: false, score: 0, origin: "ai", mode };
    renderQuestion();
    go("quizRunner");
  }

  async function open(currentUser) {
    user = currentUser;
    clearInterval(timer);
    clearInterval(poller);
    if (channel) supabaseClient.removeChannel(channel);
    $ai().innerHTML = `<main class="ai-native ai-simple"><header class="ai-hero"><div><p class="kicker">RésiHub Medical AI</p><h2>Créer une épreuve depuis un PDF</h2><p>Le PDF reste sur votre appareil. La génération continue même si vous fermez l’application.</p></div><span class="ai-durable">Propulsé par Replicate</span></header><section class="ai-panel ai-create-card"><div class="ai-section-title"><div><h2>Nouvelle épreuve</h2><p>Choisissez le document et le format souhaité.</p></div></div><form id="aiCreate"><label>PDF source<input name="pdf" type="file" accept="application/pdf" required><small>PDF avec texte sélectionnable · 20 Mo maximum.</small></label><div class="ai-fields"><label>Questions<select name="question_count"><option>15</option><option>30</option><option>45</option></select></label><label>Format<select name="question_type"><option value="qru">QRU</option><option value="qrm">QRM</option><option value="mixed">Mixte</option></select></label></div><details class="ai-advanced"><summary>Options facultatives</summary><label>Titre<input name="title" maxlength="100" placeholder="Ex. Insuffisance cardiaque"></label><label>Spécialité<input name="specialty" maxlength="80" placeholder="Toutes spécialités"></label></details><button class="btn primary wide" type="submit">Créer l’épreuve</button><p id="aiCreateStatus" class="ai-form-status" aria-live="polite"></p></form><p class="ai-private"><span class="icon">lock</span> Le document n’est pas conservé sur RésiHub. Seul son texte est transmis temporairement à Replicate.</p></section><section class="ai-panel ai-running" id="aiRunningSection" hidden><div class="ai-section-title"><div><h2>En cours</h2><p>Vous pouvez quitter cette page.</p></div></div><div id="aiJobs"></div></section><section class="ai-panel ai-vault"><div class="ai-section-title"><div><h2>Mes épreuves</h2><p>Enregistrées uniquement sur cet appareil.</p></div><div class="ai-toolbar"><input id="aiSearch" type="search" placeholder="Rechercher" oninput="ResiAiJobs.filter()"><label class="btn">Importer<input id="aiImport" type="file" accept="application/json" hidden onchange="ResiAiJobs.importJson(this)"></label><button class="btn" onclick="ResiAiJobs.pack()">PDF groupé</button></div></div><div id="aiLibrary"></div></section></main>`;

    const form = document.getElementById("aiCreate");
    const pdfInput = form.pdf;
    pdfInput.hidden = true;
    const picker = document.createElement("span");
    picker.className = "ai-file-picker";
    picker.tabIndex = 0;
    picker.setAttribute("role", "button");
    picker.innerHTML = `<span>Aucun fichier choisi</span><strong>Choisir un PDF</strong>`;
    picker.onclick = () => pdfInput.click();
    picker.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") pdfInput.click(); };
    pdfInput.before(picker);
    pdfInput.onchange = () => { picker.firstElementChild.textContent = pdfInput.files[0]?.name || "Aucun fichier choisi"; };
    form.addEventListener("submit", submit);

    await loadLocalExams();
    await syncAndRefresh();
    channel = supabaseClient.channel(`ai-jobs-${user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "mauritania_ai_jobs", filter: `user_id=eq.${user.id}` }, refresh).subscribe();
    poller = setInterval(syncAndRefresh, 15000);
    timer = setInterval(() => document.querySelectorAll(".ai-job[data-job]").forEach((card) => { const job = jobs.find((item) => item.id === card.dataset.job); const clock = card.querySelector(".ai-clock"); if (job && clock) clock.textContent = relativeTime(job); }), 30000);
  }

  root.ResiAiJobs = {
    open,
    filter: renderLibrary,
    cancel: async (id) => { const job = jobs.find((item) => item.id === id); if (job) { job.status = "cancelling"; renderJobs(); } try { await call("cancel", { jobId: id }); await refresh(); } catch (_) { await refresh(); alert(errorText()); } },
    retry: (id) => { const job = jobs.find((item) => item.id === id); const form = document.getElementById("aiCreate"); if (!job || !form) return; form.title.value = job.title; form.specialty.value = job.specialty || ""; form.question_count.value = job.question_count; form.question_type.value = job.question_type; form.pdf.click(); form.scrollIntoView({ behavior: "smooth", block: "start" }); },
    rename: async (id) => { const job = jobs.find((item) => item.id === id); const title = prompt("Nouveau nom", job?.title || ""); if (!title?.trim()) return; try { await call("rename", { jobId: id, title: title.trim() }); const stored = localExams.get(id); if (stored) await saveLocal({ ...job, title: title.trim() }, stored.quiz); await refresh(); } catch (_) { alert(errorText()); } },
    remove: async (id) => { if (!confirm("Supprimer définitivement cette épreuve de cet appareil ?")) return; try { await call("delete", { jobId: id }); await deleteLocal(id); localExams.delete(id); await refresh(); } catch (_) { alert(errorText()); } },
    solve: (id) => startSession(id, "training"),
    simulate: (id) => startSession(id, "simulation"),
    pdf: async (id) => { const job = jobs.find((item) => item.id === id); if (quiz(job)) return localPdf([job]); try { const { url } = await call("download", { jobId: id }); location.href = url; } catch (_) { alert("Ce PDF n’est pas disponible sur cet appareil."); } },
    json: (id) => { const job = jobs.find((item) => item.id === id); const body = quiz(job); if (body) downloadBlob(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }), `${job.title}.json`); },
    pack: () => { const ids = [...document.querySelectorAll(".ai-pack:checked")].map((input) => input.value); const selected = jobs.filter((job) => ids.includes(job.id) && quiz(job)); if (selected.length) localPdf(selected); else alert("Sélectionnez au moins une épreuve."); },
    importJson: async (input) => { try { const body = JSON.parse(await input.files[0].text()); await call("import", { quiz: body }); await refresh(); } catch (_) { alert("Le fichier JSON n’est pas valide."); } input.value = ""; },
  };

  document.addEventListener("visibilitychange", () => { if (user && document.visibilityState === "visible") syncAndRefresh(); });
  root.addEventListener("online", () => { if (user) syncAndRefresh(); });
})(window);
