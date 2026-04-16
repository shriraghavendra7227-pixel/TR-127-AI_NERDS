"""
FraudInsight AI — Explainable Financial Fraud Detection Dashboard
=================================================================
Streamlit web application that combines XGBoost prediction, SHAP
feature explanations, and LLaMA natural-language audit reports.

Run with:  streamlit run app.py
"""

import streamlit as st
import joblib
import numpy as np
import shap
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import os

# ── Project modules ──────────────────────────────────────────────
import utils
import ollama_client

# ─────────────────────────────────────────────────────────────────
# PAGE CONFIG
# ─────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="FraudInsight AI",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─────────────────────────────────────────────────────────────────
# CUSTOM CSS — premium dark-themed dashboard
# ─────────────────────────────────────────────────────────────────
st.markdown("""
<style>
/* ── Fonts ──────────────────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
}

/* ── Layout tightening ──────────────────────────────────────── */
.block-container {
    padding-top: 1.5rem;
    padding-bottom: 1rem;
    max-width: 1200px;
}

/* ── Hero Banner ────────────────────────────────────────────── */
.hero-banner {
    background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
    border-radius: 18px;
    padding: 2.4rem 2.8rem 2rem;
    margin-bottom: 1.6rem;
    border: 1px solid rgba(255,255,255,0.07);
    position: relative;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
}
.hero-banner::before {
    content: '';
    position: absolute;
    top: -60%; left: -40%;
    width: 200%; height: 250%;
    background: radial-gradient(ellipse at 30% 40%, rgba(99,102,241,0.15) 0%, transparent 55%),
                radial-gradient(ellipse at 75% 60%, rgba(244,114,182,0.08) 0%, transparent 50%);
    pointer-events: none;
}
.hero-banner::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(129,140,248,0.4), rgba(244,114,182,0.3), transparent);
}
.hero-title {
    font-size: 2.6rem;
    font-weight: 900;
    background: linear-gradient(135deg, #818cf8 0%, #a78bfa 30%, #c084fc 60%, #f472b6 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin: 0 0 0.3rem 0;
    letter-spacing: -0.8px;
    position: relative;
}
.hero-subtitle {
    font-size: 1.1rem;
    color: #a5b4fc;
    margin: 0 0 0.7rem 0;
    font-weight: 500;
    letter-spacing: 0.3px;
}
.hero-desc {
    font-size: 0.88rem;
    color: #94a3b8;
    margin: 0;
    line-height: 1.6;
    max-width: 600px;
}

/* ── Glass Card ─────────────────────────────────────────────── */
.glass-card {
    background: rgba(30, 32, 48, 0.6);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px;
    padding: 1.6rem 1.5rem;
    margin-bottom: 1rem;
    transition: border-color 0.3s ease, box-shadow 0.3s ease;
}
.glass-card:hover {
    border-color: rgba(129,140,248,0.2);
    box-shadow: 0 4px 20px rgba(99,102,241,0.08);
}

/* ── Score Display ──────────────────────────────────────────── */
.score-container {
    text-align: center;
    padding: 2rem 1rem 1.8rem;
}
.score-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    color: #64748b;
    margin-bottom: 0.5rem;
    font-weight: 600;
}
.score-value {
    font-size: 4.2rem;
    font-weight: 900;
    letter-spacing: -3px;
    line-height: 1;
    margin-bottom: 0.5rem;
}
.score-glow {
    text-shadow: 0 0 40px currentColor;
}
.confidence-text {
    color: #94a3b8;
    font-size: 0.85rem;
    margin-top: 0.5rem;
}
.confidence-text strong {
    color: #e2e8f0;
}

/* ── Risk Badge ─────────────────────────────────────────────── */
.risk-badge {
    display: inline-block;
    padding: 0.45rem 1.6rem;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.82rem;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    margin: 0.3rem 0;
}
.risk-high {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
    border: 1.5px solid rgba(239, 68, 68, 0.35);
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.1);
}
.risk-medium {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
    border: 1.5px solid rgba(251, 191, 36, 0.35);
    box-shadow: 0 0 20px rgba(251, 191, 36, 0.1);
}
.risk-low {
    background: rgba(52, 211, 153, 0.15);
    color: #34d399;
    border: 1.5px solid rgba(52, 211, 153, 0.35);
    box-shadow: 0 0 20px rgba(52, 211, 153, 0.1);
}

/* ── Section Header ─────────────────────────────────────────── */
.section-header {
    font-size: 0.95rem;
    font-weight: 700;
    color: #e2e8f0;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    letter-spacing: 0.2px;
}

/* ── SHAP Feature Row ───────────────────────────────────────── */
.shap-row {
    display: flex;
    align-items: center;
    padding: 0.65rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
}
.shap-row:last-child { border-bottom: none; }
.shap-name {
    flex: 0 0 130px;
    font-size: 0.82rem;
    color: #cbd5e1;
    font-weight: 500;
}
.shap-bar-track {
    flex: 1;
    height: 10px;
    background: rgba(255,255,255,0.05);
    border-radius: 5px;
    overflow: hidden;
    margin: 0 0.8rem;
}
.shap-bar-fill {
    height: 100%;
    border-radius: 5px;
    transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}
.shap-bar-pos { background: linear-gradient(90deg, #fb7185, #ef4444); }
.shap-bar-neg { background: linear-gradient(90deg, #34d399, #059669); }
.shap-value {
    flex: 0 0 75px;
    text-align: right;
    font-size: 0.82rem;
    font-weight: 700;
    font-family: 'Inter', monospace;
}

/* ── Comparison Table ───────────────────────────────────────── */
.comparison-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.85rem;
}
.comparison-table th {
    text-align: left;
    padding: 0.7rem 0.9rem;
    color: #64748b;
    font-weight: 600;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}
.comparison-table td {
    padding: 0.7rem 0.9rem;
    color: #e2e8f0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
}
.comparison-table tr:last-child td { border-bottom: none; }
.td-highlight { color: #f472b6 !important; font-weight: 700; }
.td-normal { color: #34d399 !important; }

/* ── LLaMA Explanation Box ──────────────────────────────────── */
.llama-box {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.06));
    border-left: 3px solid #818cf8;
    border-radius: 0 12px 12px 0;
    padding: 1.3rem 1.5rem;
    color: #cbd5e1;
    font-size: 0.9rem;
    line-height: 1.7;
    margin-top: 0.8rem;
}

/* ── Risk Factor Row ────────────────────────────────────────── */
.risk-factor {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.55rem 0;
    font-size: 0.85rem;
    color: #cbd5e1;
    line-height: 1.5;
}
.risk-dot {
    flex-shrink: 0;
    width: 7px; height: 7px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f472b6, #ec4899);
    margin-top: 0.4rem;
    box-shadow: 0 0 6px rgba(244,114,182,0.4);
}

/* ── Sidebar ────────────────────────────────────────────────── */
section[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%);
    border-right: 1px solid rgba(255,255,255,0.05);
}
section[data-testid="stSidebar"] .stMarkdown h2 {
    color: #a5b4fc;
    font-weight: 700;
}

/* ── Status Indicator ───────────────────────────────────────── */
.status-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    animation: pulse-dot 2s ease-in-out infinite;
}
.status-online { background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,0.5); }
.status-offline { background: #f87171; box-shadow: 0 0 8px rgba(248,113,113,0.5); }
@keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
}

/* ── Metric Override ────────────────────────────────────────── */
[data-testid="stMetricValue"] {
    font-size: 1.5rem !important;
    font-weight: 700 !important;
}

/* ── No-risk message ────────────────────────────────────────── */
.no-risk-msg {
    color: #64748b;
    font-size: 0.85rem;
    font-style: italic;
    padding: 0.4rem 0;
}

/* ── Footer ─────────────────────────────────────────────────── */
.footer-bar {
    text-align: center;
    color: #475569;
    font-size: 0.75rem;
    padding: 1rem 0 0.5rem;
    letter-spacing: 0.5px;
}
.footer-bar span {
    color: #818cf8;
    font-weight: 600;
}
</style>
""", unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────────
@st.cache_resource(show_spinner=False)
def load_model():
    """Load the trained XGBoost model from disk."""
    model_path = os.path.join(os.path.dirname(__file__), "model.pkl")
    if not os.path.exists(model_path):
        st.error("❌ model.pkl not found. Run `python train.py` first.")
        st.stop()
    return joblib.load(model_path)


def get_score_color(score: float) -> str:
    """Return CSS color string based on fraud score."""
    if score >= 0.7:
        return "#f87171"
    elif score >= 0.4:
        return "#fbbf24"
    return "#34d399"


def render_score_card(score: float, risk_label: str, risk_color: str):
    """Render the prominent fraud-score card with risk badge."""
    badge_cls = {
        "red": "risk-high",
        "orange": "risk-medium",
        "green": "risk-low",
    }.get(risk_color, "risk-low")

    emoji = {"red": "🔴", "orange": "🟡", "green": "🟢"}.get(risk_color, "⚪")
    css_color = get_score_color(score)

    st.markdown(f"""
    <div class="glass-card score-container">
        <div class="score-label">Fraud Probability</div>
        <div class="score-value score-glow" style="color:{css_color}">{score:.2f}</div>
        <div style="margin-bottom:0.6rem">
            <span class="risk-badge {badge_cls}">{emoji} {risk_label} RISK</span>
        </div>
        <div class="confidence-text">
            Confidence: <strong>{score * 100:.1f}%</strong>
        </div>
    </div>
    """, unsafe_allow_html=True)


def render_shap_features(shap_values, feature_names):
    """Show top-3 SHAP features as styled horizontal bars."""
    vals = shap_values[0]
    indices = np.argsort(np.abs(vals))[::-1][:3]
    max_abs = max(np.abs(vals[indices]).max(), 1e-6)

    # Friendly display names
    friendly = {
        "log_amount": "Log Amount",
        "amount_ratio": "Amount Ratio",
        "location_code": "Location",
        "time_code": "Time of Day",
        "is_night": "Night Transaction",
    }

    html = '<div class="glass-card"><div class="section-header">🧠 SHAP Feature Impact</div>'
    for i in indices:
        raw_name = feature_names[i]
        name = friendly.get(raw_name, raw_name)
        v = vals[i]
        pct = min(abs(v) / max_abs * 100, 100)
        direction = "↑" if v > 0 else "↓"
        bar_cls = "shap-bar-pos" if v > 0 else "shap-bar-neg"
        color = "#f87171" if v > 0 else "#34d399"

        html += f"""
        <div class="shap-row">
            <span class="shap-name">{name}</span>
            <div class="shap-bar-track">
                <div class="shap-bar-fill {bar_cls}" style="width:{pct:.0f}%"></div>
            </div>
            <span class="shap-value" style="color:{color}">{direction} {abs(v):.3f}</span>
        </div>"""
    html += "</div>"
    st.markdown(html, unsafe_allow_html=True)


def render_amount_chart(amount: float, avg_amount: float):
    """Minimal bar chart comparing current vs average amount."""
    fig, ax = plt.subplots(figsize=(5, 2.2))

    colors = ["#6366f1", "#f472b6"]
    bars = ax.barh(
        ["Average", "Current"],
        [avg_amount, amount],
        height=0.5,
        color=colors,
        edgecolor="none",
    )

    # Round corners via zorder trick — not supported natively, keep clean
    ax.set_facecolor("none")
    fig.patch.set_alpha(0)
    ax.spines[:].set_visible(False)
    ax.tick_params(colors="#94a3b8", labelsize=9)
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"₹{x:,.0f}"))
    ax.tick_params(axis="y", length=0)

    for bar, val in zip(bars, [avg_amount, amount]):
        ax.text(
            val + max(amount, avg_amount) * 0.03,
            bar.get_y() + bar.get_height() / 2,
            f"₹{val:,.0f}",
            va="center",
            ha="left",
            color="#e2e8f0",
            fontsize=9,
            fontweight="bold",
        )

    ax.set_xlim(0, max(amount, avg_amount) * 1.40)
    plt.tight_layout(pad=0.5)
    st.pyplot(fig, use_container_width=True)
    plt.close(fig)


