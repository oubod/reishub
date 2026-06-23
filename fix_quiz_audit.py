import argparse
import json
from collections import Counter
from pathlib import Path

from audit_quizzes import (
    COURSE_RE,
    GENERIC_RE,
    PAGE_RE,
    ROOT,
    TABLE_RE,
    TARGETS,
    fold,
    question_text,
)


EMPTY_STUBS = {
    "pm-49": {
        "lectureId": "pm-49",
        "title": "Hysterie",
        "category": "Pathologies Medicales",
        "questions": [],
    },
    "pm-50": {
        "lectureId": "pm-50",
        "title": "Lutte contre l'infection hospitaliere",
        "category": "Pathologies Medicales",
        "questions": [],
    },
}

BACKUP_ROOT = ROOT / "generation-logs" / "quiz-fix-backup"


def load_json(path):
    text = path.read_text(encoding="utf-8-sig")
    if text.strip():
        return json.loads(text), False
    stub = EMPTY_STUBS.get(path.stem)
    if stub:
        return dict(stub), True
    raise ValueError("empty JSON without known stub")


def dump_json(path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def backup_file(path):
    backup = BACKUP_ROOT / path.relative_to(ROOT)
    if backup.exists():
        return
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_bytes(path.read_bytes())


def joined_text(data, q):
    lecture = " ".join(
        str(q.get(k) or data.get(k, ""))
        for k in ("lectureTitle", "title", "specialty", "category", "partie", "part")
    )
    return fold(lecture + " " + question_text(q))


def drop_reason(data, q):
    text = joined_text(data, q)
    if PAGE_RE.search(text):
        return "page reference"
    if TABLE_RE.search(text):
        return "table/figure reference"
    if COURSE_RE.search(text):
        return "course metadata"
    if fold(q.get("difficulty", "")) == "facile" and GENERIC_RE.search(text):
        return "easy generic"
    return ""


def fix_file(path, apply):
    try:
        data, made_stub = load_json(path)
    except Exception as exc:
        return Counter({f"unfixed parse error: {path.relative_to(ROOT)}": 1}), 0

    if not isinstance(data, dict):
        return Counter(), 0

    questions = data.get("questions")
    if not isinstance(questions, list):
        if apply and made_stub:
            dump_json(path, data)
        return Counter({"empty stub fixed": 1}) if made_stub else Counter(), 0

    kept = []
    counts = Counter()
    for q in questions:
        if not isinstance(q, dict):
            kept.append(q)
            continue
        reason = drop_reason(data, q)
        if reason:
            counts[reason] += 1
        else:
            kept.append(q)

    if apply and (made_stub or len(kept) != len(questions)):
        backup_file(path)
        data["questions"] = kept
        if "questionCount" in data:
            data["questionCount"] = len(kept)
        dump_json(path, data)
    if made_stub:
        counts["empty stub fixed"] += 1
    return counts, len(questions) - len(kept)


def main():
    parser = argparse.ArgumentParser(description="Remove obvious low-value quiz rows.")
    parser.add_argument("--apply", action="store_true", help="write changes")
    args = parser.parse_args()

    totals = Counter()
    changed_files = 0
    removed = 0
    seen = set()
    for pattern in TARGETS:
        for path in sorted(ROOT.glob(pattern)):
            if path in seen:
                continue
            seen.add(path)
            counts, file_removed = fix_file(path, args.apply)
            if counts:
                totals.update(counts)
            if file_removed:
                changed_files += 1
                removed += file_removed

    mode = "APPLIED" if args.apply else "DRY RUN"
    print(mode)
    print(f"Files changed: {changed_files}")
    print(f"Questions removed: {removed}")
    for reason, count in totals.most_common():
        print(f"{reason}: {count}")


if __name__ == "__main__":
    main()
