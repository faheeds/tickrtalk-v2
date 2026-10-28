"""Token-protected SQLite queue with one isolated, cancellable research worker."""
from contextlib import contextmanager
import hmac
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from reports import coverage_warnings

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env.research"
if ENV_FILE.exists():
    from dotenv import load_dotenv
    load_dotenv(ENV_FILE)
DATA = Path(os.getenv("RESEARCH_DATA_DIR", str(ROOT / ".research-data"))).resolve()
TOKEN = os.getenv("RESEARCH_API_KEY", "")
REPO = Path(os.getenv("TRADINGAGENTS_REPO", str(ROOT.parent / "repo-review" / "TradingAgents_TauricResearch"))).resolve()
PROVIDER_KEYS = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "google": "GOOGLE_API_KEY",
                 "deepseek": "DEEPSEEK_API_KEY", "xai": "XAI_API_KEY", "openrouter": "OPENROUTER_API_KEY",
                 "groq": "GROQ_API_KEY", "mistral": "MISTRAL_API_KEY", "nvidia": "NVIDIA_API_KEY"}

def now():
    return datetime.now(timezone.utc).isoformat()

@contextmanager
def connection():
    db = sqlite3.connect(DATA / "jobs.sqlite", timeout=20)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()

def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    with connection() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, symbol TEXT NOT NULL, analysis_date TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, error TEXT, report TEXT, saved INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(owner, created DESC)")
        db.execute("UPDATE jobs SET status='failed', stage='Interrupted', error='The service restarted during analysis. You can run it again.', updated=? WHERE status='running'", (now(),))

def readiness():
    missing = []
    if len(TOKEN) < 32:
        missing.append("RESEARCH_API_KEY (at least 32 characters)")
    for module in ("tradingagents", "langgraph", "langchain_openai", "yfinance"):
        if importlib.util.find_spec(module) is None:
            missing.append("Python dependency: " + module)
    package = importlib.util.find_spec("tradingagents")
    if package and package.origin and not Path(package.origin).resolve().is_relative_to(REPO):
        missing.append("Install TradingAgents from the configured repository checkout")
    provider = os.getenv("TRADINGAGENTS_LLM_PROVIDER", "")
    for setting in ("TRADINGAGENTS_LLM_PROVIDER", "TRADINGAGENTS_DEEP_THINK_LLM", "TRADINGAGENTS_QUICK_THINK_LLM"):
        if not os.getenv(setting):
            missing.append(setting)
    if provider in PROVIDER_KEYS and not os.getenv(PROVIDER_KEYS[provider]):
        missing.append(PROVIDER_KEYS[provider])
    elif provider == "ollama":
        if not os.getenv("TRADINGAGENTS_LLM_BACKEND_URL"):
            missing.append("TRADINGAGENTS_LLM_BACKEND_URL")
    elif provider and provider not in PROVIDER_KEYS:
        missing.append("Supported provider for this adapter: " + ", ".join([*PROVIDER_KEYS, "ollama"]))
    return {"ready": not missing, "missing": missing, "engine": "TradingAgents",
            "provider": provider or None, "deepModel": os.getenv("TRADINGAGENTS_DEEP_THINK_LLM") or None,
            "quickModel": os.getenv("TRADINGAGENTS_QUICK_THINK_LLM") or None}

def provenance():
    try:
        commit = subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True, timeout=10).strip()
        dirty = bool(subprocess.check_output(["git", "-C", str(REPO), "status", "--porcelain"], text=True, timeout=10).strip())
    except (OSError, subprocess.SubprocessError):
        commit, dirty = "unknown", True
    health = readiness()
    return {"repository": "https://github.com/faheeds/TradingAgents_TauricResearch", "commit": commit,
            "workingTreeModified": dirty, "provider": health["provider"], "deepModel": health["deepModel"],
            "quickModel": health["quickModel"]}

def public_job(row, detail=False):
    job = {"id": row["id"], "symbol": row["symbol"], "analysisDate": row["analysis_date"],
           "status": row["status"], "stage": row["stage"], "createdAt": row["created"],
           "updatedAt": row["updated"], "error": row["error"], "saved": bool(row["saved"])}
    if detail:
        job["report"] = json.loads(row["report"]) if row["report"] else None
    return job

class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

def create_job(owner, symbol):
    symbol = symbol.strip().upper() if isinstance(symbol, str) else ""
    if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,19}", symbol):
        raise APIError(400, "Enter a valid stock symbol.")
    if not readiness()["ready"]:
        raise APIError(503, "TradingAgents needs service configuration before analysis can run.")
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT * FROM jobs WHERE owner=? AND status IN ('queued','running')", (owner,)).fetchone()
        if existing:
            raise APIError(409, "You already have an active research job. Open it or cancel it first.")
        count = db.execute("SELECT count(*) FROM jobs WHERE created>=? AND owner=?", (now()[:10], owner)).fetchone()[0]
        if count >= int(os.getenv("RESEARCH_DAILY_LIMIT", "20")):
            raise APIError(429, "Your daily research limit has been reached.")
        if db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0] >= 20:
            raise APIError(429, "The research queue is full. Please try again later.")
        job_id = str(uuid.uuid4())
        stamp = now()
        db.execute("INSERT INTO jobs(id,owner,symbol,analysis_date,status,stage,created,updated) VALUES (?,?,?,?,?,?,?,?)",
                   (job_id, owner, symbol, stamp[:10], "queued", "Waiting for an analyst", stamp, stamp))
        return public_job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone(), True)

