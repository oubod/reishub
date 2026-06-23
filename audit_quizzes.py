import argparse
import csv
import html
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TARGETS = (
    "quizzes/*.json",
    "data/quiz-bank.json",
    "residanat-mauritania/data/training/*.json",
)

PAGE_RE = re.compile(r"\b(?:pages?\s*\d+|p\.\s*\d+)\b")
TABLE_RE = re.compile(
    r"\b(?:tableau|figure|schema|annexe)\s*(?:[ivxlcdm]+|\d+)\b|"
    r"\b(?:selon|d apres)\s+(?:le\s+)?(?:tableau|schema|figure)\b"
)
COURSE_RE = re.compile(
    r"\b(?:objectifs?\s+pedagogiques?|mots?\s*[- ]\s*cles?|"
    r"selon\s+le\s+cours|d apres\s+le\s+cours|mentionnes?\s+dans\s+le\s+cours)\b"
)
GENERIC_RE = re.compile(
    r"\b(?:quelle\s+est\s+la\s+definition|quel\s+est\s+le\s+role\s+principal|"
    r"quels\s+sont\s+les\s+types|nature\s+fondamentale|"
    r"objectifs?\s+(?:du|de\s+la)\s+(?:traitement|prise\s+en\s+charge))\b"
)
MEDICAL_TERMS = (
    "achal", "acid", "adenopath", "adn", "ains", "aigue", "aldosterone", "alveol", "anatom", "anemie", "angiotensine", "antibiot", "arn", "arter", "asthm",
    "arthrite", "avc", "bacter", "basique", "biliaire", "bilirubin", "brul", "biolog", "bronch", "calcium", "calcem", "cancer", "card", "cellul",
    "caryotype", "cerebr", "chirurg", "chromosom", "clin", "coma", "confusion", "contracept", "coronar", "creatinin", "cristallo", "delirium", "dfg", "diagnostic", "diabet",
    "diarrh", "diu", "douleur", "duoden", "dyskal", "dysphag", "ecg", "electrolyt", "encephal", "endocrin", "enfant", "enzyme", "epilep", "estradiol", "examen",
    "filtration", "fracture", "gastr", "gene", "germe", "glomer", "glucagon", "glycem", "grossesse", "hepat", "hem", "histocompat", "hgpo", "hla", "hormon", "hta", "hydrat", "hyponatrem", "hypophy", "hypothalam", "imagerie",
    "ictere", "infection", "inflamm", "intestin", "intox", "irm", "lcr", "maladie", "medic",
    "mening", "metror", "mortalite", "myelinolyse", "muscle", "natr", "neuro", "obst", "oedeme", "oeil", "oesoph", "osm", "organe", "organophosph", "patient",
    "peau", "physiolog", "pilule", "plaquette", "potassium", "preeclamp", "progest", "prostagland", "psych", "pulmon", "pus", "renal", "rein", "respir", "sang",
    "scanner", "schiz", "sepsis", "septic", "septiq", "somatique", "spermicide", "spirometr", "stenose", "syndrome", "tampon", "tension", "therapeut", "thyroid",
    "tissu", "traitement", "trauma", "trisom", "trypsine", "tumeur", "ulcere", "uter", "urinaire", "vaccin", "vein", "vems",
)


def repair_mojibake(text):
    if "Ã" not in text and "â" not in text:
        return text
    try:
        return text.encode("latin1").decode("utf-8")
    except UnicodeError:
        return text


def fold(text):
    text = repair_mojibake(str(text))
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\s+", " ", text)


def question_text(q):
    options = " ".join(str(o.get("text", "")) for o in q.get("options", []))
    return " ".join(
        str(q.get(key, ""))
        for key in ("question", "scenario", "explanation")
    ) + " " + options


def iter_questions(path):
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    rows = data.get("questions", []) if isinstance(data, dict) else []
    for index, q in enumerate(rows, 1):
        if not isinstance(q, dict):
            continue
        lecture = " ".join(
            str(q.get(k) or data.get(k, ""))
            for k in ("lectureTitle", "title", "specialty", "category", "partie", "part")
            if isinstance(data, dict)
        )
        yield {
            "file": str(path.relative_to(ROOT)),
            "question_id": str(q.get("id") or f"q{index}"),
            "difficulty": fold(q.get("difficulty", "")),
            "question": str(q.get("question", "")).strip(),
            "search_text": fold(lecture + " " + question_text(q)),
        }


