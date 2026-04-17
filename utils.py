import pandas as pd
import numpy as np

LOCATION_ENCODING = {
    "Chennai": 0,
    "Mumbai": 1,
    "Delhi": 2,
    "Bangalore": 3,
    "Other": 4,
}

TIME_ENCODING = {
    "Morning": 0,
    "Afternoon": 1,
    "Evening": 2,
    "Night": 3,
}


def build_input_vector(amount, location, time_of_day, avg_amount=2000):
    log_amount = np.log1p(amount)
    amount_ratio = amount / max(avg_amount, 1)

    return pd.DataFrame([{
        "log_amount": log_amount,
        "amount_ratio": amount_ratio,
        "location_code": LOCATION_ENCODING.get(location, 4),
        "time_code": TIME_ENCODING.get(time_of_day, 1),
        "is_night": 1 if time_of_day == "Night" else 0,
    }])


def classify_risk(score):
    if score >= 0.7:
        return "HIGH", "red"
    elif score >= 0.4:
        return "MEDIUM", "orange"
    else:
        return "LOW", "green"


def get_risk_factors(amount, avg_amount, location, usual_location, time_of_day):
    factors = []

    if amount > avg_amount * 3:
        factors.append("Transaction amount is significantly higher than usual")

    if location != usual_location:
        factors.append("Transaction from a new location")

    if time_of_day == "Night":
        factors.append("Transaction at unusual late-night hours")

    return factors


def build_llama_prompt(amount, avg_amount, location, time_of_day, score, factors):
    factors_text = "\n".join(f"- {f}" for f in factors)

    return f"""
You are a financial fraud analyst.

Analyze the transaction and explain why it is suspicious.

Transaction:
- Amount: ₹{amount}
- Average: ₹{avg_amount}
- Location: {location}
- Time: {time_of_day}
- Fraud Score: {score:.2f}

Risk Factors:
{factors_text}

Explain clearly in 3–4 sentences.
"""
