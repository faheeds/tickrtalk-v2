"""Create private local connection settings without printing credentials."""
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[2]
service_env = root / ".env.research"
app_env = root / ".env.local"
if service_env.exists():
    from dotenv import dotenv_values
    token = dotenv_values(service_env).get("RESEARCH_API_KEY")
    if not token or len(token) < 32:
        raise SystemExit("Existing .env.research needs a valid RESEARCH_API_KEY; it was not overwritten.")
else:
    from tradingagents.default_config import DEFAULT_CONFIG
    token = secrets.token_urlsafe(48)
    service_env.write_text(
        "# Private research service settings. Never commit this file.\n"
        f"RESEARCH_API_KEY={token}\n"
        "TRADINGAGENTS_LLM_PROVIDER=openai\n"
        f"TRADINGAGENTS_DEEP_THINK_LLM={DEFAULT_CONFIG['deep_think_llm']}\n"
        f"TRADINGAGENTS_QUICK_THINK_LLM={DEFAULT_CONFIG['quick_think_llm']}\n"
        "OPENAI_API_KEY=\n"
        "RESEARCH_TIMEOUT_SECONDS=1200\n"
        "RESEARCH_DAILY_LIMIT=20\n", encoding="utf-8")
existing = app_env.read_text(encoding="utf-8") if app_env.exists() else ""
updates = {"RESEARCH_API_URL": "http://127.0.0.1:8001", "RESEARCH_API_KEY": token, "ENABLE_LOCAL_RESEARCH": "true"}
lines = [line for line in existing.splitlines() if not any(line.startswith(key + "=") for key in updates)]
app_env.write_text("\n".join(lines) + "\n" + "\n".join(key + "=" + value for key, value in updates.items()) + "\n", encoding="utf-8")
print("Private local research configuration prepared. Add your provider key to .env.research.")
