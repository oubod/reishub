const EXAM_MINUTES = 90;
const EXAM_PER_CATEGORY = 20;
let examTimer = null;

function authUser() {
  if (isGuestMode() || !window.portalAuthUser?.id) {
    alert("Cette fonctionnalité est réservée aux comptes approuvés.");
    return null;
  }
  return window.portalAuthUser;
}

async function waitForAuth() {
  try { await window.portalAuthReady; } catch (_) {}
  return authUser();
}

function examStorageKey(userId) { return `resihub:mauritania:exam:${userId}`; }
function geminiKeyName(userId) { return `resihub:mauritania:gemini-key:${userId}`; }
function saveExam() {
  const user = window.portalAuthUser;
  if (user?.id && state.exam) localStorage.setItem(examStorageKey(user.id), JSON.stringify(state.exam));
}
function loadExam(userId) {
  try { return JSON.parse(localStorage.getItem(examStorageKey(userId)) || "null"); } catch (_) { return null; }
}

async function openExamView() {
  const user = await waitForAuth();
  if (!user) return go("home");
  state.exam = loadExam(user.id);
  if (state.exam?.status === "active" && Date.now() >= state.exam.deadline) finishExam(true);
  else renderExam();
}

function renderExam() {
  clearInterval(examTimer);
  const exam = state.exam;
  if (!exam) {
    $("exam").innerHTML = `<div class="tool-hero"><span class="feature-icon">${icon("assignment")}</span><div><p class="kicker">Simulation complète</p><h2>Examen aléatoire</h2><p>60 QCM équilibrés : 20 fondamentaux, 20 médicaux et 20 chirurgicaux. Durée : 90 minutes.</p></div></div><button class="btn primary wide" type="button" onclick="startRandomExam()">${icon("play_arrow")}Générer mon examen</button>`;
    return;
  }
  if (exam.status === "finished") return renderExamResult();
  const q = exam.questions[exam.index];
  const selected = exam.answers[q.examId] || [];
  $("exam").innerHTML = `<div class="exam-toolbar"><button class="btn" type="button" onclick="go('home')">${icon("close")}Quitter</button><strong id="examClock" class="timer"></strong><button class="btn danger" type="button" onclick="finishExam(false)">Terminer</button></div><div class="panel"><div class="panel-head"><span class="count">Question ${exam.index + 1}/60</span><span class="count">${esc(q.category)}</span></div><div class="quiz-card"><p class="quiz-meta">${esc(q.lectureTitle)}</p><div class="question">${esc(q.question)}</div><div class="options">${q.options.map((opt) => `<button class="option${selected.includes(opt.id) ? " selected" : ""}" type="button" onclick="toggleExamOption('${esc(opt.id)}')"><span class="letter">${esc(opt.id)}</span><span>${esc(opt.text)}</span></button>`).join("")}</div><div class="exam-nav"><button class="btn" type="button" onclick="moveExam(-1)" ${exam.index === 0 ? "disabled" : ""}>${icon("arrow_back")}Précédent</button><span>${Object.values(exam.answers).filter((a) => a.length).length}/60 répondues</span><button class="btn primary" type="button" onclick="moveExam(1)">${exam.index === 59 ? "Revoir" : "Suivant"}${icon("arrow_forward")}</button></div></div></div>`;
  updateExamClock();
  examTimer = setInterval(updateExamClock, 1000);
}

