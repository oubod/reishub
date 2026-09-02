import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const active = ["uploading", "queued", "processing", "building_pdf", "cancelling"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const clean = (value: unknown, max = 100) => String(value || "").trim().slice(0, max);

async function aesKey() {
  const secret = Deno.env.get("AI_KEY_ENCRYPTION_SECRET");
  if (!secret) throw new Error("Secret de chiffrement absent.");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)), "AES-GCM", false, ["encrypt"]);
}
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(value)));
  return { iv: btoa(String.fromCharCode(...iv)), ciphertext: btoa(String.fromCharCode(...data)) };
}
function validQuiz(body: any) {
  const questions = body?.questions;
  if (!Array.isArray(questions) || ![15, 30, 45].includes(questions.length)) throw new Error("Le JSON doit contenir 15, 30 ou 45 questions.");
  for (const q of questions) if (!q?.question && !q?.stem || !q?.options || !Array.isArray(q.correct_answers) || !q.correct_answers.length || !q.explanation) throw new Error("Structure de question invalide.");
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, service);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Connexion requise." }, 401);
    const { data: profile } = await admin.from("mauritania_profiles").select("approved,rejected,suspended_until,gemini_enabled").eq("id", user.id).single();
    if (!profile?.approved || profile.rejected || profile.suspended_until && new Date(profile.suspended_until) > new Date() || !profile.gemini_enabled) return json({ error: "Accès IA non autorisé." }, 403);
    const body = await req.json(), action = body.action;
    const own = async () => {
      const { data } = await admin.from("mauritania_ai_jobs").select("*").eq("id", body.jobId).eq("user_id", user.id).single();
      if (!data) throw new Error("Génération introuvable."); return data;
    };
    if (action === "create") {
      const count = Number(body.questionCount), type = body.questionType;
      if (![15, 30, 45].includes(count) || !["qru", "qrm", "mixed"].includes(type)) return json({ error: "Paramètres de génération invalides." }, 400);
      if (!/\.pdf$/i.test(body.sourceName || "") || Number(body.sourceSize) > 20971520) return json({ error: "PDF invalide ou supérieur à 20 Mo." }, 400);
      if (!clean(body.apiKey, 500)) return json({ error: "Clé API Gemini requise." }, 400);
      const { count: unfinished } = await admin.from("mauritania_ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("status", active);
      if ((unfinished || 0) >= 3) return json({ error: "Trois générations sont déjà en cours." }, 409);
      const { data: history } = await admin.from("mauritania_ai_jobs").select("started_at,completed_at").eq("user_id", user.id).eq("status", "completed").eq("question_count", count).eq("question_type", type).not("started_at", "is", null).not("completed_at", "is", null).limit(9);
      const durations = (history || []).map((j) => Math.round((new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000)).filter((n) => n > 0).sort((a, b) => a - b);
      const estimate = durations.length >= 3 ? durations[Math.floor(durations.length / 2)] : count * 10;
      const id = crypto.randomUUID(), path = `${user.id}/${id}/source.pdf`, encrypted = await encrypt(clean(body.apiKey, 500));
      const row = { id, user_id: user.id, title: clean(body.title) || clean(body.sourceName).replace(/\.pdf$/i, ""), source_name: clean(body.sourceName, 180), specialty: clean(body.specialty, 80), question_count: count, question_type: type, chunks_total: count / 15, estimated_seconds: estimate, input_path: path };
      const { error } = await admin.from("mauritania_ai_jobs").insert(row); if (error) throw error;
      await admin.from("mauritania_ai_job_secrets").insert({ job_id: id, ...encrypted });
      const { data: signed, error: signError } = await admin.storage.from("mauritania-ai-inputs").createSignedUploadUrl(path); if (signError) throw signError;
      return json({ jobId: id, inputPath: path, uploadToken: signed.token });
    }
    if (action === "enqueue") {
      const job = await own(); if (job.status !== "uploading") throw new Error("Cette génération est déjà lancée.");
      const { data: files } = await admin.storage.from("mauritania-ai-inputs").list(`${user.id}/${job.id}`); if (!files?.some((f) => f.name === "source.pdf")) throw new Error("Le PDF n’est pas encore entièrement transmis.");
      await admin.from("mauritania_ai_jobs").update({ status: "queued", stage: "En attente", progress: 5, updated_at: new Date().toISOString() }).eq("id", job.id);
      fetch(`${url}/functions/v1/mauritania-ai-worker`, { method: "POST", headers: { "content-type": "application/json", "x-worker-token": Deno.env.get("AI_WORKER_TOKEN") || "" }, body: "{}" }).catch(() => {});
      return json({ ok: true });
    }
    if (action === "resume-upload") { const job = await own(); if (job.status !== "uploading") throw new Error("Ce téléversement est déjà terminé."); const { data, error } = await admin.storage.from("mauritania-ai-inputs").createSignedUploadUrl(job.input_path); if (error) throw error; return json({ jobId: job.id, inputPath: job.input_path, uploadToken: data.token }); }
    if (action === "cancel") { const job = await own(); await admin.from("mauritania_ai_jobs").update({ cancel_requested: true, status: ["uploading", "queued"].includes(job.status) ? "cancelled" : "cancelling", stage: "Annulation demandée", updated_at: new Date().toISOString() }).eq("id", job.id); if (["uploading", "queued"].includes(job.status)) { await admin.from("mauritania_ai_job_secrets").delete().eq("job_id", job.id); await admin.storage.from("mauritania-ai-inputs").remove([job.input_path]); } return json({ ok: true }); }
    if (action === "retry") { const job = await own(); if (job.status !== "failed" || job.source_expires_at && new Date(job.source_expires_at) < new Date()) throw new Error("Cette génération ne peut plus être relancée."); const encrypted = await encrypt(clean(body.apiKey, 500)); await admin.from("mauritania_ai_job_secrets").upsert({ job_id: job.id, ...encrypted }); await admin.from("mauritania_ai_jobs").update({ status: "queued", stage: "Nouvelle tentative", error_message: null, cancel_requested: false, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id); return json({ ok: true }); }
    if (action === "rename") { const job = await own(); await admin.from("mauritania_ai_jobs").update({ title: clean(body.title) }).eq("id", job.id); return json({ ok: true }); }
    if (action === "delete") { const job = await own(); if (active.includes(job.status)) throw new Error("Annulez d’abord cette génération."); await admin.storage.from("mauritania-ai-inputs").remove([job.input_path]); if (job.output_path) await admin.storage.from("mauritania-ai-outputs").remove([job.output_path]); await admin.from("mauritania_ai_jobs").delete().eq("id", job.id); return json({ ok: true }); }
    if (action === "download") { const job = await own(); if (job.status !== "completed" || !job.output_path) throw new Error("PDF à recréer localement."); const { data, error } = await admin.storage.from("mauritania-ai-outputs").createSignedUrl(job.output_path, 300); if (error) throw error; return json({ url: data.signedUrl }); }
    if (action === "import") { const quiz = validQuiz(body.quiz), id = crypto.randomUUID(), title = clean(quiz.title) || "Épreuve importée"; await admin.from("mauritania_ai_jobs").insert({ id, user_id: user.id, title, source_name: "Import JSON", question_count: quiz.questions.length, question_type: "mixed", chunks_total: quiz.questions.length / 15, chunks_completed: quiz.questions.length / 15, estimated_seconds: 0, input_path: `${user.id}/${id}/import.json`, status: "completed", stage: "Terminée", progress: 100, result: { quiz }, completed_at: new Date().toISOString() }); return json({ id }); }
    return json({ error: "Action inconnue." }, 400);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Erreur serveur." }, 400); }
});
