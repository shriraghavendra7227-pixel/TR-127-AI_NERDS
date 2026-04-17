"""
FraudInsight AI — FastAPI Backend
XGBoost model + Multi-factor rule-based hybrid scoring engine.
"""

import io
import ipaddress
import math
import random
import string
from typing import Optional

import aiohttp
import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ─── App Setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="FraudInsight AI", version="3.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Model Loading ─────────────────────────────────────────────────────────────
try:
    _model = joblib.load("model.pkl")
    _explainer = shap.TreeExplainer(_model)
    MODEL_FEATURES = ["amount", "hour", "is_night", "amount_ratio", "addr1", "card1"]
    print("[OK] XGBoost model and SHAP explainer loaded.")
except Exception as exc:
    _model = None
    _explainer = None
    MODEL_FEATURES = []
    print(f"[WARN] Model not loaded: {exc}")

# ─── Constants ─────────────────────────────────────────────────────────────────
LOCATIONS = [
    "Mumbai, India", "Delhi, India", "Bangalore, India", "Chennai, India",
    "New York, USA", "London, UK", "Singapore", "Dubai, UAE",
    "Frankfurt, Germany", "Tokyo, Japan", "Sydney, Australia", "Toronto, Canada",
]

OLLAMA_URL   = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.1"

# Private/internal IP ranges (RFC 1918 + loopback)
_PRIVATE_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
]


# ─── Utility Functions ─────────────────────────────────────────────────────────
def random_ip() -> str:
    """Generate a realistic mix of private and external IPs (60 % external)."""
    if random.random() < 0.60:
        # External: avoid 10.x, 192.168.x, 172.16–31.x
        while True:
            ip = ".".join(str(random.randint(1, 254)) for _ in range(4))
            try:
                obj = ipaddress.ip_address(ip)
                if not any(obj in net for net in _PRIVATE_NETS):
                    return ip
            except ValueError:
                pass
    else:
        return f"192.168.{random.randint(0,255)}.{random.randint(1,254)}"


def random_txn_id() -> str:
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"TXN-{suffix}"


def is_external_ip(ip: str) -> bool:
    """Return True if the IP is outside private/loopback ranges."""
    try:
        obj = ipaddress.ip_address(ip)
        return not any(obj in net for net in _PRIVATE_NETS)
    except ValueError:
        return False


def classify_risk(score: float) -> str:
    if score >= 0.65:
        return "HIGH"
    elif score >= 0.35:
        return "MEDIUM"
    return "LOW"


# ─── Multi-Factor Scoring Engine ───────────────────────────────────────────────
def rule_based_score(
    amount: float,
    avg_amount: float,
    hour: int,
    ip: str,
    location: str,
    usual_location: Optional[str] = None,
) -> tuple[float, list[str]]:
    """
    Compute a deterministic fraud score (0–1) from business rules.
    Returns (score, list_of_human_readable_risk_factors).

    Factor weights (additive, then sigmoid-clamped):
      - Amount ratio component   → up to 0.45
      - Night-time component     → up to 0.20
      - External IP component    → up to 0.20
      - Location mismatch        → up to 0.15
    """
    factors: list[str] = []
    raw = 0.0

    # ── 1. Amount vs average ──────────────────────────────────────────────────
    if avg_amount > 0:
        ratio = amount / avg_amount
    else:
        ratio = 1.0

    if ratio >= 10.0:
        raw += 0.45
        factors.append(f"Transaction amount (${amount:,.2f}) is {ratio:.1f}× the card average — extremely suspicious")
    elif ratio >= 5.0:
        raw += 0.35
        factors.append(f"Transaction amount (${amount:,.2f}) is {ratio:.1f}× the card average — well above normal")
    elif ratio >= 3.0:
        raw += 0.20
        factors.append(f"Transaction amount (${amount:,.2f}) is {ratio:.1f}× the card average — elevated spending")
    elif ratio >= 1.8:
        raw += 0.08
        factors.append(f"Transaction amount slightly above typical card spending pattern")

    # ── 2. Time of transaction ────────────────────────────────────────────────
    if 1 <= hour <= 4:
        raw += 0.20
        factors.append(f"Transaction occurred at {hour:02d}:00 AM — deep-night activity is high-risk")
    elif hour == 0 or hour == 5:
        raw += 0.13
        factors.append(f"Transaction occurred in the early hours ({hour:02d}:00) — unusual timing")
    elif 22 <= hour <= 23:
        raw += 0.08
        factors.append("Late-night transaction — outside normal business hours")

    # ── 3. IP address classification ──────────────────────────────────────────
    if ip and is_external_ip(ip):
        raw += 0.20
        factors.append(f"Transaction originated from an external IP ({ip}) — possible remote access")

    # ── 4. Location mismatch ──────────────────────────────────────────────────
    if usual_location and location and location != usual_location:
        raw += 0.15
        factors.append(f"Transaction location ({location}) differs from the card's registered region ({usual_location})")

    # ── 5. Small sanity boost so borderline cards get sorted ─────────────────
    # (prevents clustering at exactly 0.0 when nothing fires)
    raw += ratio * 0.005          # tiny amount-proportional nudge

    # Sigmoid squeeze into (0, 1) so no value is exactly 0 or 1
    score = 1.0 / (1.0 + math.exp(-6.0 * (raw - 0.45)))

    return round(min(max(score, 0.01), 0.99), 4), factors


