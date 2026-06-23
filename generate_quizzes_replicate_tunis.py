import argparse
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import fitz
import requests
from json_repair import loads as repair_json_loads


ROOT = Path(__file__).resolve().parent
LECTURES_PATH = ROOT / "data" / "lectures.json"
OUTPUT_DIR = ROOT / "quizzes-replicate-tunis"
LOG_DIR = ROOT / "generation-logs"
MODEL = "google/gemini-2.5-flash"

DIFFICULTY_COUNTS = {
    "facile": 15,
    "intermediaire": 20,
    "difficile": 15,
}


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(message: str) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    line = f"[{now()}] {message}"
    print(line, flush=True)
    with (LOG_DIR / "replicate-tunis-generation.log").open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_lectures() -> list[dict[str, Any]]:
    data = json.loads(LECTURES_PATH.read_text(encoding="utf-8-sig"))
    return data.get("lectures", [])


def slug_from_quiz_path(lecture: dict[str, Any]) -> str:
    quiz = str(lecture.get("quiz") or "")
    if quiz:
        return Path(quiz).name
    lecture_id = str(lecture.get("id") or lecture.get("number") or "lecture").strip()
    return f"{lecture_id}.json"


def extract_pdf_text(pdf_path: Path) -> str:
    pages: list[str] = []
    with fitz.open(pdf_path) as doc:
        for index, page in enumerate(doc, start=1):
            text = page.get_text("text") or ""
            text = re.sub(r"[ \t]+", " ", text)
            text = re.sub(r"\n{3,}", "\n\n", text)
            if text.strip():
                pages.append(f"\n\n--- PAGE {index} ---\n{text.strip()}")
    return "\n".join(pages).strip()


def render_prompt(lecture: dict[str, Any], pdf_text: str) -> str:
    lecture_id = str(lecture.get("id") or lecture.get("number") or "")
    lecture_number = str(lecture.get("number") or lecture_id)
    title = str(lecture.get("title") or "")
    specialty = str(lecture.get("specialty") or "")
    partie = str(lecture.get("partie") or "")
    return f"""
Tu es un enseignant senior de médecine qui prépare des QCM de résidanat tunisien.

Objectif: générer un quiz JSON nouveau, détaillé, fiable et pédagogiquement utile à partir du texte extrait d'un seul cours PDF.

Métadonnées du cours:
- lectureId: {lecture_id}
- lectureNumber: {lecture_number}
- title: {title}
- partie: {partie}
- specialty: {specialty}

Règles de source:
- Utilise uniquement la source fournie plus bas.
- N'ajoute aucune connaissance médicale externe si elle n'est pas dans la source.
- Ne mentionne jamais "PDF", "document", "source", "selon le cours", "comme indiqué" dans les questions ou explications.
- Reformule les notions, ne copie pas de longs passages.
- Couvre tout le cours: définitions, mécanismes, clinique, diagnostic, examens, classifications, seuils, complications, traitements, surveillance, prévention et pièges d'examen quand ils existent.

Format et difficulté:
- Génère exactement 50 QCM en français.
- q1 à q15: difficulty = "facile".
- q16 à q35: difficulty = "intermediaire".
- q36 à q50: difficulty = "difficile".
- Chaque QCM est à réponses multiples: une ou plusieurs propositions peuvent être correctes.
- Ne fais pas un quiz à réponse unique. Au moins 25 questions doivent avoir au moins deux propositions correctes, sauf impossibilité stricte liée au contenu.
- Chaque question contient 4 ou 5 options, avec les IDs A, B, C, D, puis E si utile.
- Chaque option a un booléen "correct".
- Chaque question a au moins une bonne réponse.
- Les distracteurs doivent être plausibles mais faux d'après le contenu du cours.
- Les explications doivent être détaillées mais concises: elles justifient les bonnes réponses et clarifient les principaux pièges.

Retourne uniquement du JSON valide, sans Markdown, sans bloc de code et sans texte autour.

Structure exacte:
{{
  "lectureId": "{lecture_id}",
  "number": "{lecture_number}",
  "title": "{title}",
  "partie": "{partie}",
  "specialty": "{specialty}",
  "questions": [
    {{
      "id": "q1",
      "difficulty": "facile",
      "question": "Question en français ?",
      "options": [
        {{ "id": "A", "text": "Proposition A", "correct": true }},
        {{ "id": "B", "text": "Proposition B", "correct": false }},
        {{ "id": "C", "text": "Proposition C", "correct": true }},
        {{ "id": "D", "text": "Proposition D", "correct": false }}
      ],
      "explanation": "Explication fondée uniquement sur le cours."
    }}
  ]
}}

Avant de répondre, vérifie mentalement:
- JSON valide.
- Exactement 50 questions.
- IDs q1 à q50, sans trou ni doublon.
- Difficultés: 15 facile, 20 intermediaire, 15 difficile.
- Au moins 4 options par question.
- Au moins 25 questions avec plusieurs bonnes réponses.
- Toutes les explications sont médicalement exactes d'après le texte.

IMPORTANT FORMAT COMPACT:
Pour chaque question, utilise:
{{
  "id": "q1",
  "difficulty": "facile",
  "question": "Question en francais ?",
  "options": ["Proposition A", "Proposition B", "Proposition C", "Proposition D"],
  "correctAnswers": ["A", "C"],
  "explanation": "Explication claire."
}}
Les options doivent etre des chaines non vides. correctAnswers contient uniquement des lettres presentes dans options.

TEXTE DU COURS:
{pdf_text}
""".strip()


