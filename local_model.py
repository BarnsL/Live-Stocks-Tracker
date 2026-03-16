"""Local Qwen2.5-Coder 1.5B inference wrapper.

Communicates with Ollama (localhost:11434) by default.
Used for minor, narrowly-scoped code edits only.
"""

import json
import logging
import os
import time
import urllib.error
import urllib.request

logger = logging.getLogger("local_model")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

# ── Configuration ──

_DEFAULT_CONFIG = {
    "enabled": True,
    "model": "qwen2.5-coder:1.5b",
    "endpoint": "http://localhost:11434/api/generate",
    "timeout": 90,
    "max_input_chars": 8000,
    "max_output_chars": 10000,
    "max_input_lines": 300,
    "max_output_lines": 350,
    "max_diff_ratio": 0.6,  # reject if >60% of lines changed
}

_CONFIG_FILE = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")),
    "LiveStocksTracker",
    "local_model_config.json",
)


def load_config() -> dict:
    """Load config from disk, merged with defaults."""
    cfg = dict(_DEFAULT_CONFIG)
    try:
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            overrides = json.load(f)
        if isinstance(overrides, dict):
            for k in _DEFAULT_CONFIG:
                if k in overrides:
                    cfg[k] = overrides[k]
    except (OSError, json.JSONDecodeError):
        pass
    return cfg


def save_config(overrides: dict):
    """Persist config overrides to disk."""
    os.makedirs(os.path.dirname(_CONFIG_FILE), exist_ok=True)
    current = load_config()
    current.update(overrides)
    with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)


# ── Prompt Engineering ──

EDIT_SYSTEM_PROMPT = (
    "You are a precise code editor. You make only the smallest valid change "
    "needed to fulfill the user's instruction.\n\n"
    "Rules:\n"
    "- Make ONLY the requested change. Do not add unrelated improvements.\n"
    "- Preserve all unchanged code EXACTLY as-is, including whitespace and formatting.\n"
    "- Do not change formatting or style outside the edited region.\n"
    "- Return ONLY the complete modified code. No explanations, no markdown fences, "
    "no commentary before or after the code.\n"
    "- If the instruction is unclear or cannot be applied, return the original code unchanged.\n"
    "- Keep edits minimal — change as few lines as possible.\n"
    "- Do not add comments explaining your changes.\n"
    "- Do not remove existing code unless explicitly asked.\n"
)


def _build_prompt(instruction: str, code: str) -> str:
    return (
        f"{EDIT_SYSTEM_PROMPT}\n"
        f"### Instruction:\n{instruction}\n\n"
        f"### Original Code:\n{code}\n\n"
        f"### Modified Code:\n"
    )


# ── Ollama Communication ──