def hybrid_score(
    amount: float,
    avg_amount: float,
    hour: int,
    ip: str,
    location: str,
    usual_location: Optional[str],
    transaction_dt: int,
    addr1: int,
    card1: int,
) -> tuple[float, list[str]]:
    """
    Blend the XGBoost model output with the rule-based score.
    If the model is unavailable, fall back 100 % to rules.

    The rule-based score always has the final say on HIGH/MEDIUM classification
    because it reflects the business logic the user defined.
    """
    rule_sc, factors = rule_based_score(amount, avg_amount, hour, ip, location, usual_location)

    if _model is not None:
        try:
            is_night   = 1 if 0 <= hour <= 5 else 0
            amount_ratio = amount / max(avg_amount, 1)
            feat = pd.DataFrame([{
                "amount":       amount,
                "hour":         hour,
                "is_night":     is_night,
                "amount_ratio": amount_ratio,
                "addr1":        addr1,
                "card1":        card1,
            }])
            model_sc = float(_model.predict_proba(feat)[0][1])
            # Blend: rule-based is authoritative (70 %), model adds nuance (30 %)
            final = 0.70 * rule_sc + 0.30 * model_sc
        except Exception:
            final = rule_sc
    else:
        final = rule_sc

    return round(min(max(final, 0.01), 0.99), 4), factors


def get_shap_labels(features: pd.DataFrame, top_n: int = 3) -> list[str]:
    """Return top-N human-readable SHAP factor labels."""
    label_map = {
        "amount":       "Unusually high transaction amount",
        "hour":         "Transaction at an unusual hour",
        "is_night":     "Late-night activity detected",
        "amount_ratio": "Amount far exceeds spending pattern",
        "addr1":        "Billing address anomaly",
        "card1":        "Card usage pattern is irregular",
    }
    if _explainer is None:
        return []
    try:
        shap_vals = _explainer.shap_values(features)
        vals      = shap_vals[0] if isinstance(shap_vals, list) else shap_vals[0]
        top_idx   = np.argsort(np.abs(vals))[::-1][:top_n]
        return [label_map.get(MODEL_FEATURES[i], MODEL_FEATURES[i]) for i in top_idx]
    except Exception:
        return []


