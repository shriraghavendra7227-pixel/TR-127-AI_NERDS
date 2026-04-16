import pandas as pd
import xgboost as xgb
import joblib
from sklearn.model_selection import train_test_split, RandomizedSearchCV
from sklearn.metrics import roc_auc_score, average_precision_score, classification_report
import numpy as np

def train_advanced_model():
    print("Loading dataset fraud_training_data.csv ...")
    try:
        df = pd.read_csv("fraud_training_data.csv")
    except FileNotFoundError:
        print("Dataset not found. Please run create_dataset.py first.")
        return

    # Features and target
    target = "isFraud"
    features = [c for c in df.columns if c != target]

    X = df[features]
    y = df[target]

    print(f"Loaded {len(df)} rows. Features: {features}")
    
    scale_pos_weight = (len(y) - y.sum()) / y.sum()
    print(f"Calculated scale_pos_weight mapping class imbalance: {scale_pos_weight:.2f}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    # We use base estimator for randomized search
    base_model = xgb.XGBClassifier(
        objective="binary:logistic",
        eval_metric="auc",
        use_label_encoder=False,
        scale_pos_weight=scale_pos_weight,
        random_state=42
    )

    # Define hyperparameter grid for tuning
    param_dist = {
        'n_estimators': [100, 200, 300],
        'max_depth': [3, 4, 6, 8],
        'learning_rate': [0.01, 0.05, 0.1, 0.2],
        'subsample': [0.7, 0.8, 1.0],
        'colsample_bytree': [0.7, 0.8, 1.0],
        'gamma': [0, 0.5, 1, 5]
    }

    print("\nStarting Hyperparameter Tuning using RandomizedSearchCV...")
    search = RandomizedSearchCV(
        base_model,
        param_distributions=param_dist,
        n_iter=15,          # Feel free to increase for more exhaustive search
        scoring='roc_auc',
        cv=3,
        verbose=1,
        n_jobs=1,
        random_state=42
    )

    search.fit(X_train, y_train)

    print("\nBest Parameters Found:")
    print(search.best_params_)

    # Get the best model
    best_model = search.best_estimator_

    # Evaluate
    print("\nEvaluating Model on Test Data...")
    preds_proba = best_model.predict_proba(X_test)[:, 1]
    preds = best_model.predict(X_test)

    auc_score = roc_auc_score(y_test, preds_proba)
    ap_score = average_precision_score(y_test, preds_proba)

    print(f"ROC-AUC Score:          {auc_score:.4f}")
    print(f"Average Precision (PR): {ap_score:.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, preds))

    # Save the model
    model_path = "model.pkl"
    joblib.dump(best_model, model_path)
    print(f"✅ Advanced model optimally trained and saved → {model_path}")

if __name__ == "__main__":
    train_advanced_model()