function updateExamClock() {
  if (!state.exam || state.exam.status !== "active") return clearInterval(examTimer);
  const left = Math.max(0, state.exam.deadline - Date.now());
  const clock = $("examClock");
  if (clock) clock.textContent = `${String(Math.floor(left / 60000)).padStart(2, "0")}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  if (!left) finishExam(true);
}

async function startRandomExam() {
  const user = await waitForAuth();
  if (!user) return;
  $("exam").innerHTML = `<div class="panel"><div class="empty"><strong>Préparation de 60 QCM…</strong><p>Chargement équilibré des trois matières.</p></div></div>`;
  try {
    const questions = [];
    for (const [category, allItems] of categoryGroups()) {
      const candidates = ResiStudyTools.shuffle(allItems.filter((item) => item.training));
      const picked = [];
      while (picked.length < EXAM_PER_CATEGORY && candidates.length) {
        const batch = candidates.splice(0, Math.min(8, candidates.length));
        const results = await Promise.allSettled(batch.map(async (item) => {
          const list = normalizeQuestions(await readJson(item.training));
          if (!list.length) throw new Error("Quiz vide");
          const question = ResiStudyTools.shuffle(list)[0];
          return { ...question, examId: `${item.id}:${question.id}`, lectureId: item.id, lectureTitle: item.title, category };
        }));
        results.forEach((result) => { if (result.status === "fulfilled" && picked.length < EXAM_PER_CATEGORY) picked.push(result.value); });
      }
      if (picked.length !== EXAM_PER_CATEGORY) throw new Error(`Seulement ${picked.length}/20 QCM disponibles pour ${category}.`);
      questions.push(...picked);
    }
    if (questions.length !== 60) throw new Error("Les 60 QCM ne sont pas disponibles.");
    state.exam = { status: "active", ownerId: user.id, createdAt: Date.now(), deadline: Date.now() + EXAM_MINUTES * 60000, index: 0, answers: {}, questions: ResiStudyTools.shuffle(questions) };
    saveExam();
    renderExam();
  } catch (error) {
    $("exam").innerHTML = `<div class="notice error"><strong>Examen non généré.</strong><p>${esc(error.message)}</p><button class="btn" type="button" onclick="openExamView()">Réessayer</button></div>`;
  }
}

function toggleExamOption(id) {
  const exam = state.exam;
  const q = exam.questions[exam.index];
  const selected = new Set(exam.answers[q.examId] || []);
  selected.has(id) ? selected.delete(id) : selected.add(id);
  exam.answers[q.examId] = [...selected];
  saveExam();
  renderExam();
}
function moveExam(delta) {
  state.exam.index = Math.min(59, Math.max(0, state.exam.index + delta));
  saveExam(); renderExam();
}
function finishExam(expired) {
  if (!state.exam || state.exam.status !== "active") return;
  if (!expired && !confirm("Terminer et corriger cet examen ?")) return;
  state.exam.status = "finished";
  state.exam.finishedAt = Date.now();
  state.exam.expired = expired;
  state.exam.result = ResiStudyTools.scoreExam(state.exam.questions, state.exam.answers);
  saveExam(); renderExamResult();
}
function renderExamResult() {
  clearInterval(examTimer);
  const exam = state.exam;
  const result = exam.result || ResiStudyTools.scoreExam(exam.questions, exam.answers);
  $("exam").innerHTML = `<div class="result-summary"><p class="kicker">${exam.expired ? "Temps écoulé" : "Examen terminé"}</p><h2>${result.score}/60</h2><p>${Math.round(result.score / 60 * 100)} % · ${result.unanswered} sans réponse</p><div class="breakdown">${Object.entries(result.categories).map(([name, value]) => `<span><strong>${value.score}/${value.total}</strong>${esc(name)}</span>`).join("")}</div><button class="btn primary" type="button" onclick="newExam()">${icon("refresh")}Nouvel examen</button></div><div class="review-list">${exam.questions.map((q, i) => { const selected = exam.answers[q.examId] || []; const correct = q.options.filter((o) => o.correct).map((o) => o.id); return `<details class="review"><summary><span>${i + 1}. ${esc(q.question)}</span><strong class="${ResiStudyTools.exactAnswer(q, selected) ? "ok" : "bad"}">${ResiStudyTools.exactAnswer(q, selected) ? "Juste" : "À revoir"}</strong></summary><p>Votre réponse : ${selected.length ? esc(selected.join(", ")) : "Aucune"}</p><p><strong>Correction : ${esc(correct.join(", "))}</strong></p>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ""}</details>`; }).join("")}</div>`;
}
function newExam() {
  const user = authUser(); if (!user) return;
  localStorage.removeItem(examStorageKey(user.id)); state.exam = null; renderExam();
}

function openQuizDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("resihub-mauritania-local", 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains("aiQuizSets")) db.createObjectStore("aiQuizSets", { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbAction(mode, value) {
  const db = await openQuizDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("aiQuizSets", mode === "getAll" ? "readonly" : "readwrite");
    const store = tx.objectStore("aiQuizSets");
    const request = mode === "getAll" ? store.getAll() : mode === "put" ? store.put(value) : store.delete(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
async function verifyGeminiAccess() {
  const user = await waitForAuth();
  if (!user) return null;
  const { data, error } = await supabaseClient.from("mauritania_profiles").select("id,approved,rejected,suspended_until,gemini_enabled").eq("id", user.id).single();
  if (error) throw new Error("Impossible de vérifier l’accès IA.");
  const suspended = data.suspended_until && new Date(data.suspended_until) > new Date();
  if (!data.approved || data.rejected || suspended || !data.gemini_enabled) return null;
  return user;
}
async function openAiView() {
  try {
    const user = await verifyGeminiAccess();
    if (!user) {
      $("ai").innerHTML = `<div class="notice locked-tool">${icon("lock")}<div><h2>Quiz IA verrouillé</h2><p>Demandez à l’administrateur d’activer l’accès Gemini pour votre compte.</p></div></div>`;
      return;
    }
    await renderAiView(user);
  } catch (error) { $("ai").innerHTML = `<div class="notice error">${esc(error.message)}</div>`; }
}
async function renderAiView(user) {
  const sets = (await dbAction("getAll")).filter((set) => set.ownerId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const savedKey = localStorage.getItem(geminiKeyName(user.id)) || "";
  $("ai").innerHTML = `<div class="tool-grid"><section class="tool-card"><p class="kicker">Gemini 2.5 Flash</p><h2>Créer 30 QCM depuis un PDF</h2><p>10 faciles, 12 intermédiaires et 8 difficiles, avec correction.</p><label class="field"><span>Clé API Gemini</span><input id="geminiKey" type="password" value="${esc(savedKey)}" autocomplete="off" placeholder="AIza…"></label><label class="field"><span>Document PDF (20 Mo maximum)</span><input id="geminiPdf" type="file" accept="application/pdf,.pdf"></label><label class="check"><input id="geminiConsent" type="checkbox"> <span>J’accepte l’envoi de ce PDF à Google. L’utilisation peut être facturée et le contenu médical doit être vérifié.</span></label><div id="aiStatus" aria-live="polite"></div><button id="generateAiButton" class="btn primary wide" type="button" onclick="generateAiQuiz()">${icon("auto_awesome")}Générer 30 QCM</button><p class="security-note">La clé reste sur cet appareil, mais une clé persistante dans le navigateur est moins sûre qu’un secret géré par serveur.</p></section><section><div class="dashboard-heading"><div><h2>Mes séries locales</h2><p>${sets.length} série${sets.length === 1 ? "" : "s"} sur cet appareil.</p></div></div><div class="saved-list">${sets.length ? sets.map(aiSetCard).join("") : `<div class="empty-card">Aucune série générée.</div>`}</div></section></div>`;
}
function aiSetCard(set) {
  const id = esc(encodeURIComponent(set.id));
  return `<article class="saved-card"><div><h3>${esc(set.title)}</h3><p>30 QCM · ${new Date(set.createdAt).toLocaleDateString("fr-FR")}</p></div><div class="saved-actions"><button class="btn primary" type="button" onclick="startAiSet(decodeURIComponent('${id}'))">Ouvrir</button><button class="icon-btn" type="button" onclick="renameAiSet(decodeURIComponent('${id}'))" aria-label="Renommer">${icon("edit")}</button><button class="icon-btn" type="button" onclick="exportAiSet(decodeURIComponent('${id}'))" aria-label="Exporter en PDF">${icon("picture_as_pdf")}</button><button class="icon-btn danger" type="button" onclick="deleteAiSet(decodeURIComponent('${id}'))" aria-label="Supprimer">${icon("delete")}</button></div></article>`;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Lecture du PDF impossible.")); reader.readAsDataURL(file); });
}
function geminiError(status, body) {
  if (status === 400 || status === 401) return "Clé API invalide ou requête refusée.";
  if (status === 403) return "La clé n’a pas l’autorisation d’utiliser Gemini.";
  if (status === 404) return "Le modèle gemini-2.5-flash est indisponible pour cette clé.";
  if (status === 429) return "Quota Gemini atteint. Vérifiez votre facturation et réessayez manuellement.";
  if (status >= 500) return "Gemini est temporairement indisponible. Réessayez manuellement.";
  return body?.error?.message || "La génération a échoué.";
}
async function generateAiQuiz() {
  const status = $("aiStatus"); const button = $("generateAiButton");
  try {
    const user = await verifyGeminiAccess();
    if (!user) throw new Error("L’accès Gemini n’est plus actif pour ce compte.");
    const key = $("geminiKey").value.trim(); const file = $("geminiPdf").files[0];
    if (!key) throw new Error("Saisissez votre clé API Gemini.");
    if (!file || file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Sélectionnez un fichier PDF.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Le PDF dépasse la limite mobile de 20 Mo.");
    if (!$("geminiConsent").checked) throw new Error("Confirmez l’envoi du PDF à Google.");
    button.disabled = true; status.innerHTML = `<p class="loading">Génération en cours… Ne fermez pas cette page.</p>`;
    localStorage.setItem(geminiKeyName(user.id), key);
    const data = await fileToBase64(file);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: "application/pdf", data } }, { text: "À partir uniquement de ce PDF médical, crée exactement 30 QCM en français: 10 faciles, 12 intermediaires et 8 difficiles. Chaque QCM comporte 4 ou 5 propositions et une ou plusieurs bonnes réponses. Les distracteurs doivent être plausibles et l'explication concise, fidèle à la source. N'invente aucune information absente du document." }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: ResiStudyTools.geminiSchema, temperature: 0.2, maxOutputTokens: 20000 } })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(geminiError(response.status, body));
    if (body.promptFeedback?.blockReason || !body.candidates?.length) throw new Error("Gemini a bloqué ce document pour des raisons de sécurité.");
    const text = body.candidates[0].content?.parts?.map((part) => part.text || "").join("");
    let parsed; try { parsed = JSON.parse(text); } catch (_) { throw new Error("Gemini a renvoyé un résultat illisible. Aucun QCM n’a été enregistré."); }
    const questions = ResiStudyTools.validateGeneratedQuiz(parsed);
    const record = { id: crypto.randomUUID(), ownerId: user.id, title: file.name.replace(/\.pdf$/i, ""), sourceName: file.name, createdAt: Date.now(), model: "gemini-2.5-flash", questions };
    await dbAction("put", record);
    $("geminiPdf").value = "";
    await renderAiView(user);
  } catch (error) {
    if (status) status.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  } finally {
    if ($("geminiPdf")) $("geminiPdf").value = "";
    if (button) button.disabled = false;
  }
}
async function getAiSet(id) { const user = authUser(); if (!user) return null; return (await dbAction("getAll")).find((set) => set.id === id && set.ownerId === user.id) || null; }
async function startAiSet(id) {
  const set = await getAiSet(id); if (!set) return;
  state.session = { item: { id: set.id, title: set.title }, questions: set.questions, index: 0, selected: new Set(), checked: false, score: 0, origin: "ai" };
  renderQuestion(); go("quizRunner");
}
async function renameAiSet(id) { const set = await getAiSet(id); if (!set) return; const title = prompt("Nouveau nom", set.title)?.trim(); if (!title) return; set.title = title.slice(0, 100); await dbAction("put", set); openAiView(); }
async function deleteAiSet(id) { if (!confirm("Supprimer cette série locale ?")) return; const set = await getAiSet(id); if (!set) return; await dbAction("delete", id); openAiView(); }
async function exportAiSet(id) {
  const set = await getAiSet(id); if (!set) return;
  const { jsPDF } = window.jspdf || {}; if (!jsPDF) return alert("Le module PDF est indisponible hors ligne.");
  const doc = new jsPDF({ unit: "mm", format: "a4" }); const margin = 16; const width = 178; let y = 18;
  const line = (text, size = 10, bold = false, gap = 5) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); const rows = doc.splitTextToSize(String(text), width); const h = rows.length * size * 0.42 + gap; if (y + h > 282) { doc.addPage(); y = 18; } doc.text(rows, margin, y); y += h; };
  doc.setTextColor(16, 36, 62); line(set.title, 19, true, 8); line("30 QCM générés avec Gemini 2.5 Flash — contenu médical à vérifier.", 9, false, 9);
  set.questions.forEach((q, index) => {
    const blockHeight = doc.splitTextToSize(`${index + 1}. ${q.question}`, width).length * 4.7 + q.options.reduce((sum, opt) => sum + doc.splitTextToSize(`${opt.id}. ${opt.text}`, width).length * 3.9 + 2, 8);
    if (y + blockHeight > 282) { doc.addPage(); y = 18; }
    line(`${index + 1}. ${q.question}`, 11, true, 4); q.options.forEach((opt) => line(`${opt.id}. ${opt.text}`, 9, false, 2)); y += 4;
  });
  doc.addPage(); y = 18; line("Correction", 19, true, 9);
  set.questions.forEach((q, index) => { const answer = `${index + 1}. ${q.options.filter((o) => o.correct).map((o) => o.id).join(", ")}`; const blockHeight = doc.splitTextToSize(answer, width).length * 4.7 + doc.splitTextToSize(q.explanation, width).length * 3.9 + 8; if (y + blockHeight > 282) { doc.addPage(); y = 18; } line(answer, 11, true, 3); line(q.explanation, 9, false, 5); });
  doc.save(`${set.title.replace(/[^a-z0-9à-ÿ_-]+/gi, "-").replace(/^-|-$/g, "") || "quiz-ia"}-corrige.pdf`);
}
