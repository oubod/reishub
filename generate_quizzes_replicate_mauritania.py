import argparse
import json
import os
import re
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import fitz
import requests
from json_repair import loads as repair_json_loads


ROOT = Path(__file__).resolve().parent
APP_ROOT = ROOT / "residanat-mauritania"
LECTURES_PATH = APP_ROOT / "data" / "lectures.json"
LOG_DIR = ROOT / "generation-logs"
OCR_CACHE_DIR = LOG_DIR / "ocr-cache-mauritania"
MODEL = "google/gemini-2.5-flash"
MAX_SOURCE_CHARS = 28000
MIN_MULTI_CORRECT = 20
MAX_OUTPUT_TOKENS = 32768
DEFAULT_MAX_ATTEMPTS = 1

DIFFICULTY_COUNTS = {
    "facile": 5,
    "intermediaire": 20,
    "difficile": 25,
}


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(message: str) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    line = f"[{now()}] {message}"
    print(line, flush=True)
    with (LOG_DIR / "replicate-mauritania-generation.log").open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_lectures() -> list[dict[str, Any]]:
    raw = json.loads(LECTURES_PATH.read_text(encoding="utf-8-sig"))
    lectures: list[dict[str, Any]] = []
    for category, items in raw.items():
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items, start=1):
            lecture = dict(item)
            lecture["category"] = category
            lecture["categoryIndex"] = index
            lectures.append(lecture)
    return lectures


def app_path(relative: str) -> Path:
    return APP_ROOT / relative.replace("/", os.sep)


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


_OCR_READER = None


def get_ocr_reader():
    global _OCR_READER
    if _OCR_READER is None:
        import easyocr

        log("Initializing EasyOCR for scanned PDFs.")
        _OCR_READER = easyocr.Reader(["fr"], gpu=False, verbose=False)
    return _OCR_READER


def ocr_pdf_text(pdf_path: Path) -> str:
    OCR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = OCR_CACHE_DIR / f"{pdf_path.stem}.txt"
    if cache_path.exists() and cache_path.stat().st_size > 1000:
        return cache_path.read_text(encoding="utf-8-sig")

    reader = get_ocr_reader()
    pages: list[str] = []
    with fitz.open(pdf_path) as doc:
        for index, page in enumerate(doc, start=1):
            image_path = OCR_CACHE_DIR / f"{pdf_path.stem}-page-{index}.png"
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            pix.save(image_path)
            try:
                lines = reader.readtext(str(image_path), detail=0, paragraph=True)
            finally:
                try:
                    image_path.unlink()
                except OSError:
                    pass
            text = "\n".join(str(line) for line in lines if str(line).strip())
            if text.strip():
                pages.append(f"\n\n--- PAGE {index} OCR ---\n{text.strip()}")

    result = "\n".join(pages).strip()
    if result:
        cache_path.write_text(result, encoding="utf-8")
    return result


def source_text_for_lecture(lecture: dict[str, Any]) -> tuple[str, str]:
    pdf_path = app_path(str(lecture.get("pdf") or ""))
    if pdf_path.exists():
        text = extract_pdf_text(pdf_path)
        if len(text) >= 1000:
            return text, str(pdf_path)
        text = ocr_pdf_text(pdf_path)
        if len(text) >= 1000:
            return text, str(pdf_path)

    summary = str(lecture.get("summary") or "")
    summary_path = app_path(summary) if summary else Path()
    if summary_path.exists():
        text = extract_pdf_text(summary_path)
        if len(text) >= 1000:
            return text, str(summary_path)
        text = ocr_pdf_text(summary_path)
        if len(text) >= 1000:
            return text, str(summary_path)

    if pdf_path.exists():
        return extract_pdf_text(pdf_path), str(pdf_path)
    return "", str(pdf_path)