def _call_ollama(prompt: str, cfg: dict) -> str:
    """Send a generation request to Ollama and return the full response text."""
    payload = json.dumps({
        "model": cfg["model"],
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "top_p": 0.9,
            "num_predict": min(cfg.get("max_output_chars", 10000) // 3, 4096),
            "stop": ["### Instruction:", "### Original Code:", "```"],
        },
    }).encode()

    req = urllib.request.Request(
        cfg["endpoint"],
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout"]) as resp:
            body = json.loads(resp.read().decode())
            return body.get("response", "")
    except urllib.error.URLError as e:
        raise ConnectionError(f"Cannot reach Ollama at {cfg['endpoint']}: {e}") from e
    except TimeoutError:
        raise TimeoutError(f"Ollama request timed out after {cfg['timeout']}s")


def check_ollama_status(cfg: dict = None) -> dict:
    """Check if Ollama is reachable and the model is available."""
    cfg = cfg or load_config()
    # Ollama tags endpoint
    base = cfg["endpoint"].rsplit("/api/", 1)[0]
    tags_url = f"{base}/api/tags"
    try:
        req = urllib.request.Request(tags_url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            models = [m.get("name", "") for m in data.get("models", [])]
            model_name = cfg["model"]
            # Ollama may list as "qwen2.5-coder:1.5b" or with a hash suffix
            found = any(model_name in m for m in models)
            return {
                "online": True,
                "model_available": found,
                "model": model_name,
                "available_models": models,
            }
    except Exception as e:
        return {"online": False, "model_available": False, "error": str(e)}


# ── Validation ──

def _validate_input(instruction: str, code: str, cfg: dict) -> str | None:
    """Return an error string if inputs are out of bounds, else None."""
    if not instruction or not instruction.strip():
        return "Instruction cannot be empty."
    if not code or not code.strip():
        return "Code snippet cannot be empty."
    if len(code) > cfg["max_input_chars"]:
        return f"Code too long ({len(code)} chars). Max is {cfg['max_input_chars']}."
    line_count = code.count("\n") + 1
    if line_count > cfg["max_input_lines"]:
        return f"Code has too many lines ({line_count}). Max is {cfg['max_input_lines']}."
    if len(instruction) > 1000:
        return "Instruction too long (max 1000 chars)."
    return None


def _validate_output(original: str, output: str, cfg: dict) -> str | None:
    """Return an error string if output is invalid, else None."""
    if not output or not output.strip():
        return "Model returned empty output."
    if len(output) > cfg["max_output_chars"]:
        return f"Output too long ({len(output)} chars). Rejected for safety."
    out_lines = output.strip().splitlines()
    if len(out_lines) > cfg["max_output_lines"]:
        return f"Output has too many lines ({len(out_lines)}). Rejected."

    # Check diff ratio — reject if too many lines changed
    orig_lines = original.strip().splitlines()
    if orig_lines:
        import difflib
        matcher = difflib.SequenceMatcher(None, orig_lines, out_lines)
        ratio = matcher.ratio()
        # ratio close to 1.0 = very similar; close to 0.0 = very different
        max_diff = cfg.get("max_diff_ratio", 0.6)
        if ratio < (1.0 - max_diff):
            return (
                f"Edit too large (similarity {ratio:.0%}, threshold {1.0 - max_diff:.0%}). "
                "The model may have rewritten unrelated code. Rejected."
            )

    return None


def _clean_output(raw: str) -> str:
    """Strip markdown fences and trailing commentary from model output."""
    text = raw.strip()
    # Remove leading ```lang and trailing ```
    if text.startswith("```"):
        first_nl = text.find("\n")
        if first_nl > 0:
            text = text[first_nl + 1:]
    if text.endswith("```"):
        text = text[:-3]
    # Remove any trailing explanation after a blank line following code
    return text.rstrip()


# ── Public API ──


def chat(message: str, config_overrides: dict = None) -> dict:
    """Send a general chat message to the local model (no code editing).

    Returns dict with keys:
      ok: bool
      result: str — model reply
      error: str — only if not ok
      duration: float (seconds)
    """
    cfg = load_config()
    if config_overrides:
        cfg.update(config_overrides)

    if not cfg.get("enabled", True):
        return {"ok": False, "error": "Local AI is disabled in configuration."}

    if not message or not message.strip():
        return {"ok": False, "error": "Message cannot be empty."}
    if len(message) > 4000:
        return {"ok": False, "error": "Message too long (max 4000 chars)."}

    prompt = message.strip()
    logger.info("Local chat request: message=%r, model=%s", message[:80], cfg["model"])

    t0 = time.time()
    try:
        raw = _call_ollama(prompt, cfg)
    except (ConnectionError, TimeoutError) as e:
        logger.error("Ollama call failed: %s", e)
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error("Unexpected error calling Ollama: %s", e)
        return {"ok": False, "error": f"Model inference failed: {e}"}
    duration = time.time() - t0

    reply = raw.strip() if raw else ""
    if not reply:
        return {"ok": False, "error": "Model returned empty response.", "duration": duration}

    logger.info("Chat completed in %.1fs, reply_len=%d", duration, len(reply))
    return {"ok": True, "result": reply, "duration": duration}


def apply_edit(instruction: str, code: str, config_overrides: dict = None) -> dict:
    """Run a local model edit request.

    Returns dict with keys:
      ok: bool
      result: str (edited code) — only if ok
      error: str — only if not ok
      duration: float (seconds)
    """
    cfg = load_config()
    if config_overrides:
        cfg.update(config_overrides)

    if not cfg.get("enabled", True):
        return {"ok": False, "error": "Local AI edits are disabled in configuration."}

    # Validate inputs
    err = _validate_input(instruction, code, cfg)
    if err:
        logger.warning("Input rejected: %s", err)
        return {"ok": False, "error": err}

    prompt = _build_prompt(instruction, code)
    logger.info(
        "Local edit request: instruction=%r, code_len=%d, model=%s",
        instruction[:80], len(code), cfg["model"],
    )

    t0 = time.time()
    try:
        raw = _call_ollama(prompt, cfg)
    except (ConnectionError, TimeoutError) as e:
        logger.error("Ollama call failed: %s", e)
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error("Unexpected error calling Ollama: %s", e)
        return {"ok": False, "error": f"Model inference failed: {e}"}
    duration = time.time() - t0

    cleaned = _clean_output(raw)

    # Validate output
    err = _validate_output(code, cleaned, cfg)
    if err:
        logger.warning("Output rejected (%.1fs): %s", duration, err)
        return {"ok": False, "error": err, "duration": duration}

    logger.info("Edit completed in %.1fs, output_len=%d", duration, len(cleaned))
    return {"ok": True, "result": cleaned, "duration": duration}
