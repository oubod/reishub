import json
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from json_repair import loads as repair_json_loads
from google import genai
from google.genai import types


ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
LECTURES_PATH = ROOT / "data" / "lectures.json"
PROMPT_PATH = ROOT / "prompt.md"
LOG_DIR = ROOT / "generation-logs"
PROGRESS_PATH = LOG_DIR / "quiz-generation-progress.json"
RUN_LOG_PATH = LOG_DIR / "quiz-generation.log"
FAILURES_PATH = LOG_DIR / "quiz-generation-failures.json"

DIFFICULTY_COUNTS = {
    "facile": 15,
    "intermediaire": 20,
    "difficile": 15,
}

RATE_LIMIT_MARKERS = (
    "429",
    "quota",
    "rate limit",
    "rate_limit",
    "resource_exhausted",
    "exceeded",
    "requests per",
    "tokens per",
    "free tier",
)

MODEL_UNAVAILABLE_MARKERS = (
    "404",
    "not found",
    "not supported",
    "unsupported",
    "permission",
    "403",
    "denied",
)


@dataclass
class Credential:
    key_name: str
    api_key: str


@dataclass
class Attempt:
    lecture_id: str
    title: str
    quiz_path: Path
    pdf_path: Path
    key_name: str
    model: str
    status: str
    detail: str = ""


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(message: str) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    line = f"[{now()}] {message}"
    print(line, flush=True)
    with RUN_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_lectures() -> list[dict[str, Any]]:
    data = json.loads(LECTURES_PATH.read_text(encoding="utf-8-sig"))
    return data.get("lectures", [])


def render_prompt(template: str, lecture: dict[str, Any]) -> str:
    replacements = {
        "{{lectureId}}": str(lecture.get("id") or lecture.get("number") or ""),
        "{{title}}": str(lecture.get("title") or ""),
        "{{lectureNumber}}": str(lecture.get("number") or ""),
        "{{pdfPath}}": str(lecture.get("pdf") or ""),
        "{{targetQuizPath}}": str(lecture.get("quiz") or ""),
    }
    prompt = template
    for placeholder, value in replacements.items():
        prompt = prompt.replace(placeholder, value)
    return prompt


def extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
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
        if start == -1 or end == -1 or end <= start:
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
    raw = raw.replace("édiaire", "ediaire")
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

    ids = set()
    counts = {key: 0 for key in DIFFICULTY_COUNTS}
    for index, question in enumerate(questions, start=1):
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

        options = question.get("options")
        if not isinstance(options, list) or len(options) < 4:
            errors.append(f"{qid or expected_id}: expected at least 4 options")
            continue

        correct_count = 0
        seen_option_ids = set()
        for option_index, option in enumerate(options):
            oid = str(option.get("id", "")).strip().upper()
            text = str(option.get("text", "")).strip()
            if not oid:
                errors.append(f"{qid or expected_id}: option {option_index + 1} missing id")
            if oid in seen_option_ids:
                errors.append(f"{qid or expected_id}: duplicate option id {oid}")
            seen_option_ids.add(oid)
            if not text:
                errors.append(f"{qid or expected_id}: option {oid or option_index + 1} empty text")
            if option.get("correct") is True:
                correct_count += 1
            elif option.get("correct") is False:
                pass
            else:
                errors.append(f"{qid or expected_id}: option {oid or option_index + 1} correct must be boolean")
        if correct_count < 1:
            errors.append(f"{qid or expected_id}: no correct option")

    for difficulty, expected in DIFFICULTY_COUNTS.items():
        if counts[difficulty] != expected:
            errors.append(f"difficulty {difficulty}: expected {expected}, got {counts[difficulty]}")

    expected_id = str(lecture.get("id") or lecture.get("number") or "")
    expected_title = str(lecture.get("title") or "")
    data["lectureId"] = expected_id
    data["title"] = expected_title
    return not errors, errors


def quiz_is_complete(path: Path, lecture: dict[str, Any]) -> bool:
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return False
    valid, _ = validate_quiz(data, lecture)
    return valid


