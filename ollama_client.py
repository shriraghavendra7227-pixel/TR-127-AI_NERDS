import requests

OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "llama3"
TIMEOUT_SECONDS = 60


class OllamaConnectionError(Exception):
    pass


class OllamaGenerationError(Exception):
    pass


def is_ollama_running(base_url=OLLAMA_BASE_URL):
    try:
        resp = requests.get(f"{base_url}/api/tags", timeout=3)
        return resp.status_code == 200
    except:
        return False


def generate_explanation(prompt, model=DEFAULT_MODEL):
    url = f"{OLLAMA_BASE_URL}/api/generate"

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 300,
        },
    }

    try:
        response = requests.post(url, json=payload, timeout=TIMEOUT_SECONDS)
    except:
        raise OllamaConnectionError("Ollama not running. Start with: ollama run llama3")

    if response.status_code != 200:
        raise OllamaGenerationError(response.text)

    return response.json()["response"].strip()
