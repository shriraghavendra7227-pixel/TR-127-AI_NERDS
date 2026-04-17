import numpy as np
import pandas as pd

def generate_complex_dataset(n_samples=50000, seed=42):
    np.random.seed(seed)
    
    # 1. log_amount: typical transactions follow a normal-ish log distribution
    # Let's say most transactions are ~ $50-$500 (log is ~ 4-6)
    log_amount = np.random.normal(loc=5.5, scale=1.5, size=n_samples)
    
    # 2. amount_ratio: current / historical avg
    # Most are around 1.0, some are higher. Exponential distribution offset by 0.2
    amount_ratio = np.random.exponential(scale=1.2, size=n_samples) + 0.2
    
    # 3. location_code: categorical code for regions (0 to 4)
    location_code = np.random.choice([0, 1, 2, 3, 4], p=[0.4, 0.3, 0.15, 0.1, 0.05], size=n_samples)
    
    # 4. time_code: categorical code for time chunks (0: morning, 1: afternoon, 2: evening, 3: night)
    time_code = np.random.choice([0, 1, 2, 3], p=[0.25, 0.4, 0.25, 0.1], size=n_samples)
    
    # 5. is_night: highly correlated with time_code == 3
    is_night = (time_code == 3).astype(int)
    
    # Combine
    df = pd.DataFrame({
        "log_amount": log_amount,
        "amount_ratio": amount_ratio,
        "location_code": location_code,
        "time_code": time_code,
        "is_night": is_night
    })
    
    # Non-linear probability logic for fraud
    # Extreme amount ratios, specially at night or in rare locations, are highly indicative
    # We will compute a raw score and pass it through a sigmoid to get probability
    
    score = -4.5  # Base score for low probability
    
    # High amounts at night are sketchy
    score += (df['log_amount'] > 8) * df['is_night'] * 2.0
    
    # Very high amount ratio is a strong signal
    score += (df['amount_ratio'] > 5.0) * 1.5
    score += (df['amount_ratio'] > 10.0) * 2.5
    
    # Rare locations (3, 4) have slightly higher base risk
    score += (df['location_code'] >= 3) * 0.8
    
    # Interactions
    # High ratio + night
    score += (df['amount_ratio'] > 3.0) * df['is_night'] * 1.5
    
    # Add some noise
    score += np.random.normal(0, 1.0, size=n_samples)
    
    # Convert to probability
    prob = 1 / (1 + np.exp(-score))
    
    # Generate labels
    df['isFraud'] = (np.random.rand(n_samples) < prob).astype(int)
    
    return df

if __name__ == "__main__":
    print("Generating complex synthetic dataset...")
    df = generate_complex_dataset(60000)
    
    fraud_rate = df['isFraud'].mean()
    print(f"Dataset generated. Shape: {df.shape}")
    print(f"Fraud Rate: {fraud_rate:.2%}")
    
    out_path = "fraud_training_data.csv"
    df.to_csv(out_path, index=False)
    print(f"Saved to {out_path}")