def classify_error(error: Exception) -> str:
    message = str(error).lower()
    if any(marker in message for marker in RATE_LIMIT_MARKERS):
        return "rate_limit"
    if any(marker in message for marker in MODEL_UNAVAILABLE_MARKERS):
        return "model_unavailable"
    return "error"


def concise_error(error: Exception) -> str:
    message = re.sub(r"\s+", " ", str(error)).strip()
    message = re.sub(r"key=[A-Za-z0-9_-]+", "key=<hidden>", message)
    return message[:500]


def write_progress(done: int, total: int, current: str, failures: list[dict[str, Any]], exhausted: list[str]) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    progress = {
        "updatedAt": now(),
        "done": done,
        "total": total,
        "remaining": max(total - done, 0),
        "current": current,
        "failures": len(failures),
        "exhausted": exhausted,
    }
    PROGRESS_PATH.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")
    FAILURES_PATH.write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")


def advance_slot(key_index: int, model_index: int, models: list[str]) -> tuple[int, int, bool]:
    old_key_index = key_index
    model_index += 1
    if model_index >= len(models):
        key_index += 1
        model_index = 0
    return key_index, model_index, key_index != old_key_index


def generate_with_gemini(client: genai.Client, model: str, pdf_path: Path, prompt: str) -> dict[str, Any]:
    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=pdf_path.read_bytes(), mime_type="application/pdf"),
            prompt,
        ],
        config=types.GenerateContentConfig(
            temperature=0.15,
            top_p=0.85,
            response_mime_type="application/json",
            max_output_tokens=32768,
        ),
    )
    text = response.text or ""
    if not text.strip():
        raise RuntimeError("empty Gemini response")
    return extract_json(text)


