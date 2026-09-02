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
    setFocusedSession(false);
    $("exam").innerHTML = `<section class="exam-intro"><p class="kicker">Simulation complète</p><h2>Examen aléatoire</h2><p>Une épreuve équilibrée construite à partir de trois matières, avec correction exacte à la fin.</p><div class="exam-facts" aria-label="Format de l’examen"><div class="exam-fact"><strong>60 QCM</strong><span>20 + 20 + 20</span></div><div class="exam-fact"><strong>90 min</strong><span>Chronomètre continu</span></div><div class="exam-fact"><strong>1 point</strong><span>Réponse exacte</span></div></div><button class="btn primary wide" type="button" onclick="startRandomExam()">${icon("play_arrow")}Générer mon examen</button><p class="idea-credit">Idée proposée par Dr Sena</p></section>`;
    return;
  }
  if (exam.status === "finished") return renderExamResult();
  setFocusedSession(true);
  const q = exam.questions[exam.index];
  const selected = exam.answers[q.examId] || [];
  const answered = Object.values(exam.answers).filter((answer) => answer.length).length;
  const progress = Math.round(((exam.index + 1) / 60) * 100);
  $("exam").innerHTML = `<div class="session-shell"><div class="session-bar"><button class="btn session-back" type="button" onclick="go('home')" aria-label="Quitter l’examen">${icon("close")}<span class="button-label">Quitter</span></button><div class="session-title"><strong>Examen 60 QCM</strong><span>Question ${exam.index + 1} sur 60 · ${esc(q.category)}</span></div><div class="session-meta"><strong id="examClock">--:--</strong><span>${60 - answered} sans réponse</span></div></div><div class="session-progress" role="progressbar" aria-label="Progression de l’examen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><div class="session-content"><p class="quiz-meta">${esc(q.lectureTitle)}</p><div class="question">${esc(q.question)}</div><div class="options">${q.options.map((opt) => `<button class="option${selected.includes(opt.id) ? " selected" : ""}" type="button" onclick="toggleExamOption('${esc(opt.id)}')"><span class="letter">${esc(opt.id)}</span><span class="option-copy">${esc(opt.text)}</span></button>`).join("")}</div><div class="exam-sticky-nav"><button class="btn" type="button" onclick="moveExam(-1)" ${exam.index === 0 ? "disabled" : ""}>${icon("arrow_back")}Précédent</button><span class="exam-unanswered">${answered}/60 répondues</span><button class="btn primary" type="button" onclick="moveExam(1)">${exam.index === 59 ? "Revoir" : "Suivant"}${icon("arrow_forward")}</button></div><button class="text-action" type="button" onclick="finishExam(false)">Terminer et corriger</button></div></div>`;
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
  setFocusedSession(false);
  $("exam").innerHTML = `<div class="notice" role="status" aria-live="polite"><div><strong>Préparation de 60 QCM…</strong><p>Chargement équilibré des trois matières. L’examen démarrera seulement lorsque tout sera prêt.</p></div></div>`;
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
    $("exam").innerHTML = `<div class="notice error" role="alert"><div><strong>Examen non généré</strong><p>${esc(error.message)}</p><button class="btn" type="button" onclick="openExamView()">Réessayer</button></div></div>`;
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
  setFocusedSession(false);
  const exam = state.exam;
  const result = exam.result || ResiStudyTools.scoreExam(exam.questions, exam.answers);
  const duration = Math.max(0, Math.round(((exam.finishedAt || Date.now()) - exam.createdAt) / 1000));
  $("exam").innerHTML = `<div class="results-report"><section class="result-overview"><p class="kicker">${exam.expired ? "Temps écoulé" : "Examen terminé"}</p><h2>Rapport de l’épreuve</h2><div class="result-score"><strong>${result.score}</strong><span>/ 60</span></div><div class="result-metrics"><div class="result-metric"><strong>${Math.round(result.score / 60 * 100)} %</strong>Précision</div><div class="result-metric"><strong>${formatLectureQuizTime(duration)}</strong>Temps total</div><div class="result-metric"><strong>${result.unanswered}</strong>Sans réponse</div></div><div class="breakdown">${Object.entries(result.categories).map(([name, value]) => `<span><strong>${value.score}/${value.total}</strong>${esc(name)}</span>`).join("")}</div><button class="btn primary" type="button" onclick="newExam()">${icon("refresh")}Nouvel examen</button></section><section class="correction-section"><h2>Correction détaillée</h2><div class="review-list">${exam.questions.map((q, i) => { const selected = exam.answers[q.examId] || []; const correct = q.options.filter((o) => o.correct).map((o) => o.id); const isCorrect = ResiStudyTools.exactAnswer(q, selected); return `<details class="review"><summary><span>${i + 1}. ${esc(q.question)}</span><strong class="${isCorrect ? "ok" : "bad"}">${isCorrect ? "Correct" : "À revoir"}</strong></summary><div class="review-body"><p><strong>Votre réponse :</strong> ${selected.length ? esc(selected.join(", ")) : "Aucune"}</p><p><strong>Réponse correcte :</strong> ${esc(correct.join(", "))}</p>${q.explanation ? `<p class="explain">${esc(q.explanation)}</p>` : ""}</div></details>`; }).join("")}</div></section></div>`;
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
      $("ai").innerHTML = `<div class="notice locked-tool" role="status">${icon("lock")}<div><h2>Quiz IA verrouillé</h2><p>Demandez à l’administrateur d’activer l’accès Gemini pour votre compte. Vos séries locales restent conservées sur cet appareil.</p></div></div>`;
      return;
    }
    await renderAiView(user);
  } catch (error) { $("ai").innerHTML = `<div class="notice error" role="alert"><div><strong>Accès impossible</strong><p>${esc(error.message)}</p></div></div>`; }
}
async function renderAiView(user) {
  if ($("ai").querySelector(".ai-studio-frame")) return;
  const src = `ai-studio.html?v=resihub-20260902-1&embed=1&uid=${encodeURIComponent(user.id)}`;
  $("ai").innerHTML = `<iframe class="ai-studio-frame" src="${src}" title="RésiHub Medical AI" loading="eager"></iframe>`;
}
function aiSetCard(set) {
  const id = esc(encodeURIComponent(set.id));
  return `<article class="saved-card"><div><h3>${esc(set.title)}</h3><p>30 QCM · ${new Date(set.createdAt).toLocaleDateString("fr-FR")}</p></div><div class="saved-actions"><button class="btn primary" type="button" onclick="startAiSet(decodeURIComponent('${id}'))">Ouvrir</button><button class="icon-btn" type="button" onclick="renameAiSet(decodeURIComponent('${id}'))" aria-label="Renommer">${icon("edit")}</button><button class="icon-btn" type="button" onclick="exportAiSet(decodeURIComponent('${id}'))" aria-label="Exporter en PDF">${icon("picture_as_pdf")}</button><button class="icon-btn danger" type="button" onclick="deleteAiSet(decodeURIComponent('${id}'))" aria-label="Supprimer">${icon("delete")}</button></div></article>`;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Lecture du PDF impossible.")); reader.readAsDataURL(file); });
}
function geminiError(status, body) {
  const detail = String(body?.error?.message || "").trim();
  if (/api.?key.*(invalid|not valid)/i.test(detail) || status === 401) return "Clé API Gemini invalide.";
  if (status === 400) return `Requête Gemini refusée${detail ? ` : ${detail}` : "."}`;
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
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: "application/pdf", data } }, { text: "À partir uniquement de ce PDF médical, crée exactement 30 QCM en français: 10 faciles, 12 intermediaires et 8 difficiles. Chaque QCM comporte 4 ou 5 propositions et une ou plusieurs bonnes réponses. Les distracteurs doivent être plausibles et l'explication concise, fidèle à la source. N'invente aucune information absente du document." }] }], generationConfig: { responseMimeType: "application/json", responseSchema: ResiStudyTools.geminiSchema, temperature: 0.2, maxOutputTokens: 20000 } })
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
function imageAsDataUrl(url) {
  return fetch(url).then((response) => response.ok ? response.blob() : Promise.reject(new Error("Logo indisponible"))).then((blob) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }));
}
async function exportAiSet(id) {
  const set = await getAiSet(id); if (!set) return;
  const { jsPDF } = window.jspdf || {}; if (!jsPDF) return alert("Le module PDF est indisponible hors ligne.");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const width = 178; const navy = [6, 29, 69]; const green = [36, 107, 79]; const red = [215, 25, 32]; const ivory = [247, 244, 236]; const ink = [16, 36, 62]; let y = 0;
  let logo = null; try { logo = await imageAsDataUrl("images/icon-192.png"); } catch (_) {}
  const footer = () => { doc.setDrawColor(220, 226, 222); doc.line(16, 287, 194, 287); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(83, 97, 116); doc.text("RésiHub - Résidanat Mauritanie", 16, 293); doc.text(String(doc.getNumberOfPages()), 194, 293, { align: "right" }); };
  const header = (title, subtitle, accent = green) => { doc.setFillColor(...navy); doc.rect(0, 0, 210, 38, "F"); doc.setFillColor(...accent); doc.rect(0, 35, 210, 3, "F"); if (logo) doc.addImage(logo, "PNG", 16, 8, 20, 20); doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(255, 255, 255); doc.text("RésiHub", logo ? 41 : 16, 17); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text("RÉSIDANAT MAURITANIE", logo ? 41 : 16, 25); doc.setTextColor(...ink); y = 51; doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text(title, 16, y); y += 7; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(83, 97, 116); doc.text(subtitle, 16, y); y += 12; };
  const nextPage = (title, subtitle, accent) => { footer(); doc.addPage(); doc.setFillColor(...ivory); doc.rect(0, 0, 210, 297, "F"); header(title, subtitle, accent); };
  const questionBlock = (q, index, correction = false) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); const titleRows = doc.splitTextToSize(`${index + 1}. ${q.question}`, 164); const optionRows = correction ? [] : q.options.map((opt) => doc.splitTextToSize(`${opt.id}. ${opt.text}`, 164)); const answer = q.options.filter((opt) => opt.correct).map((opt) => opt.id).join(", "); const answerRows = correction ? doc.splitTextToSize(`Réponses exactes : ${answer}`, 164) : []; const explanationRows = correction ? doc.splitTextToSize(q.explanation, 164) : []; const height = 10 + titleRows.length * 5 + optionRows.reduce((sum, rows) => sum + rows.length * 4 + 1, 0) + answerRows.length * 4 + explanationRows.length * 4 + (correction ? 10 : 4);
    if (y + height > 276) nextPage(correction ? "Correction" : set.title, correction ? "Réponses exactes et explications" : "Questions - une seule réponse peut être choisie par ligne", correction ? red : green);
    doc.setFillColor(255, 255, 255); doc.roundedRect(14, y - 5, 182, height, 4, 4, "F"); doc.setFillColor(...(correction ? red : green)); doc.roundedRect(14, y - 5, 4, height, 2, 2, "F");
    doc.setTextColor(...ink); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(titleRows, 25, y); y += titleRows.length * 5 + 3;
    if (correction) { doc.setTextColor(...red); doc.setFontSize(10); doc.text(answerRows, 25, y); y += answerRows.length * 4 + 3; doc.setTextColor(83, 97, 116); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(explanationRows, 25, y); y += explanationRows.length * 4 + 7; }
    else { doc.setTextColor(83, 97, 116); doc.setFont("helvetica", "normal"); doc.setFontSize(9); optionRows.forEach((rows) => { doc.text(rows, 25, y); y += rows.length * 4 + 1; }); y += 7; }
  };
  doc.setFillColor(...ivory); doc.rect(0, 0, 210, 297, "F"); header(set.title, "30 QCM générés avec Gemini 2.5 Flash - contenu médical à vérifier.");
  set.questions.forEach((q, index) => questionBlock(q, index));
  nextPage("Correction", "Réponses exactes et explications", red);
  set.questions.forEach((q, index) => questionBlock(q, index, true));
  footer();
  doc.save(`${set.title.replace(/[^a-z0-9à-ÿ_-]+/gi, "-").replace(/^-|-$/g, "") || "quiz-ia"}-corrige.pdf`);
}