def render_comparison_table(amount, avg_amount, location, time_of_day):
    """Render a behaviour-comparison table."""
    loc_cls = "td-highlight" if location != "Chennai" else "td-normal"
    time_cls = "td-highlight" if time_of_day == "Night" else "td-normal"
    amt_cls = "td-highlight" if amount > avg_amount * 1.5 else "td-normal"

    html = f"""
    <div class="glass-card">
        <div class="section-header">📋 Behavior Comparison</div>
        <table class="comparison-table">
            <tr><th>Feature</th><th>Normal</th><th>Current</th></tr>
            <tr>
                <td>Amount</td>
                <td>₹{avg_amount:,.0f}</td>
                <td class="{amt_cls}">₹{amount:,.0f}</td>
            </tr>
            <tr>
                <td>Location</td>
                <td>Chennai</td>
                <td class="{loc_cls}">{location}</td>
            </tr>
            <tr>
                <td>Time</td>
                <td>Day</td>
                <td class="{time_cls}">{time_of_day}</td>
            </tr>
        </table>
    </div>
    """
    st.markdown(html, unsafe_allow_html=True)


def render_risk_factors(factors):
    """Render risk factors as styled bullet points."""
    if not factors:
        st.markdown(
            '<div class="glass-card">'
            '<div class="section-header">⚠️ Risk Factors</div>'
            '<div class="no-risk-msg">No significant risk factors detected.</div>'
            '</div>',
            unsafe_allow_html=True,
        )
        return

    html = '<div class="glass-card"><div class="section-header">⚠️ Risk Factors</div>'
    for f in factors:
        html += f'<div class="risk-factor"><span class="risk-dot"></span>{f}</div>'
    html += "</div>"
    st.markdown(html, unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────
# HEADER
# ─────────────────────────────────────────────────────────────────
st.markdown("""
<div class="hero-banner">
    <div class="hero-title">🛡️ FraudInsight AI</div>
    <div class="hero-subtitle">Explainable Financial Fraud Detection System</div>
    <div class="hero-desc">
        Detect fraudulent transactions and understand the reasoning behind
        every decision — powered by XGBoost, SHAP, and LLaMA.
    </div>
</div>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────
# SIDEBAR — Transaction Inputs
# ─────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## 🔧 Transaction Input")
    st.markdown("---")

    amount = st.number_input(
        "💰 Transaction Amount (₹)",
        min_value=1.0,
        max_value=10_000_000.0,
        value=25000.0,
        step=500.0,
        help="Enter the transaction amount in Indian Rupees.",
    )

    location = st.selectbox(
        "📍 Location",
        options=["Chennai", "Delhi", "Mumbai", "Bangalore", "Other"],
        index=1,
        help="City where the transaction originated.",
    )

    time_of_day = st.selectbox(
        "🕐 Time of Day",
        options=["Morning", "Afternoon", "Evening", "Night"],
        index=3,
        help="Time slot when the transaction occurred.",
    )

    avg_amount = st.number_input(
        "📊 User Average Amount (₹)",
        min_value=1.0,
        max_value=10_000_000.0,
        value=2000.0,
        step=100.0,
        help="Customer's historical average transaction amount.",
    )

    st.markdown("---")

    # ── Ollama Status ────────────────────────────────────────────
    ollama_online = ollama_client.is_ollama_running()
    if ollama_online:
        st.markdown(
            '<span class="status-dot status-online"></span> '
            '<span style="color:#34d399;font-size:0.85rem;font-weight:600;">LLaMA Connected</span>',
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            '<span class="status-dot status-offline"></span> '
            '<span style="color:#f87171;font-size:0.85rem;font-weight:600;">LLaMA Offline</span>',
            unsafe_allow_html=True,
        )

    st.markdown(
        '<div style="color:#475569;font-size:0.72rem;margin-top:1.5rem;">'
        'Built for TENSOR \'26 Hackathon</div>',
        unsafe_allow_html=True,
    )

# ─────────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────────
# 1 — Feature engineering
input_df = utils.build_input_vector(amount, location, time_of_day, avg_amount)

# 2 — Model prediction
model = load_model()
fraud_score = float(model.predict_proba(input_df)[:, 1][0])

# 3 — Risk classification
risk_label, risk_color = utils.classify_risk(fraud_score)

# 4 — SHAP explanation
explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(input_df)
feature_names = list(input_df.columns)

# 5 — Risk factors
risk_factors = utils.get_risk_factors(
    amount, avg_amount, location, "Chennai", time_of_day
)

# ─────────────────────────────────────────────────────────────────
# LAYOUT — Two-column dashboard
# ─────────────────────────────────────────────────────────────────
col_left, col_right = st.columns([1, 1], gap="large")

# ── LEFT COLUMN ─────────────────────────────────────────────────
with col_left:
    # ① Fraud Score Card
    render_score_card(fraud_score, risk_label, risk_color)

    # ② Amount Comparison Chart
    st.markdown(
        '<div class="glass-card">'
        '<div class="section-header">💳 Amount Comparison</div>',
        unsafe_allow_html=True,
    )
    render_amount_chart(amount, avg_amount)
    st.markdown("</div>", unsafe_allow_html=True)

    # ③ Behavior Comparison Table
    render_comparison_table(amount, avg_amount, location, time_of_day)

# ── RIGHT COLUMN ────────────────────────────────────────────────
with col_right:
    # ④ SHAP Feature Impact
    render_shap_features(shap_values, feature_names)

    # ⑤ Risk Factors
    render_risk_factors(risk_factors)

    # ⑥ LLaMA Explanation
    st.markdown(
        '<div class="glass-card">'
        '<div class="section-header">🤖 AI Explanation (LLaMA)</div>',
        unsafe_allow_html=True,
    )

    if not ollama_online:
        st.warning(
            "⚠️ LLaMA not connected. Start Ollama with `ollama run llama3` "
            "to enable natural-language explanations. "
            "All other features remain fully functional."
        )
    else:
        if st.button("🔍 Why Flagged?", type="primary", use_container_width=True):
            prompt = utils.build_llama_prompt(
                amount, avg_amount, location, time_of_day, fraud_score, risk_factors
            )
            with st.spinner("🧠 LLaMA is analyzing the transaction…"):
                try:
                    explanation = ollama_client.generate_explanation(prompt)
                    st.markdown(
                        f'<div class="llama-box">{explanation}</div>',
                        unsafe_allow_html=True,
                    )
                except (
                    ollama_client.OllamaConnectionError,
                    ollama_client.OllamaGenerationError,
                ) as e:
                    st.error(f"LLaMA error: {e}")

    st.markdown("</div>", unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────
# FOOTER
# ─────────────────────────────────────────────────────────────────
st.markdown("---")
st.markdown(
    '<div class="footer-bar">'
    "<span>FraudInsight AI</span> · Explainable Fraud Detection · "
    "XGBoost + SHAP + LLaMA · TENSOR '26 Hackathon"
    "</div>",
    unsafe_allow_html=True,
)
