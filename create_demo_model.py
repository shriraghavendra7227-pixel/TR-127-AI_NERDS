"""
Generate a lightweight dummy XGBoost model for demo purposes.
Run this ONLY if you don't have the real trained model.pkl yet.

Usage:  python create_demo_model.py
"""

import numpy as np
import pandas as pd
import xgboost as xgb
import joblib

# Synthesize a small training set that matches our 5 features
np.random.seed(42)
n = 2000

data = pd.DataFrame({
    "log_amount": np.random.normal(7, 2, n),
    "amount_ratio": np.random.exponential(1.5, n),
    "location_code": np.random.randint(0, 5, n),
    "time_code": np.random.randint(0, 4, n),
    "is_night": np.random.choice([0, 1], n, p=[0.7, 0.3]),
})

# Create a label: higher amount_ratio, night, unusual location → more fraud
prob = 1 / (1 + np.exp(-(
    0.8 * data["amount_ratio"]
    + 1.2 * data["is_night"]
    + 0.3 * (data["location_code"] >= 2).astype(int)
    - 2.5
)))
labels = (np.random.rand(n) < prob).astype(int)

model = xgb.XGBClassifier(
    n_estimators=100,
    max_depth=4,
    learning_rate=0.1,
    eval_metric="auc",
    use_label_encoder=False,
    random_state=42,
)
model.fit(data, labels)

joblib.dump(model, "model.pkl")
print(f"✅ Demo model saved → model.pkl  (fraud rate: {labels.mean():.1%})")
