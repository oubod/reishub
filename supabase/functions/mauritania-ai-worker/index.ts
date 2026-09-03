import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import pdfMake from "npm:pdfmake@0.2.10/build/pdfmake.js";
import pdfFonts from "npm:pdfmake@0.2.10/build/vfs_fonts.js";
import "../../../residanat-mauritania/js/ai-pdf.js";

const model = "gemini-3.8-flash";
const schema = { type: "object", required: ["questions"], properties: { questions: { type: "array", minItems: 15, maxItems: 15, items: { type: "object", required: ["question", "type", "options", "correct_answers", "explanation", "reference"], properties: { question: { type: "string" }, type: { type: "string", enum: ["QRU", "QRM"] }, options: { type: "object", required: ["A", "B", "C", "D"], properties: { A: { type: "string" }, B: { type: "string" }, C: { type: "string" }, D: { type: "string" }, E: { type: "string" } } }, correct_answers: { type: "array", items: { type: "string", enum: ["A", "B", "C", "D", "E"] } }, explanation: { type: "string" }, reference: { type: "string" } } } } } };
const enc = new TextEncoder(), dec = new TextDecoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function aesKey() { return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(Deno.env.get("AI_KEY_ENCRYPTION_SECRET")!)), "AES-GCM", false, ["decrypt"]); }
async function decrypt(secret: any) { const iv = Uint8Array.from(atob(secret.iv), (c) => c.charCodeAt(0)), data = Uint8Array.from(atob(secret.ciphertext), (c) => c.charCodeAt(0)); return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), data)); }
async function request(url: string, init: RequestInit, key: string) {
  const response = await fetch(url, { ...init, headers: { ...(init.headers || {}), "x-goog-api-key": key } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const e: any = new Error(body?.error?.message || `Gemini ${response.status}`); e.status = response.status; throw e; } return body;
}
async function uploadGemini(job: any, key: string) {
  if (job.gemini_file_name) return job.gemini_file_name;
  const { data, error } = await admin.storage.from("mauritania-ai-inputs").download(job.input_path); if (error) throw error;
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", { method: "POST", headers: { "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(data.size), "X-Goog-Upload-Header-Content-Type": "application/pdf", "Content-Type": "application/json" }, body: JSON.stringify({ file: { display_name: job.source_name } }) });
  if (!start.ok) { const e: any = new Error("Téléversement Gemini refusé."); e.status = start.status; throw e; }
  const uploadUrl = start.headers.get("x-goog-upload-url")!;
  const uploaded = await request(uploadUrl, { method: "POST", headers: { "Content-Length": String(data.size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: await data.arrayBuffer() }, key);
  const name = uploaded.file.name; await admin.from("mauritania_ai_jobs").update({ gemini_file_name: name }).eq("id", job.id);
  for (let i = 0; i < 20; i++) { const file = await request(`https://generativelanguage.googleapis.com/v1beta/${name}`, {}, key); if (file.state === "ACTIVE") return name; if (file.state === "FAILED") throw new Error("Google n’a pas pu lire ce PDF."); await sleep(1500); }
  throw Object.assign(new Error("Le PDF est encore en préparation."), { status: 503 });
}
function validate(body: any, wanted: string, previous: string[]) {
  const list = body?.questions; if (!Array.isArray(list) || list.length !== 15) throw new Error("Le modèle n’a pas fourni exactement 15 questions.");
  const seen = new Set(previous.map((x) => x.toLowerCase().trim()));
  for (const q of list) { const keys = Object.keys(q.options || {}), answers = q.correct_answers || [], prose = `${q.question} ${q.explanation}`.toLowerCase(); if (!q.question || !q.explanation || !q.reference || keys.length < 4 || !answers.length || answers.some((x: string) => !keys.includes(x)) || q.type === "QRU" && answers.length !== 1 || q.type === "QRM" && answers.length < 2 || !/\b(le|la|les|un|une|des|est|sont|chez|dans|avec|pour|cette|ce)\b/.test(prose)) throw new Error("Une question ne respecte pas le format français demandé."); const stem = q.question.toLowerCase().trim(); if (seen.has(stem)) throw new Error("Questions dupliquées."); seen.add(stem); }
  if (wanted === "qru" && list.some((q: any) => q.type !== "QRU") || wanted === "qrm" && list.some((q: any) => q.type !== "QRM")) throw new Error("Type de question incorrect."); return list;
}
async function generate(job: any, fileName: string, key: string, previous: string[]) {
  const file = await request(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {}, key);
  const prompt = `Crée exactement 15 questions médicales EN FRANÇAIS, exclusivement à partir du PDF. Format ${job.question_type === "mixed" ? "mélangé QRU et QRM" : job.question_type.toUpperCase()}. Chaque question a 4 ou 5 choix, une explication détaillée et une référence de page ou section. N'ajoute aucune recommandation récente ni information extérieure. Spécialité: ${job.specialty || "non précisée"}. Questions déjà créées à ne pas répéter: ${previous.join(" | ") || "aucune"}.`;
  let last: any;
  for (let repair = 0; repair < 2; repair++) {
    const body = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ file_data: { mime_type: "application/pdf", file_uri: file.uri } }, { text: repair ? `${prompt}\nRépare strictement la structure et le compte; renvoie seulement le JSON valide.` : prompt }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0.15, maxOutputTokens: 20000 } }) }, key);
    last = body; try { const text = body.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join(""); return { questions: validate(JSON.parse(text), job.question_type, previous), usage: body.usageMetadata || {} }; } catch (e) { if (repair) throw e; }
  } throw new Error(last?.error?.message || "Réponse illisible.");
}
function pdfBuffer(definition: any) { return new Promise<Uint8Array>((resolve) => { (pdfMake as any).createPdf(definition).getBuffer((b: Uint8Array) => resolve(b)); }); }
async function finish(job: any, chunks: any[], key: string) {
  const questions = chunks.flatMap((c) => c.questions), quiz = { title: job.title, source_name: job.source_name, specialty: job.specialty, questions };
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || (pdfFonts as any).vfs;
  await admin.from("mauritania_ai_jobs").update({ status: "building_pdf", stage: "Création du PDF", progress: 94, lease_until: new Date(Date.now() + 110000).toISOString() }).eq("id", job.id);
  const bytes = await pdfBuffer((globalThis as any).ResiAiPdf.buildPdfDefinition([quiz])); const path = `${job.user_id}/${job.id}/epreuve.pdf`;
  const { error } = await admin.storage.from("mauritania-ai-outputs").upload(path, bytes, { contentType: "application/pdf", upsert: true }); if (error) throw error;
  await admin.from("mauritania_ai_jobs").update({ status: "completed", stage: "Terminée", progress: 100, result: { quiz }, output_path: path, completed_at: new Date().toISOString(), pdf_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), lease_until: null }).eq("id", job.id);
  await admin.from("mauritania_ai_job_secrets").delete().eq("job_id", job.id); await admin.storage.from("mauritania-ai-inputs").remove([job.input_path]);
  if (job.gemini_file_name) await fetch(`https://generativelanguage.googleapis.com/v1beta/${job.gemini_file_name}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {});
}
async function cleanup() {
  const now = new Date().toISOString(); const { data: pdfs } = await admin.from("mauritania_ai_jobs").select("id,output_path").lt("pdf_expires_at", now).not("output_path", "is", null);
  for (const j of pdfs || []) { await admin.storage.from("mauritania-ai-outputs").remove([j.output_path]); await admin.from("mauritania_ai_jobs").update({ output_path: null }).eq("id", j.id); }
  const { data: sources } = await admin.from("mauritania_ai_jobs").select("id,input_path").eq("status", "failed").lt("source_expires_at", now);
  for (const j of sources || []) { await admin.storage.from("mauritania-ai-inputs").remove([j.input_path]); await admin.from("mauritania_ai_jobs").update({ source_expires_at: null }).eq("id", j.id); }
}
async function work() {
  await cleanup(); const { data: claimed } = await admin.rpc("claim_mauritania_ai_job"); const job = claimed?.[0]; if (!job) return;
  let key = "", fileName = job.gemini_file_name || "";
  try {
    const { data: secret } = await admin.from("mauritania_ai_job_secrets").select("*").eq("job_id", job.id).single(); key = await decrypt(secret);
    const { data: current } = await admin.from("mauritania_ai_jobs").select("cancel_requested").eq("id", job.id).single();
    if (current?.cancel_requested) { await admin.from("mauritania_ai_jobs").update({ status: "cancelled", stage: "Annulée", lease_until: null }).eq("id", job.id); if (fileName) await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {}); await admin.from("mauritania_ai_job_secrets").delete().eq("job_id", job.id); await admin.storage.from("mauritania-ai-inputs").remove([job.input_path]); return; }
    const { data: old } = await admin.from("mauritania_ai_job_chunks").select("*").eq("job_id", job.id).order("chunk_index");
    if ((old?.length || 0) >= job.chunks_total) { await finish(job, old || [], key); return; }
    fileName = await uploadGemini(job, key); const previous = (old || []).flatMap((c) => c.questions.map((q: any) => q.question));
    const result = await generate(job, fileName, key, previous);
    const { data: afterGeneration } = await admin.from("mauritania_ai_jobs").select("cancel_requested").eq("id", job.id).single();
    if (afterGeneration?.cancel_requested) { await admin.from("mauritania_ai_jobs").update({ status: "cancelled", stage: "Annulée", lease_until: null }).eq("id", job.id); if (fileName) await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {}); await admin.from("mauritania_ai_job_secrets").delete().eq("job_id", job.id); await admin.storage.from("mauritania-ai-inputs").remove([job.input_path]); return; }
    const index = old?.length || 0;
    await admin.from("mauritania_ai_job_chunks").upsert({ job_id: job.id, chunk_index: index, questions: result.questions, input_tokens: result.usage.promptTokenCount || 0, output_tokens: result.usage.candidatesTokenCount || 0 });
    const { data: chunks } = await admin.from("mauritania_ai_job_chunks").select("*").eq("job_id", job.id).order("chunk_index"); const done = chunks?.length || 0;
    await admin.from("mauritania_ai_jobs").update({ chunks_completed: done, progress: Math.round(8 + done / job.chunks_total * 82), input_tokens: (chunks || []).reduce((n, c) => n + Number(c.input_tokens), 0), output_tokens: (chunks || []).reduce((n, c) => n + Number(c.output_tokens), 0), status: done === job.chunks_total ? "building_pdf" : "queued", stage: done === job.chunks_total ? "Création du PDF" : `Bloc ${done}/${job.chunks_total} terminé`, lease_until: null }).eq("id", job.id);
    if (done === job.chunks_total) await finish({ ...job, gemini_file_name: fileName }, chunks || [], key); else fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mauritania-ai-worker`, { method: "POST", headers: { "x-worker-token": Deno.env.get("AI_WORKER_TOKEN") || "" } }).catch(() => {});
  } catch (e: any) {
    const { data: cancelled } = await admin.from("mauritania_ai_jobs").select("cancel_requested").eq("id", job.id).single();
    if (cancelled?.cancel_requested) { await admin.from("mauritania_ai_jobs").update({ status: "cancelled", stage: "Annulée", lease_until: null }).eq("id", job.id); if (fileName && key) await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {}); await admin.from("mauritania_ai_job_secrets").delete().eq("job_id", job.id); await admin.storage.from("mauritania-ai-inputs").remove([job.input_path]); return; }
    const transient = ![400, 401, 403].includes(e.status), attempts = job.attempt_count + 1;
    if (transient && attempts <= 3) await admin.from("mauritania_ai_jobs").update({ status: "queued", stage: `Nouvelle tentative ${attempts}/3`, attempt_count: attempts, next_attempt_at: new Date(Date.now() + attempts * 30000).toISOString(), lease_until: null, error_message: "Incident temporaire, reprise automatique." }).eq("id", job.id);
    else { await admin.from("mauritania_ai_jobs").update({ status: "failed", stage: "Échec", attempt_count: attempts, lease_until: null, source_expires_at: new Date(Date.now() + 86400000).toISOString(), error_message: e.status === 401 || e.status === 403 ? "Clé Gemini invalide ou non autorisée." : String(e.message).slice(0, 240) }).eq("id", job.id); if (fileName && key) await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {}); await admin.from("mauritania_ai_job_secrets").delete().eq("job_id", job.id); }
  }
}

Deno.serve((req) => { if (req.headers.get("x-worker-token") !== Deno.env.get("AI_WORKER_TOKEN")) return new Response("Interdit", { status: 403 }); (globalThis as any).EdgeRuntime?.waitUntil(work()); return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } }); });
