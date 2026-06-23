import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "netlify-deploy"

ROOT_FILES = [
    "index.html",
    "admin.html",
    "tunis.html",
    "login-tunis.html",
    "auth-tunis.js",
    "manifest.webmanifest",
    "sw.js",
    "_headers",
    "_redirects",
    "logo.png",
    "favicon.ico",
]

DIRS_TO_COPY = [
    "assets",
    "pdfs",
    "quizzes",
    "exams",
    "clinical-cases",
]

DATA_FILES = [
    "lectures.json",
    "quiz-bank.json",
    "series-cycle-ecn-2025.json",
]

MAURITANIA_ROOT_FILES = [
    "index.html",
    "mauritania-tunis-lite.html",
    "login.html",
    "instructions.html",
    "mobile_pdf_viewer.html",
    "manifest.json",
    "sw.js",
    "favicon.ico",
]

MAURITANIA_DIRS_TO_COPY = [
    "css",
    "js",
    "images",
    "data",
]


def copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def copy_dir(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    for name in ROOT_FILES:
        copy_file(ROOT / name, OUT / name)

    for name in DIRS_TO_COPY:
        copy_dir(ROOT / name, OUT / name)

    (OUT / "data").mkdir()
    for name in DATA_FILES:
        copy_file(ROOT / "data" / name, OUT / "data" / name)

    mauritania_src = ROOT / "residanat-mauritania"
    mauritania_out = OUT / "residanat-mauritania"
    mauritania_out.mkdir()
    for name in MAURITANIA_ROOT_FILES:
        copy_file(mauritania_src / name, mauritania_out / name)
    for name in MAURITANIA_DIRS_TO_COPY:
        copy_dir(mauritania_src / name, mauritania_out / name)

    readme = OUT / "README-NETLIFY.txt"
    readme.write_text(
        "Drag this folder to Netlify Drop.\n"
        "Included: portal shell, Tunis app, Mauritania app, PWA assets, PDFs, quizzes, exams, clinical cases.\n"
        "Excluded: .env, Gemini logs/scripts, and the large ECN series folder.\n",
        encoding="utf-8",
    )

    total = sum(path.stat().st_size for path in OUT.rglob("*") if path.is_file())
    print(f"Prepared {OUT} ({total / 1024 / 1024:.2f} MB)")


if __name__ == "__main__":
    main()
