from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Snake_case in Python, camelCase on the wire and in MongoDB."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    def to_doc(self) -> dict:
        return self.model_dump(by_alias=True, mode="json")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