def flags(row):
    text = row["search_text"]
    found = []
    if PAGE_RE.search(text):
        found.append("hard: page reference")
    if TABLE_RE.search(text):
        found.append("hard: table/figure reference")
    if COURSE_RE.search(text):
        found.append("hard: course metadata")
    generic = row["difficulty"] == "facile" and GENERIC_RE.search(text)
    maybe_non_medical = not any(term in text for term in MEDICAL_TERMS)
    very_short = len(row["question"]) < 60 or len(row["question"].split()) < 7
    if very_short and (generic or maybe_non_medical):
        found.append("review: very short")
    if generic:
        found.append("review: facile + generic")
    if maybe_non_medical:
        found.append("review: maybe non-medical")
    return found


def suggestion(reasons):
    if any(r.startswith("hard:") for r in reasons):
        return "Remove or rewrite; avoid page/table/course-meta dependency."
    return "Review only; keep if it tests a real medical exam fact."


def audit():
    # ponytail: local regex audit first; use AI only on the short suspicious list.
    report = []
    parsed = 0
    questions = 0
    for pattern in TARGETS:
        for path in sorted(ROOT.glob(pattern)):
            parsed += 1
            try:
                source_rows = list(iter_questions(path))
            except json.JSONDecodeError as exc:
                report.append(
                    {
                        "file": str(path.relative_to(ROOT)),
                        "question id": "",
                        "reason": "hard: invalid JSON",
                        "question": f"JSON parse error: line {exc.lineno}, column {exc.colno}",
                        "suggested action": "Fix JSON before trusting this quiz file.",
                    }
                )
                continue
            for row in source_rows:
                questions += 1
                reasons = flags(row)
                if reasons:
                    report.append(
                        {
                            "file": row["file"],
                            "question id": row["question_id"],
                            "reason": "; ".join(reasons),
                            "question": repair_mojibake(row["question"]),
                            "suggested action": suggestion(reasons),
                        }
                    )
    return parsed, questions, report


def write_csv(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["file", "question id", "reason", "question", "suggested action"]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fields)
        writer.writeheader()
        writer.writerows(rows)


def write_html(rows, path, counts):
    path.parent.mkdir(parents=True, exist_ok=True)
    summary = "".join(f"<li>{html.escape(k)}: {v}</li>" for k, v in counts.items())
    body = "\n".join(
        "<tr>"
        f"<td>{html.escape(r['file'])}</td>"
        f"<td>{html.escape(r['question id'])}</td>"
        f"<td>{html.escape(r['reason'])}</td>"
        f"<td>{html.escape(r['question'])}</td>"
        f"<td>{html.escape(r['suggested action'])}</td>"
        "</tr>"
        for r in rows
    )
    path.write_text(
        "<!doctype html><meta charset='utf-8'><title>Quiz audit</title>"
        "<style>body{font-family:system-ui,Segoe UI,sans-serif;margin:24px}"
        "table{border-collapse:collapse;width:100%;font-size:13px}"
        "td,th{border:1px solid #ddd;padding:6px;vertical-align:top}"
        "th{position:sticky;top:0;background:#f7f7f7}</style>"
        "<h1>Quiz audit</h1>"
        f"<p>Suspicious rows: {len(rows)}</p><ul>{summary}</ul>"
        "<table><thead><tr><th>file</th><th>question id</th><th>reason</th>"
        "<th>question</th><th>suggested action</th></tr></thead>"
        f"<tbody>{body}</tbody></table>",
        encoding="utf-8",
    )


def reason_counts(rows):
    counts = Counter()
    for row in rows:
        for reason in row["reason"].split("; "):
            counts[reason] += 1
    return counts


def self_test():
    samples = [
        ("Voir page 5 du cours.", {"hard: page reference"}),
        ("Selon le Tableau I.", {"hard: table/figure reference"}),
        ("Quels sont les objectifs pédagogiques de ce cours ?", {"hard: course metadata"}),
        ("Capital of France?", {"review: very short", "review: maybe non-medical"}),
    ]
    for question, expected in samples:
        row = {
            "question": question,
            "difficulty": "facile",
            "search_text": fold(question),
        }
        assert expected <= set(flags(row)), question


def main():
    parser = argparse.ArgumentParser(description="Audit quiz JSON for low-value rows.")
    parser.add_argument("--csv", default="generation-logs/quiz-audit-report.csv")
    parser.add_argument("--html", default="generation-logs/quiz-audit-report.html")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        print("self-test ok")
        return

    parsed, questions, rows = audit()
    counts = reason_counts(rows)
    write_csv(rows, ROOT / args.csv)
    write_html(rows, ROOT / args.html, counts)
    print(f"Parsed files: {parsed}")
    print(f"Questions scanned: {questions}")
    print(f"Suspicious rows: {len(rows)}")
    for reason, count in counts.most_common():
        print(f"{reason}: {count}")
    print(f"CSV: {args.csv}")
    print(f"HTML: {args.html}")


if __name__ == "__main__":
    main()
