import pandas as pd
import xgboost as xgb
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score


def load_data(path):
    df = pd.read_csv(path)
    X = df.drop("Class", axis=1)
    y = df["Class"]
    return X, y


def train():
    X, y = load_data("data.csv")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    model = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        scale_pos_weight=10,
        eval_metric="auc"
    )

    model.fit(X_train, y_train)

    preds = model.predict_proba(X_test)[:, 1]
    print("AUC:", roc_auc_score(y_test, preds))

    joblib.dump(model, "model.pkl")
    print("Model saved!")


if __name__ == "__main__":
    train()