def extract_json(text: str) -> dict[str, Any]:
    cleaned = "".join(text).strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            repaired = repair_json_loads(cleaned)
            if isinstance(repaired, dict):
                return repaired
        except Exception:
            pass
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise
        snippet = cleaned[start : end + 1]
        try:
            return json.loads(snippet)
        except json.JSONDecodeError:
            repaired = repair_json_loads(snippet)
            if isinstance(repaired, dict):
                return repaired
            raise


def normalize_difficulty(value: Any) -> str:
    raw = str(value or "").strip().lower()
    raw = raw.replace("é", "e").replace("è", "e").replace("ê", "e")
    raw = raw.replace("intermédiaire", "intermediaire")
    if raw in {"facile", "easy"}:
        return "facile"
    if raw in {"intermediaire", "intermediate", "moyen", "moyenne"}:
        return "intermediaire"
    if raw in {"difficile", "hard", "avance", "avancee", "complexe"}:
        return "difficile"
    return raw


def validate_quiz(data: dict[str, Any], lecture: dict[str, Any]) -> tuple[bool, list[str]]:
    errors: list[str] = []
    questions = data.get("questions")
    if not isinstance(questions, list):
        return False, ["questions must be a list"]
    if len(questions) != 50:
        errors.append(f"expected 50 questions, got {len(questions)}")

    ids: set[str] = set()
    counts = {key: 0 for key in DIFFICULTY_COUNTS}
    multi_correct = 0
    banned_patterns = (
        "selon le pdf",
        "dans le pdf",
        "selon le document",
        "dans le document",
        "selon la source",
        "dans la source",
    )

    for index, question in enumerate(questions, start=1):
        if not isinstance(question, dict):
            errors.append(f"question {index}: not an object")
            continue

        expected_id = f"q{index}"
        qid = str(question.get("id", "")).strip()
        if qid != expected_id:
            errors.append(f"question {index}: expected id {expected_id}, got {qid or '<empty>'}")
        if qid in ids:
            errors.append(f"duplicate question id {qid}")
        ids.add(qid)

        difficulty = normalize_difficulty(question.get("difficulty"))
        question["difficulty"] = difficulty
        if difficulty in counts:
            counts[difficulty] += 1
        else:
            errors.append(f"{qid or expected_id}: invalid difficulty {difficulty or '<empty>'}")

        prompt = str(question.get("question", "")).strip()
        explanation = str(question.get("explanation", "")).strip()
        if not prompt:
            errors.append(f"{qid or expected_id}: empty question")
        if not explanation:
            errors.append(f"{qid or expected_id}: empty explanation")
        lowered = f"{prompt} {explanation}".lower()
        if any(pattern in lowered for pattern in banned_patterns):
            errors.append(f"{qid or expected_id}: mentions source/PDF/document")

        options = question.get("options")
        if not isinstance(options, list) or len(options) < 4:
            errors.append(f"{qid or expected_id}: expected at least 4 options")
            continue

        correct_answers = set(
            str(item).strip().upper()
            for item in (
                question.get("correctAnswers")
                or question.get("correct_answers")
                or question.get("answer")
                or []
            )
            if str(item).strip()
        )
        normalized_options: list[dict[str, Any]] = []
        correct_count = 0
        seen_option_ids: set[str] = set()
        for option_index, option in enumerate(options):
            expected_oid = chr(ord("A") + option_index)
            if isinstance(option, str):
                oid = expected_oid
                text = option.strip()
                correct = oid in correct_answers
            elif isinstance(option, dict):
                oid = str(option.get("id", "") or expected_oid).strip().upper()
                text = str(option.get("text") or option.get("label") or "").strip()
                correct = option.get("correct") is True or oid in correct_answers
            else:
                errors.append(f"{qid or expected_id}: option {option_index + 1} invalid")
                continue
            if not oid:
                errors.append(f"{qid or expected_id}: option {option_index + 1} missing id")
            if oid in seen_option_ids:
                errors.append(f"{qid or expected_id}: duplicate option id {oid}")
            seen_option_ids.add(oid)
            if oid and oid != expected_oid:
                errors.append(f"{qid or expected_id}: option {option_index + 1} expected {expected_oid}, got {oid}")
            if not text:
                errors.append(f"{qid or expected_id}: option {oid or option_index + 1} empty text")
            if correct:
                correct_count += 1
            normalized_options.append({"id": oid, "text": text, "correct": bool(correct)})

        if correct_count < 1:
            errors.append(f"{qid or expected_id}: no correct option")
        if correct_count >= 2:
            multi_correct += 1
        question["options"] = normalized_options
        question.pop("correctAnswers", None)
        question.pop("correct_answers", None)
        question.pop("answer", None)

    for difficulty, expected in DIFFICULTY_COUNTS.items():
        if counts[difficulty] != expected:
            errors.append(f"difficulty {difficulty}: expected {expected}, got {counts[difficulty]}")

    if multi_correct < 25:
        errors.append(f"expected at least 25 multi-correct questions, got {multi_correct}")

    data["lectureId"] = str(lecture.get("id") or lecture.get("number") or "")
    data["number"] = str(lecture.get("number") or data["lectureId"])
    data["title"] = str(lecture.get("title") or "")
    data["partie"] = str(lecture.get("partie") or "")
    data["specialty"] = str(lecture.get("specialty") or "")
    return not errors, errors