def compact_source_text(text: str) -> str:
    if len(text) <= MAX_SOURCE_CHARS:
        return text
    head = text[: MAX_SOURCE_CHARS // 2]
    tail = text[-MAX_SOURCE_CHARS // 2 :]
    # ponytail: bounded prompt cost, raise MAX_SOURCE_CHARS if coverage becomes weak.
    return f"{head}\n\n--- TEXTE CENTRAL COUPE POUR REDUIRE LE COUT API ---\n\n{tail}"


def render_prompt(lecture: dict[str, Any], pdf_text: str) -> str:
    lecture_id = str(lecture.get("id") or "")
    title = str(lecture.get("title") or "")
    category = str(lecture.get("category") or "")
    return f"""
Tu es un enseignant senior de medecine qui prepare des QCM de residanat mauritanien.

Objectif: generer un nouveau quiz JSON detaille, fiable et pedagogique a partir du texte extrait d'un seul cours PDF.

Metadonnees:
- lectureId: {lecture_id}
- title: {title}
- category: {category}

Regles de source:
- Utilise uniquement le texte fourni plus bas.
- N'ajoute aucune connaissance externe si elle n'est pas soutenue par le texte.
- Ne mentionne jamais "PDF", "document", "source", "selon le cours" ou "comme indique" dans les questions ou explications.
- Couvre largement le cours: definitions, physiopathologie, clinique, diagnostic, examens, classifications, seuils, complications, traitement, surveillance, prevention et pieges d'examen quand ils existent.
- Reformule, ne copie pas de longs passages.

Format:
- Retourne uniquement du JSON valide, sans Markdown et sans texte autour.
- Genere exactement 50 QCM en francais.
- q1 a q5: difficulty = "facile".
- q6 a q25: difficulty = "intermediaire".
- q26 a q50: difficulty = "difficile".
- La majorite des QCM doit etre a reponses multiples: vise au moins 30 questions avec 2, 3 ou 4 bonnes reponses.
- Evite les questions a reponse unique, mais elles sont acceptees si le cours ne permet pas une combinaison fiable.
- Chaque question contient exactement 5 options avec les ids A, B, C, D, E.
- Les questions faciles testent seulement les bases; les autres doivent etre appliquees, discriminantes et proches du niveau residanat.
- Les distracteurs doivent etre plausibles, proches des bonnes propositions, mais faux d'apres le contenu.
- Evite les questions de simple definition quand un piege clinique, diagnostique, therapeutique ou physiopathologique est possible.
- Les explications doivent justifier toutes les bonnes reponses et corriger les principaux pieges.

Structure exacte attendue, avec format compact pour eviter les champs vides:
{{
  "lectureId": "{lecture_id}",
  "title": "{title}",
  "category": "{category}",
  "questions": [
    {{
      "id": "q1",
      "type": "quiz",
      "difficulty": "facile",
      "question": "Question en francais ?",
      "options": ["Proposition A", "Proposition B", "Proposition C", "Proposition D", "Proposition E"],
      "correctAnswers": ["A", "C"],
      "explanation": "Explication courte et medicalement exacte."
    }}
  ]
}}

Avant de repondre, verifie:
- JSON valide.
- Exactement 50 questions.
- IDs q1 a q50 sans trou.
- 5 facile, 20 intermediaire, 25 difficile.
- Exactement 5 options par question.
- correctAnswers contient uniquement les lettres des options correctes: A, B, C, D ou E.
- N'utilise jamais une option vide. Chaque proposition doit etre une phrase medicale complete.
- Au moins 20 questions ont 2, 3 ou 4 bonnes reponses.
- Aucune question ne doit avoir 0 ou 5 bonnes reponses.
- Toutes les explications sont fondees sur le texte.

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

    counts = {key: 0 for key in DIFFICULTY_COUNTS}
    ids: set[str] = set()
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
        qid = expected_id
        question["id"] = expected_id
        if qid in ids:
            errors.append(f"duplicate question id {qid}")
        ids.add(qid)

        question["type"] = "quiz"
        prompt = str(question.get("question") or question.get("q") or "").strip()
        explanation = str(question.get("explanation") or "").strip()
        question["question"] = prompt
        if not prompt:
            errors.append(f"{expected_id}: empty question")
        if not explanation:
            errors.append(f"{expected_id}: empty explanation")
        lowered = f"{prompt} {explanation}".lower()
        if any(pattern in lowered for pattern in banned_patterns):
            errors.append(f"{expected_id}: mentions source/PDF/document")

        if index <= 5:
            difficulty = "facile"
        elif index <= 25:
            difficulty = "intermediaire"
        else:
            difficulty = "difficile"
        question["difficulty"] = difficulty
        if difficulty in counts:
            counts[difficulty] += 1
        else:
            errors.append(f"{expected_id}: invalid difficulty {difficulty or '<empty>'}")

        options = question.get("options")
        if not isinstance(options, list) or len(options) < 4 or len(options) > 5:
            errors.append(f"{expected_id}: expected 4 or 5 options")
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
        seen_ids: set[str] = set()
        seen_texts: set[str] = set()
        correct_count = 0
        for option_index, option in enumerate(options):
            expected_oid = chr(ord("A") + option_index)
            if isinstance(option, str):
                oid = expected_oid
                text = option.strip()
                correct = oid in correct_answers
            elif isinstance(option, dict):
                oid = str(option.get("id") or expected_oid).strip().upper()
                text = str(option.get("text") or option.get("label") or "").strip()
                correct = option.get("correct") is True or oid in correct_answers
            else:
                errors.append(f"{expected_id}: option {option_index + 1} invalid")
                continue
            if oid != expected_oid:
                errors.append(f"{expected_id}: option {option_index + 1} expected {expected_oid}, got {oid or '<empty>'}")
            if oid in seen_ids:
                errors.append(f"{expected_id}: duplicate option id {oid}")
            seen_ids.add(oid)
            folded = re.sub(r"\s+", " ", text).casefold()
            if not text:
                errors.append(f"{expected_id}: empty option {oid}")
            if folded in seen_texts:
                errors.append(f"{expected_id}: duplicate option text")
            seen_texts.add(folded)
            if correct:
                correct_count += 1
            normalized_options.append({"id": oid, "text": text, "correct": bool(correct)})

        if correct_count == len(normalized_options) and normalized_options:
            normalized_options[-1]["correct"] = False
            correct_count -= 1
        if correct_count < 1:
            errors.append(f"{expected_id}: expected at least 1 correct option")
        if correct_count >= 2:
            multi_correct += 1
        question["options"] = normalized_options
        question.pop("correctAnswers", None)
        question.pop("correct_answers", None)
        question.pop("answer", None)
        question.pop("q", None)
        question.pop("opts", None)
        question.pop("a", None)

    for difficulty, expected in DIFFICULTY_COUNTS.items():
        if counts[difficulty] != expected:
            errors.append(f"difficulty {difficulty}: expected {expected}, got {counts[difficulty]}")
    if multi_correct < MIN_MULTI_CORRECT:
        errors.append(f"expected at least {MIN_MULTI_CORRECT} multi-correct questions, got {multi_correct}")
    data["lectureId"] = str(lecture.get("id") or "")
    data["title"] = str(lecture.get("title") or "")
    data["category"] = str(lecture.get("category") or "")
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
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "thinking_budget": 0,
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
    (LOG_DIR / "replicate-mauritania-progress.json").write_text(
        json.dumps(progress, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def copy_to_netlify(output_path: Path, lecture: dict[str, Any]) -> None:
    training = str(lecture.get("training") or "")
    if not training:
        return
    destination = ROOT / "netlify-deploy" / "residanat-mauritania" / training.replace("/", os.sep)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(output_path, destination)


def run(limit: int, start: int, overwrite: bool, timeout: int, dry_run: bool, max_attempts: int, copy_netlify: bool) -> int:
    max_attempts = 1
    token = os.environ.get("REPLICATE_API_TOKEN", "").strip()
    if not token and not dry_run:
        log("Missing REPLICATE_API_TOKEN environment variable.")
        return 1

    lectures = load_lectures()
    selected = lectures[start : start + limit if limit else None]
    LOG_DIR.mkdir(exist_ok=True)
    (LOG_DIR / "replicate-mauritania-generation.log").write_text("", encoding="utf-8")

    failures: list[dict[str, Any]] = []
    done = 0
    total = len(selected)
    log(f"Starting {total} Mauritania quiz generations with {MODEL}.")
    write_progress(done, total, "", failures)

    for offset, lecture in enumerate(selected, start=start + 1):
        lecture_id = str(lecture.get("id") or "")
        title = str(lecture.get("title") or "")
        output_path = app_path(str(lecture.get("training") or f"data/training/{lecture_id}.json"))

        if output_path.exists() and not overwrite:
            try:
                existing = json.loads(output_path.read_text(encoding="utf-8-sig"))
                valid, _ = validate_quiz(existing, lecture)
            except Exception:
                valid = False
            if valid:
                done += 1
                if copy_netlify:
                    copy_to_netlify(output_path, lecture)
                log(f"SKIP {done}/{total} #{offset} {lecture_id} {title} - already valid.")
                write_progress(done, total, title, failures)
                continue

        pdf_text, source_path = source_text_for_lecture(lecture)
        if len(pdf_text) < 1000:
            failures.append({"lectureId": lecture_id, "title": title, "reason": f"too little extractable text or missing file: {source_path}"})
            log(f"FAIL #{offset} {lecture_id} {title} - missing/too little text.")
            write_progress(done, total, title, failures)
            continue

        prompt = render_prompt(lecture, compact_source_text(pdf_text))
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
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    if copy_netlify:
                        copy_to_netlify(output_path, lecture)
                    done += 1
                    success = True
                    log(f"DONE {done}/{total} #{offset} {lecture_id} {title} -> {output_path.name}.")
                    write_progress(done, total, title, failures)
                    break
                log(f"INVALID #{offset} {lecture_id} attempt {attempt}: {'; '.join(errors[:5])}")
                if attempt >= max_attempts:
                    break
                prompt += (
                    "\n\nCorrection obligatoire: la reponse precedente a echoue la validation. "
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
            log(f"FAIL #{offset} {lecture_id} {title} - no valid JSON after {max_attempts} attempts. Continuing.")
            continue

        time.sleep(1)

    log(f"Finished batch. Completed {done}/{total}. Failures: {len(failures)}.")
    write_progress(done, total, "", failures)
    return 0 if done + len(failures) == total else 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Mauritania quiz JSON files with Replicate Gemini.")
    parser.add_argument("--limit", type=int, default=0, help="Number of lectures to generate. Use 0 for all after start.")
    parser.add_argument("--start", type=int, default=0, help="Zero-based lecture offset.")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate existing files.")
    parser.add_argument("--timeout", type=int, default=900, help="Seconds to wait for each Replicate prediction.")
    parser.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS, help="Maximum attempts per lecture before stopping.")
    parser.add_argument("--copy-netlify", action="store_true", help="Copy valid generated quizzes into netlify-deploy.")
    parser.add_argument("--dry-run", action="store_true", help="Extract PDFs and build prompts without calling Replicate.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        raise SystemExit(run(args.limit, args.start, args.overwrite, args.timeout, args.dry_run, args.max_attempts, args.copy_netlify))
    except KeyboardInterrupt:
        log("Interrupted by user.")
        raise SystemExit(130)
