"""Settings that, if wrong, silently break the app in the browser (never in curl/tests) - worth a direct check."""

from __future__ import annotations

from app.core.config import Settings


def test_cors_default_covers_both_localhost_and_127_0_0_1_on_the_real_port():
    """start.bat opens the browser at 127.0.0.1:3100; `localhost` and `127.0.0.1` are different CORS origins even
    though they are the same machine. Missing either one makes every API call fail in that browser with no visible
    error beyond a generic "Something went wrong" - so both must be allowed, on the port the app actually uses (3100)."""
    origins = Settings().cors_origin_list
    for host in ("localhost", "127.0.0.1"):
        assert f"http://{host}:3100" in origins, f"http://{host}:3100 missing from default CORS_ORIGINS: {origins}"