def prediction_text(prediction: dict[str, Any]) -> str:
    output = prediction.get("output")
    if isinstance(output, list):
        return "".join(str(chunk) for chunk in output)
    if isinstance(output, str):
        return output
    return ""


def create_prediction(token: str, prompt: str, timeout: int) -> dict[str, Any]:
    owner, name = MODEL.split("/", 1)
    url = f"https://api.replicate.com/v1/models/{owner}/{name}/predictions"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": f"wait={min(timeout, 60)}",
    }
    payload = {
        "input": {
            "prompt": prompt,
            "temperature": 0.15,
            "top_p": 0.85,
            "max_output_tokens": 65535,
            "thinking_budget": 1024,
            "dynamic_thinking": False,
        }
    }
    response = requests.post(url, headers=headers, json=payload, timeout=timeout + 20)
    if response.status_code >= 400:
        raise RuntimeError(f"Replicate create failed {response.status_code}: {response.text[:500]}")
    return response.json()


def wait_prediction(token: str, prediction: dict[str, Any], timeout: int) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    get_url = prediction.get("urls", {}).get("get")
    if not get_url:
        return prediction
    started = time.monotonic()
    current = prediction
    while current.get("status") not in {"succeeded", "failed", "canceled"}:
        if time.monotonic() - started > timeout:
            raise TimeoutError(f"Timed out waiting for prediction {current.get('id')}")
        time.sleep(4)
        response = requests.get(get_url, headers=headers, timeout=30)
        if response.status_code >= 400:
            raise RuntimeError(f"Replicate poll failed {response.status_code}: {response.text[:500]}")
        current = response.json()
    return current


def generate_once(token: str, prompt: str, timeout: int) -> str:
    prediction = create_prediction(token, prompt, timeout)
    prediction = wait_prediction(token, prediction, timeout)
    status = prediction.get("status")
    if status != "succeeded":
        raise RuntimeError(f"Replicate prediction {status}: {prediction.get('error') or prediction.get('logs') or ''}")
    text = prediction_text(prediction)
    if not text.strip():
        raise RuntimeError("Replicate returned empty output")
    return text


