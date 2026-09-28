"""Searchable media library across all projects: filters, tags, favourites, used/unused, AI search."""

from __future__ import annotations

import re
from typing import Any

from app.ai import prompts
from app.ai.provider import AIProvider
from app.ai.schemas import KeywordsAnswer
from app.core.database import get_db
from app.core.errors import AppError

_WORD = re.compile(r"[a-z0-9]+")
STOP = {"the", "a", "an", "of", "in", "on", "at", "and", "or", "to", "is", "are", "where", "show", "me", "find", "clips",
        "clip", "shots", "shot", "video", "videos", "with", "that", "visible", "any", "all", "some", "for"}  # fmt: skip


def tokenize(query: str) -> list[str]:
    """Search words: lower-case, no stop-words, order kept, duplicates dropped."""
    out: list[str] = []
    for w in _WORD.findall(query.lower()):
        if len(w) > 1 and w not in STOP and w not in out:
            out.append(w)
    return out


def clean_tags(tags: list[Any], limit: int = 20) -> list[str]:
    out: list[str] = []
    for t in tags:
        w = re.sub(r"[^a-z0-9 \-]", "", str(t).lower()).strip()[:30].strip()
        if w and w not in out:
            out.append(w)
    return out[:limit]


def to_item(m: dict[str, Any], project_name: str, used: bool) -> dict[str, Any]:
    sem = m.get("semantic") or {}
    ai_tags = list(m.get("tags") or [])
    user_tags = list(m.get("userTags") or [])
    return {
        "id": str(m["_id"]), "projectId": str(m["projectId"]), "projectName": project_name, "name": m["originalName"],
        "duration": m.get("duration"), "width": m.get("width"), "height": m.get("height"),
        "thumbnailUrl": f"/api/projects/{m['projectId']}/media/{m['_id']}/thumbnail" if m.get("thumbnailKey") else None,
        "url": f"/api/projects/{m['projectId']}/media/{m['_id']}/file",
        "tags": list(dict.fromkeys(user_tags + ai_tags)), "userTags": user_tags, "aiTags": ai_tags,
        "category": m.get("category") or sem.get("scene") or "", "summary": sem.get("summary", ""),
        "objects": sem.get("objects", []), "camera": sem.get("camera", ""), "action": sem.get("action", ""),
        "people": sem.get("people"), "analyzed": bool(sem), "favorite": bool(m.get("favorite")), "used": used,
    }  # fmt: skip


def _word_hit(term: str, text_words: list[str]) -> bool:
    """Whole-word match; longer terms may also match a word's beginning (plate -> plated).

    Short terms must match exactly, so "car" never matches "healthcare" or "care".
    """
    return any(w == term or (len(term) >= 4 and w.startswith(term)) for w in text_words)


def score_item(item: dict[str, Any], terms: list[str]) -> tuple[float, list[str]]:
    """0..1 relevance of a library item to the search terms, plus which terms matched."""
    if not terms:
        return 0.0, []
    tags = [t.lower() for t in item["tags"]]
    tag_words = [w for t in tags for w in _WORD.findall(t)]
    object_words = [w for o in item.get("objects", []) for w in _WORD.findall(o.lower())]
    category_words = _WORD.findall(item.get("category", "").lower())
    text_words = _WORD.findall(" ".join([item.get("summary", ""), item.get("action", ""), item.get("camera", "")]).lower())
    name_words = _WORD.findall(item["name"].lower())
    total, matched = 0.0, []
    for t in terms:
        best = 0.0
        if t in tags:
            best = 3.0
        elif _word_hit(t, tag_words):
            best = 2.0
        if _word_hit(t, object_words) or _word_hit(t, category_words):
            best = max(best, 2.0)
        if _word_hit(t, text_words) or _word_hit(t, name_words):
            best = max(best, 1.0)
        if best:
            matched.append(t)
            total += best
    return round(total / (3.0 * len(terms)), 3), matched


async def _used_clip_ids() -> set[str]:
    used: set[str] = set()
    async for p in get_db().projects.find({"timeline": {"$ne": None}}, {"timeline.segments.clipId": 1}):
        for s in (p.get("timeline") or {}).get("segments", []):
            used.add(s.get("clipId", ""))
    return used


async def all_items(project_id: Any = None) -> list[dict[str, Any]]:
    db = get_db()
    query: dict[str, Any] = {"kind": "video"}
    if project_id is not None:
        query["projectId"] = project_id
    media = [m async for m in db.media.find(query)]
    names = {p["_id"]: p["name"] async for p in db.projects.find({"_id": {"$in": list({m["projectId"] for m in media})}})}
    used = await _used_clip_ids()
    return [to_item(m, names.get(m["projectId"], "(deleted project)"), str(m["_id"]) in used) for m in media]


def apply_filters(
    items: list[dict[str, Any]], *, tag: str | None = None, category: str | None = None, favorite: bool | None = None,
    used: bool | None = None, analyzed: bool | None = None,
) -> list[dict[str, Any]]:
    out = items
    if tag:
        out = [i for i in out if tag.lower() in [t.lower() for t in i["tags"]]]
    if category:
        out = [i for i in out if category.lower() in i["category"].lower()]
    if favorite is not None:
        out = [i for i in out if i["favorite"] == favorite]
    if used is not None:
        out = [i for i in out if i["used"] == used]
    if analyzed is not None:
        out = [i for i in out if i["analyzed"] == analyzed]
    return out


def search(items: list[dict[str, Any]], terms: list[str]) -> list[dict[str, Any]]:
    scored = []
    for it in items:
        s, matched = score_item(it, terms)
        if s > 0:
            scored.append({**it, "score": s, "matched": matched})
    return sorted(scored, key=lambda i: (-i["score"], i["name"]))


def top_tags(items: list[dict[str, Any]], n: int = 30) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for it in items:
        for t in it["tags"]:
            counts[t] = counts.get(t, 0) + 1
    return [{"tag": t, "count": c} for t, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def expand_query(provider: AIProvider, query: str) -> list[str]:
    """Natural-language question -> search keywords (the model adds visual synonyms). Bounded and validated."""
    data = provider.generate_structured(
        prompts.SYSTEM_EDITOR,
        f'A user searches their video library: "{prompts.clean(query, 200)}". '
        'List up to 8 lowercase single-word visual keywords/synonyms that describe clips they want. '
        'Return JSON: {"keywords": ["..."]}',
        KeywordsAnswer, task="library_search", temperature=0.2,
    ).model_dump()
    kws = data.get("keywords")
    out = tokenize(" ".join(str(k) for k in kws)) if isinstance(kws, list) else []
    return out[:8]


async def ai_terms(provider: AIProvider | None, query: str) -> tuple[list[str], str | None]:
    """(terms, note). Falls back to plain words if the model is unavailable, and says so."""
    base = tokenize(query)
    if provider is None:
        return base, None
    try:
        import asyncio

        extra = await asyncio.to_thread(expand_query, provider, query)
    except AppError as exc:
        return base, f"AI search was unavailable ({exc.message}); used keyword matching instead."
    return list(dict.fromkeys(base + extra)), None