def update(job_id, **fields):
    fields["updated"] = now()
    with connection() as db:
        db.execute("UPDATE jobs SET " + ",".join(key + "=?" for key in fields) + " WHERE id=? AND status='running'", (*fields.values(), job_id))

def worker(stop=None, runner_script=None):
    stop = stop or threading.Event()
    while not stop.is_set():
        with connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='running',stage='Starting analyst team',updated=? WHERE id=?", (now(), row["id"]))
        if not row:
            stop.wait(0.5)
            continue
        job_dir = DATA / row["id"]
        job_dir.mkdir(exist_ok=True)
        (job_dir / "request.json").write_text(json.dumps({"symbol": row["symbol"], "analysisDate": row["analysis_date"], "provenance": provenance()}), encoding="utf-8")
        proc = None
        try:
            with (job_dir / "worker.log").open("wb") as log:
                env = dict(os.environ, PYTHONIOENCODING="utf-8")
                proc = subprocess.Popen([sys.executable, str(runner_script or Path(__file__).with_name("runner.py")), str(job_dir)], stdout=log, stderr=log, env=env)
                deadline = time.monotonic() + int(os.getenv("RESEARCH_TIMEOUT_SECONDS", "1200"))
                while proc.poll() is None:
                    if stop.is_set():
                        proc.kill()
                        proc.wait()
                        raise RuntimeError("Service stopping")
                    with connection() as db:
                        status = db.execute("SELECT status FROM jobs WHERE id=?", (row["id"],)).fetchone()[0]
                    if status == "cancelled":
                        proc.kill()
                        proc.wait()
                        break
                    if time.monotonic() > deadline:
                        proc.kill()
                        proc.wait()
                        raise TimeoutError()
                    try:
                        progress = json.loads((job_dir / "progress.json").read_text(encoding="utf-8"))
                        update(row["id"], stage=progress["stage"])
                    except (OSError, ValueError, KeyError):
                        pass
                    time.sleep(0.5)
                if proc.returncode != 0:
                    raise RuntimeError("Research worker stopped")
            report = json.loads((job_dir / "report.json").read_text(encoding="utf-8"))
            coverage = coverage_warnings((job_dir / "worker.log").read_text(encoding="utf-8", errors="replace"))
            report["coverageWarnings"] = coverage
            report.setdefault("warnings", []).extend(coverage)
            if not report.get("sections", {}).get("decision", {}).get("content"):
                raise RuntimeError("Incomplete research")
            update(row["id"], status="completed", stage="Report ready", report=json.dumps(report))
        except Exception as exc:
            if proc and proc.poll() is None:
                proc.kill()
                proc.wait()
            error = "Analysis timed out. You can run it again." if isinstance(exc, TimeoutError) else "The analyst team could not complete this report. Check the private service log and retry."
            update(row["id"], status="failed", stage="Analysis stopped", error=error)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def dispatch(self):
        if len(TOKEN) < 32 or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            raise APIError(401, "Unauthorized")
        url = urlsplit(self.path)
        if url.path == "/health" and self.command == "GET":
            return 200, readiness()
        owner = self.headers.get("X-Research-User", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", owner):
            raise APIError(400, "A trusted user identity is required.")
        if url.path != "/jobs":
            raise APIError(404, "Not found")
        job_id = parse_qs(url.query).get("id", [None])[0]
        if self.command == "POST":
            return 202, {"job": create_job(owner, self.body().get("symbol"))}
        with connection() as db:
            if job_id:
                row = db.execute("SELECT * FROM jobs WHERE id=? AND owner=?", (job_id, owner)).fetchone()
                if not row:
                    raise APIError(404, "Report not found")
                if self.command == "GET":
                    return 200, {"job": public_job(row, True)}
                if self.command == "DELETE":
                    db.execute("UPDATE jobs SET status='cancelled',stage='Cancelled',updated=? WHERE id=? AND owner=? AND status IN ('queued','running')", (now(), job_id, owner))
                    return 200, {"job": public_job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone(), True)}
                if self.command == "PATCH":
                    saved = self.body().get("saved")
                    if not isinstance(saved, bool) or row["status"] != "completed":
                        raise APIError(400, "Only completed reports can be saved.")
                    db.execute("UPDATE jobs SET saved=?,updated=? WHERE id=? AND owner=?", (int(saved), now(), job_id, owner))
                    return 200, {"job": public_job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone(), True)}
            elif self.command == "GET":
                return 200, {"jobs": [public_job(row) for row in db.execute("SELECT * FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 100", (owner,))]}
        raise APIError(405, "Method not allowed")

    def body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError()
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError()
            return body
        except (ValueError, json.JSONDecodeError):
            raise APIError(400, "Invalid request body")

    def handle_request(self):
        try:
            status, body = self.dispatch()
            self.respond(status, body)
        except APIError as exc:
            self.respond(exc.status, {"error": exc.message})
        except Exception:
            self.respond(500, {"error": "Research service error"})

    do_GET = do_POST = do_DELETE = do_PATCH = handle_request

if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise SystemExit("Set a private RESEARCH_API_KEY of at least 32 characters in .env.research.")
    initialize()
    server = ThreadingHTTPServer((os.getenv("RESEARCH_BIND", "127.0.0.1"), int(os.getenv("RESEARCH_PORT", "8001"))), Handler)
    stop = threading.Event()
    worker_thread = threading.Thread(target=worker, args=(stop,), daemon=True)
    worker_thread.start()
    print("TradingAgents research service listening on port " + str(server.server_port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        worker_thread.join(timeout=5)
        server.server_close()