def write_progress(done: int, total: int, current: str, failures: list[dict[str, Any]]) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    progress = {
        "updatedAt": now(),
        "model": MODEL,
        "done": done,
        "total": total,
        "remaining": max(total - done, 0),
        "current": current,
        "failures": failures,
    }
    (LOG_DIR / "replicate-tunis-progress.json").write_text(
        json.dumps(progress, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def install_quiz_to_app(lecture: dict[str, Any], generated_path: Path) -> None:
    quiz_path = str(lecture.get("quiz") or "")
    if not quiz_path:
        return
    for destination in (ROOT / quiz_path, ROOT / "netlify-deploy" / quiz_path):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(generated_path, destination)


def run(limit: int, start: int, overwrite: bool, timeout: int, dry_run: bool, max_attempts: int, install_to_app: bool) -> int:
    token = os.environ.get("REPLICATE_API_TOKEN", "").strip()
    if not token:
        log("Missing REPLICATE_API_TOKEN environment variable.")
        return 1

    lectures = load_lectures()
    selected = lectures[start : start + limit if limit else None]
    OUTPUT_DIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)
    (LOG_DIR / "replicate-tunis-generation.log").write_text("", encoding="utf-8")

    failures: list[dict[str, Any]] = []
    done = 0
    total = len(selected)
    log(f"Starting {total} Tunis quiz generations with {MODEL}. Output: {OUTPUT_DIR}")
    write_progress(done, total, "", failures)

    for offset, lecture in enumerate(selected, start=start + 1):
        lecture_id = str(lecture.get("id") or lecture.get("number") or "")
        title = str(lecture.get("title") or "")
        pdf_path = ROOT / str(lecture.get("pdf") or "")
        output_path = OUTPUT_DIR / slug_from_quiz_path(lecture)

        if output_path.exists() and not overwrite:
            try:
                existing = json.loads(output_path.read_text(encoding="utf-8-sig"))
                valid, _ = validate_quiz(existing, lecture)
            except Exception:
                valid = False
            if valid:
                done += 1
                log(f"SKIP {done}/{total} #{offset} {lecture_id} {title} - already valid.")
                write_progress(done, total, title, failures)
                continue

        if not pdf_path.exists():
            failures.append({"lectureId": lecture_id, "title": title, "reason": f"missing PDF: {pdf_path}"})
            log(f"FAIL #{offset} {lecture_id} {title} - missing PDF.")
            write_progress(done, total, title, failures)
            continue

        pdf_text = extract_pdf_text(pdf_path)
        if len(pdf_text) < 1000:
            failures.append({"lectureId": lecture_id, "title": title, "reason": "too little extractable PDF text"})
            log(f"FAIL #{offset} {lecture_id} {title} - too little extractable text.")
            write_progress(done, total, title, failures)
            continue

        prompt = render_prompt(lecture, pdf_text)
        if dry_run:
            done += 1
            log(f"DRY {done}/{total} #{offset} {lecture_id} {title} - prompt chars {len(prompt)}.")
            write_progress(done, total, title, failures)
            continue

        success = False
        errors: list[str] = []
        for attempt in range(1, max_attempts + 1):
            try:
                log(f"START {done + 1}/{total} #{offset} {lecture_id} {title} attempt {attempt}.")
                text = generate_once(token, prompt, timeout)
                data = extract_json(text)
                valid, errors = validate_quiz(data, lecture)
                if valid:
                    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    if install_to_app:
                        install_quiz_to_app(lecture, output_path)
                    done += 1
                    success = True
                    log(f"DONE {done}/{total} #{offset} {lecture_id} {title} -> {output_path.name}.")
                    write_progress(done, total, title, failures)
                    break
                log(f"INVALID #{offset} {lecture_id} attempt {attempt}: {'; '.join(errors[:5])}")
                prompt += (
                    "\n\nCorrection obligatoire: la réponse précédente a échoué la validation. "
                    "Retourne uniquement un JSON complet valide. Erreurs principales: "
                    + "; ".join(errors[:12])
                )
                time.sleep(2)
            except Exception as error:
                detail = re.sub(r"\s+", " ", str(error)).strip()[:600]
                errors = [detail]
                log(f"ERROR #{offset} {lecture_id} attempt {attempt}: {detail}")
                time.sleep(4)

        if not success:
            failures.append({"lectureId": lecture_id, "title": title, "reason": "; ".join(errors[:12])})
            write_progress(done, total, title, failures)
            log(f"STOP #{offset} {lecture_id} {title} - no valid JSON after {max_attempts} attempts.")
            return 2

        time.sleep(1)

    log(f"Finished batch. Completed {done}/{total}. Failures: {len(failures)}.")
    write_progress(done, total, "", failures)
    return 0 if done == total else 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Tunis/FMT quiz JSON files with Replicate Gemini.")
    parser.add_argument("--limit", type=int, default=10, help="Number of lectures to generate. Use 0 for all after start.")
    parser.add_argument("--start", type=int, default=0, help="Zero-based lecture offset.")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate existing valid files in the output folder.")
    parser.add_argument("--timeout", type=int, default=900, help="Seconds to wait for each Replicate prediction.")
    parser.add_argument("--max-attempts", type=int, default=8, help="Maximum attempts per lecture before stopping.")
    parser.add_argument("--install-to-app", action="store_true", help="Copy valid generated quizzes into quizzes/ and netlify-deploy/quizzes/.")
    parser.add_argument("--dry-run", action="store_true", help="Extract PDFs and build prompts without calling Replicate.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        raise SystemExit(run(args.limit, args.start, args.overwrite, args.timeout, args.dry_run, args.max_attempts, args.install_to_app))
    except KeyboardInterrupt:
        log("Interrupted by user.")
        raise SystemExit(130)