def main() -> int:
    env = load_env(ENV_PATH)
    credentials = [
        Credential(name, env.get(name, ""))
        for name in ("GEMINI_API_KEY_1", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3")
        if env.get(name, "").strip()
    ]
    models = [item.strip() for item in env.get("GEMINI_MODEL_ORDER", "gemini-2.5-flash").split(",") if item.strip()]

    if not credentials:
        log("No Gemini API keys found in .env.")
        return 1
    if not models:
        log("No Gemini models configured in .env.")
        return 1

    lectures = load_lectures()
    prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    failures: list[dict[str, Any]] = []
    exhausted: list[str] = []
    done = 0
    total = len(lectures)
    LOG_DIR.mkdir(exist_ok=True)
    RUN_LOG_PATH.write_text("", encoding="utf-8")

    log(f"Starting quiz generation for {total} lectures with {len(credentials)} API keys and {len(models)} models.")
    write_progress(done, total, "", failures, exhausted)

    active_key_index = 0
    active_model_index = 0
    clients: dict[str, genai.Client] = {}

    for lecture in lectures:
        lecture_id = str(lecture.get("id") or lecture.get("number") or "")
        title = str(lecture.get("title") or "")
        quiz_path = ROOT / str(lecture.get("quiz"))
        pdf_path = ROOT / str(lecture.get("pdf"))

        if quiz_is_complete(quiz_path, lecture):
            done += 1
            log(f"SKIP {done}/{total} {lecture_id} {title} - quiz already complete.")
            write_progress(done, total, title, failures, exhausted)
            continue

        if not pdf_path.exists():
            failures.append({"lectureId": lecture_id, "title": title, "reason": f"missing PDF: {pdf_path}"})
            log(f"FAIL {done + 1}/{total} {lecture_id} {title} - missing PDF.")
            write_progress(done, total, title, failures, exhausted)
            continue

        prompt = render_prompt(prompt_template, lecture)
        success = False
        attempt_failures: list[dict[str, Any]] = []

        while active_key_index < len(credentials) and not success:
            credential = credentials[active_key_index]
            model = models[active_model_index]
            client = clients.get(credential.key_name)
            if client is None:
                client = genai.Client(api_key=credential.api_key)
                clients[credential.key_name] = client

            attempt_label = f"{credential.key_name}/{model}"
            log(f"START {done + 1}/{total} {lecture_id} {title} using {attempt_label}.")
            write_progress(done, total, f"{lecture_id} {title} ({attempt_label})", failures, exhausted)

            validation_errors: list[str] = []
            slot_changed = False
            for retry in range(1, 4):
                try:
                    data = generate_with_gemini(client, model, pdf_path, prompt)
                    valid, validation_errors = validate_quiz(data, lecture)
                    if valid:
                        quiz_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                        done += 1
                        success = True
                        log(f"DONE {done}/{total} {lecture_id} {title} using {attempt_label}.")
                        write_progress(done, total, title, failures, exhausted)
                        break
                    log(f"RETRY {lecture_id} {title} invalid JSON content on try {retry}: {'; '.join(validation_errors[:4])}")
                    prompt += "\n\nCorrection stricte: ta réponse précédente ne respecte pas le schéma ou les contraintes. Retourne de nouveau uniquement le JSON valide avec exactement 50 questions et la distribution demandée."
                    if retry == 3:
                        attempt_failures.append({
                            "key": credential.key_name,
                            "model": model,
                            "reason": "; ".join(validation_errors[:10]),
                        })
                        active_key_index, active_model_index, changed_key = advance_slot(active_key_index, active_model_index, models)
                        slot_changed = True
                        if changed_key:
                            log(f"SWITCH API KEY to index {active_key_index + 1}.")
                        else:
                            log(f"SWITCH MODEL after invalid content to {models[active_model_index] if active_key_index < len(credentials) else '<none>'}.")
                    else:
                        time.sleep(6)
                except Exception as error:
                    kind = classify_error(error)
                    detail = concise_error(error)
                    if kind == "rate_limit":
                        exhausted.append(f"{attempt_label}: rate limit")
                        log(f"LIMIT {lecture_id} {title} on {attempt_label}: switching model/key.")
                        active_key_index, active_model_index, changed_key = advance_slot(active_key_index, active_model_index, models)
                        slot_changed = True
                        if changed_key:
                            log(f"SWITCH API KEY to index {active_key_index + 1}.")
                        write_progress(done, total, title, failures, exhausted)
                        break
                    if kind == "model_unavailable":
                        exhausted.append(f"{attempt_label}: unavailable")
                        log(f"MODEL SKIP {attempt_label}: {detail}")
                        active_key_index, active_model_index, changed_key = advance_slot(active_key_index, active_model_index, models)
                        slot_changed = True
                        if changed_key:
                            log(f"SWITCH API KEY to index {active_key_index + 1}.")
                        write_progress(done, total, title, failures, exhausted)
                        break
                    log(f"RETRY {lecture_id} {title} error on try {retry}: {detail}")
                    if retry == 3:
                        attempt_failures.append({
                            "key": credential.key_name,
                            "model": model,
                            "reason": detail,
                        })
                        active_key_index, active_model_index, changed_key = advance_slot(active_key_index, active_model_index, models)
                        slot_changed = True
                        if changed_key:
                            log(f"SWITCH API KEY to index {active_key_index + 1}.")
                        else:
                            log(f"SWITCH MODEL after repeated errors to {models[active_model_index] if active_key_index < len(credentials) else '<none>'}.")
                    else:
                        time.sleep(8)

            if not success and slot_changed:
                write_progress(done, total, title, failures, exhausted)

        if not success and active_key_index >= len(credentials):
            failures.append({
                "lectureId": lecture_id,
                "title": title,
                "quiz": str(lecture.get("quiz")),
                "pdf": str(lecture.get("pdf")),
                "reason": "all API keys/models exhausted",
                "attempts": attempt_failures,
            })
            log("STOP all API keys/models exhausted.")
            write_progress(done, total, title, failures, exhausted)
            break

        time.sleep(2)

    log(f"Finished. Completed {done}/{total}. Failures: {len(failures)}.")
    write_progress(done, total, "", failures, exhausted)
    return 0 if done == total else 2


if __name__ == "__main__":
    raise SystemExit(main())
