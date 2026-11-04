from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./lumetra.db"  # e.g. postgresql+psycopg://user:pw@localhost/lumetra
    jwt_secret: str = "change-me-in-env"
    jwt_hours: int = 24 * 7
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_url: str = "http://localhost:5173"

    # LLM: "offline" | "anthropic" | "openai"  (openai = any OpenAI-compatible endpoint, incl. Ollama/Groq/Gemini-compat)
    llm_provider: str = "offline"
    llm_model: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"

    google_client_id: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@lumetra.local"

    # Speech provider for the teacher's voice: "browser" (free, no phoneme control) | "azure" | "google" | "elevenlabs"
    tts_provider: str = "browser"
    tts_phonemes: str = "auto"          # auto (azure only) | on | off  - whether <phoneme> tags are sent
    tts_voices_json: str = ""           # optional JSON overriding default voices, see docs/PRONUNCIATION.md
    tts_cache_dir: str = "./tts_cache"
    azure_speech_key: str = ""
    azure_speech_region: str = "centralindia"
    google_tts_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_female: str = ""
    elevenlabs_voice_male: str = ""
    elevenlabs_model: str = "eleven_multilingual_v2"

    max_upload_mb: int = 25
    upload_dir: str = "./uploads"


settings = Settings()
