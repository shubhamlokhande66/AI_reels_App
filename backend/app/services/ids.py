from __future__ import annotations

import re

from bson import ObjectId

from app.core.errors import NotFoundError

_HEX24 = re.compile(r"^[0-9a-f]{24}$")


def parse_id(value: str, what: str = "Resource") -> ObjectId:
    """Validate an id path parameter. Unknown/malformed ids are a 404, never a 500."""
    if not isinstance(value, str) or not _HEX24.match(value):
        raise NotFoundError(f"{what} not found.", code=f"{what.upper()}_NOT_FOUND")
    return ObjectId(value)
