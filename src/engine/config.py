"""Configuration. Secrets are never stored here: tenants name env vars that hold them."""
import os

DEFAULT_DATABASE_URL = "postgresql://postgres@localhost:5432/engine"
SHOPIFY_API_VERSION = "2025-10"
META_API_VERSION = "v23.0"
HTTP_TIMEOUT = 60


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