# ─── LLaMA / Ollama ────────────────────────────────────────────────────────────
async def call_llama(prompt: str) -> str:
    payload = {
        "model":   OLLAMA_MODEL,
        "prompt":  prompt,
        "stream":  False,
        "options": {"temperature": 0.3, "num_predict": 250},
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                OLLAMA_URL, json=payload,
                timeout=aiohttp.ClientTimeout(total=12),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json(content_type=None)
                    return data.get("response", "").strip()
    except Exception:
        pass
    return ""


def build_llama_prompt(amount: float, location: str, time_label: str,
                        score: float, factors: list[str]) -> str:
    factors_text = "\n".join(f"- {f}" for f in factors) if factors else "- General anomaly detected"
    return f"""You are a financial fraud analyst. Explain why this transaction is suspicious.

Transaction:
- Amount: ${amount:,.2f}
- Location: {location}
- Time: {time_label}
- Fraud Score: {score:.2f} / 1.00

Risk Factors:
{factors_text}

Write a clear explanation in 3-4 sentences. No bullet points. No technical jargon."""


# ─── Pydantic Models ───────────────────────────────────────────────────────────
class TransactionIn(BaseModel):
    id:            Optional[str] = None
    amount:        float
    location:      Optional[str] = None
    time:          Optional[str] = None
    ip_address:    Optional[str] = None
    addr1:         int = 200
    card1:         int = 5000
    TransactionDT: int = 43200


# ─── Endpoints ─────────────────────────────────────────────────────────────────
@app.post("/predict")
async def predict(tx: TransactionIn):
    ip        = tx.ip_address or random_ip()
    location  = tx.location or random.choice(LOCATIONS)
    hour      = (tx.TransactionDT // 3600) % 24
    time_label = (tx.time or
                  ("Night"     if 0  <= hour <= 5  else
                   "Morning"   if 6  <= hour <= 11 else
                   "Afternoon" if 12 <= hour <= 17 else "Evening"))

    # Compute card average as proxy (realistic: card1 / 15)
    avg_amount = max(tx.card1 / 15.0, 40.0)

    score, rule_factors = hybrid_score(
        amount=tx.amount, avg_amount=avg_amount, hour=hour, ip=ip,
        location=location, usual_location=None,
        transaction_dt=tx.TransactionDT, addr1=tx.addr1, card1=tx.card1,
    )
    risk_level = classify_risk(score)

    # Merge SHAP labels (if model available) with rule factors
    is_night     = 1 if 0 <= hour <= 5 else 0
    amount_ratio = tx.amount / max(avg_amount, 1)
    feat = pd.DataFrame([{
        "amount": tx.amount, "hour": hour, "is_night": is_night,
        "amount_ratio": amount_ratio, "addr1": tx.addr1, "card1": tx.card1,
    }])
    shap_labels = get_shap_labels(feat)
    # Rule factors take priority; SHAP labels fill in if few rule factors fired
    all_factors = rule_factors or shap_labels or ["General pattern anomaly detected"]

    explanation = "This transaction appears to be within normal spending patterns."
    if risk_level in ("HIGH", "MEDIUM"):
        prompt = build_llama_prompt(tx.amount, location, time_label, score, all_factors)
        llm_text = await call_llama(prompt)
        if llm_text:
            explanation = llm_text
        else:
            explanation = (
                f"This transaction of ${tx.amount:,.2f} from {location} at {time_label} "
                f"received a fraud score of {score:.2f}. "
                + " ".join(all_factors[:2]) + "."
            )

    return {
        "fraud_score": score,
        "risk_level":  risk_level,
        "factors":     all_factors,
        "explanation": explanation,
        "location":    location,
        "time":        time_label,
        "ip_address":  ip,
    }


@app.post("/predict/batch")
async def predict_batch(file: UploadFile = File(...)):
    contents = await file.read()
    try:
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {exc}")

    # Normalise column names (IEEE-CIS or our own)
    col_map = {"TransactionAmt": "amount", "TransactionDT": "TransactionDT",
               "addr1": "addr1", "card1": "card1"}
    df.rename(columns={k: v for k, v in col_map.items() if k in df.columns}, inplace=True)

    def safe_col(col, default, dtype=float):
        if col in df.columns:
            return pd.to_numeric(df[col], errors="coerce").fillna(default).astype(dtype)
        return pd.Series([default] * len(df), dtype=dtype)

    df["amount"]        = safe_col("amount",        100.0, float)
    df["TransactionDT"] = safe_col("TransactionDT", 43200, int)
    df["addr1"]         = safe_col("addr1",         200,   int)
    df["card1"]         = safe_col("card1",         5000,  int)

    # ── Compute per-card average across the WHOLE CSV for realistic ratios ──
    card_avg_map: dict[int, float] = (
        df.groupby("card1")["amount"].mean().to_dict()
    )

    df_sample = df.head(200)
    results   = []
    locations = LOCATIONS.copy()

    for idx, row in df_sample.iterrows():
        amt  = float(row["amount"])
        dt   = int(row["TransactionDT"])
        addr = int(row["addr1"])
        card = int(row["card1"])
        hour = (dt // 3600) % 24

        # Use true per-card average from the dataset, with a minimum floor
        avg_amount = max(card_avg_map.get(card, amt), 40.0)

        ip       = random_ip()
        location = random.choice(locations)

        time_label = ("Night"     if 0  <= hour <= 5  else
                      "Morning"   if 6  <= hour <= 11 else
                      "Afternoon" if 12 <= hour <= 17 else "Evening")

        score, rule_factors = hybrid_score(
            amount=amt, avg_amount=avg_amount, hour=hour, ip=ip,
            location=location, usual_location=None,
            transaction_dt=dt, addr1=addr, card1=card,
        )
        risk_level  = classify_risk(score)
        all_factors = rule_factors or ["General anomaly — no single dominant factor"]

        results.append({
            "id":          random_txn_id(),
            "amount":      round(amt, 2),
            "avg_amount":  round(avg_amount, 2),
            "location":    location,
            "ip_address":  ip,
            "region":      f"Zone-{addr % 9 + 1}",
            "time":        time_label,
            "hour":        hour,
            "fraud_score": score,
            "risk_level":  risk_level,
            "factors":     all_factors,
            "explanation": "",      # loaded on-demand in the modal
        })

    return {"transactions": results, "total": len(results)}


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None}


# ─── Static (must be last) ─────────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="static", html=True), name="static")
