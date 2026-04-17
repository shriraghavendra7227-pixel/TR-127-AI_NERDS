import pandas as pd
import numpy as np
import xgboost as xgb
import joblib

# Simulate IEEE-CIS dataset since we don't have Kaggle credentials to download the 2GB+ file.
# The simulated dataset will have the exact columns specified in the prompt.
def simulate_ieee_cis_dataset(n_samples=10000):
    np.random.seed(42)
    df = pd.DataFrame({
        'TransactionAmt': np.random.exponential(scale=100, size=n_samples),
        'addr1': np.random.randint(100, 500, size=n_samples),
        'card1': np.random.randint(1000, 15000, size=n_samples),
        'TransactionDT': np.random.randint(0, 86400 * 30, size=n_samples), # 30 days of seconds
    })
    
    # Base probability
    score = -4.0
    
    # Fraud logic
    score += (df['TransactionAmt'] > 500) * 1.5
    hour = (df['TransactionDT'] // 3600) % 24
    score += ((hour >= 1) & (hour <= 5)) * 1.5 # night time
    
    prob = 1 / (1 + np.exp(-score))
    df['isFraud'] = (np.random.rand(n_samples) < prob).astype(int)
    return df

def feature_engineering(df):
    # As per prompt requirements
    # Create features: amount, hour = TransactionDT % 24, is_night, amount_ratio
    features = pd.DataFrame()
    features['amount'] = df['TransactionAmt']
    features['hour'] = (df['TransactionDT'] // 3600) % 24
    features['is_night'] = ((features['hour'] >= 1) & (features['hour'] <= 5)).astype(int)
    
    # simulate amount_ratio (TransactionAmt / average for this card)
    card_avg = df.groupby('card1')['TransactionAmt'].transform('mean')
    features['amount_ratio'] = df['TransactionAmt'] / (card_avg + 1e-5)
    
    # We will also keep addr1 and card1 as they might be useful
    features['addr1'] = df['addr1']
    features['card1'] = df['card1']
    
    return features, df['isFraud']

if __name__ == "__main__":
    print("Simulating IEEE-CIS dataset...")
    df = simulate_ieee_cis_dataset(20000)
    df.to_csv("ieee_cis_sample.csv", index=False)
    
    print("Feature engineering...")
    X, y = feature_engineering(df)
    
    print("Training XGBoost model...")
    model = xgb.XGBClassifier(n_estimators=100, max_depth=4, learning_rate=0.1, random_state=42)
    model.fit(X, y)
    
    joblib.dump(model, "model.pkl")
    print("Model saved to model.pkl")
    print(f"Features used: {list(X.columns)}")
