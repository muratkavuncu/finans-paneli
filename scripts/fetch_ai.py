"""AI sekmesi için topluluk verisi toplayıcı.

Yeni çıkan modeller (OpenRouter), trend modeller ve demolar (Hugging Face), öne çıkan makaleler
(Hugging Face Daily Papers), yükselen açık kaynak projeler (GitHub) ve topluluk projeleri (Hacker News "Show HN").
Hepsi anahtarsız, herkese açık uç noktalardır. Çıktı data/ai.json; 30 dakikada bir yenilenir,
arada önceki çıktı olduğu gibi taşınır. Yalnızca standart kütüphaneyi kullanır.

Bağlantılar dışarıdan gelen adreslerden değil, doğrulanmış kimliklerden bu dosyada kurulur.

Kullanım: python scripts/fetch_ai.py [çıktı_yolu]
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "ai.json")
PREV_URL = os.environ.get("PREV_AI_URL", "")
MAX_AGE = 30 * 60
UA = "finans-paneli/1.0 (+https://github.com/)"
LIMIT = 12
# Topluluk listelerinden elenen içerik
BAD = re.compile(r"uncensored|nsfw|abliterat|heretic|porn|erotic|jailbreak|nude|deepfake|undress", re.I)
REPO_ID = re.compile(r"^[A-Za-z0-9][\w.-]{0,95}/[\w.-]{1,100}$")


def get(url):
    if not url.startswith("https://"):
        raise ValueError("yalnızca https")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = resp.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("yanıt çok büyük")
    return json.loads(data.decode("utf-8"))


def clean(text, limit):
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(text or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def stamp(iso):
    try:
        return int(time.mktime(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone)
    except Exception:
        return 0


_MODELS = []


def all_models():
    if _MODELS:
        return _MODELS
    rows = []
    for m in get("https://openrouter.ai/api/v1/models")["data"]:
        mid = str(m.get("id", ""))
        if ":" in mid or not REPO_ID.match(mid) or BAD.search(mid):
            continue  # ":free", ":batch" gibi aynı modelin çeşitleri atlanır
        price = m.get("pricing") or {}
        try:
            cin, cout = float(price.get("prompt") or 0) * 1e6, float(price.get("completion") or 0) * 1e6
        except (TypeError, ValueError):
            cin = cout = 0
        if cin < 0 or cout < 0:
            continue  # fiyatı değişken yönlendirici kayıtları model değildir
        rows.append({"id": mid, "name": clean(m.get("name"), 80), "ts": int(m.get("created") or 0),
                     "ctx": int(m.get("context_length") or 0), "in": round(cin, 3), "out": round(cout, 3),
                     "url": "https://openrouter.ai/" + mid})
    rows.sort(key=lambda r: -r["ts"])
    _MODELS.extend(rows)
    return _MODELS


def new_models():
    return all_models()[:LIMIT + 2]


def catalog():
    """Zaman cizelgesi ve karsilastirma icin en yeni 80 model."""
    return all_models()[:80]


RELEASE_REPOS = ["ollama/ollama", "ggml-org/llama.cpp", "huggingface/transformers", "vllm-project/vllm", "langchain-ai/langchain",
                 "comfyanonymous/ComfyUI", "open-webui/open-webui", "anthropics/claude-code", "openai/codex", "unslothai/unsloth",
                 "browser-use/browser-use", "microsoft/autogen"]
TAG = re.compile(r"^[\w.+=@-]{1,60}$")  # "langchain-core==1.8.1" gibi etiketler de gecerli


def releases():
    """Cok kullanilan acik kaynak AI projelerinin son surumleri (GitHub)."""
    rows = []
    for repo in RELEASE_REPOS:
        try:
            r = get("https://api.github.com/repos/%s/releases/latest" % repo)
        except Exception as exc:
            print("HATA surum", repo, repr(exc)[:80], file=sys.stderr)
            continue
        tag = str(r.get("tag_name", ""))
        if not TAG.match(tag):
            continue
        rows.append({"id": repo, "tag": tag, "title": clean(r.get("name"), 80), "ts": stamp(r.get("published_at") or ""),
                     "url": "https://github.com/%s/releases/tag/%s" % (repo, urllib.parse.quote(tag, safe=""))})
    if not rows:
        raise ValueError("surum verisi yok")
    return sorted(rows, key=lambda x: -x["ts"])


def hf_list(kind):
    rows = []
    for m in get("https://huggingface.co/api/%s?sort=trendingScore&direction=-1&limit=40" % kind):
        mid = str(m.get("id", ""))
        if not REPO_ID.match(mid) or BAD.search(mid) or (m.get("likes") or 0) < 50:
            continue
        rows.append({"id": mid, "task": clean(m.get("pipeline_tag") or m.get("sdk"), 40), "likes": int(m.get("likes") or 0),
                     "downloads": int(m.get("downloads") or 0), "ts": stamp(m.get("createdAt") or ""),
                     "url": "https://huggingface.co/" + ("spaces/" if kind == "spaces" else "") + mid})
    return rows[:LIMIT]


def papers():
    rows, now = [], time.time()
    for p in get("https://huggingface.co/api/daily_papers?limit=80"):
        paper = p.get("paper") or {}
        pid = str(paper.get("id", ""))
        ts = stamp(p.get("publishedAt") or paper.get("publishedAt") or "")
        if not re.match(r"^\d{4}\.\d{4,5}$", pid) or now - ts > 10 * 86400:
            continue
        rows.append({"id": pid, "title": clean(paper.get("title"), 200), "votes": int(paper.get("upvotes") or 0), "ts": ts,
                     "url": "https://huggingface.co/papers/" + pid})
    rows.sort(key=lambda r: -r["votes"])
    return rows[:LIMIT]


def repos():
    since = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 30 * 86400))
    seen = {}
    for topic in ("llm", "ai-agents"):
        url = "https://api.github.com/search/repositories?q=topic:%s+created:%%3E%s&sort=stars&order=desc&per_page=20" % (topic, since)
        for r in get(url).get("items", []):
            name = str(r.get("full_name", ""))
            desc = clean(r.get("description"), 160)
            if not REPO_ID.match(name) or BAD.search(name + " " + desc) or r.get("fork"):
                continue
            seen[name] = {"id": name, "desc": desc, "stars": int(r.get("stargazers_count") or 0), "lang": clean(r.get("language"), 24),
                          "ts": stamp(r.get("created_at") or ""), "url": "https://github.com/" + name}
    return sorted(seen.values(), key=lambda r: -r["stars"])[:LIMIT]


TOPIC = re.compile(r"^[a-z0-9-]{1,30}$")


TOP_TOPICS = ("ai", "llm", "ai-agents", "mcp", "rag", "local-llm", "machine-learning")


def top_repos():
    """GitHub'da en cok yildiz almis AI depolari (tum zamanlar). Aciklama deponun kendi yazdigi metindir."""
    seen = {}
    # Her konu ayri aranir; panelde konu secici bu "groups" alanina gore suzer. Arama siniri dakikada 10 (anahtarsiz).
    for topic in TOP_TOPICS:
        url = "https://api.github.com/search/repositories?q=topic:%s&sort=stars&order=desc&per_page=30" % topic
        try:
            items = get(url).get("items", [])
        except Exception as exc:
            print("HATA populer depo", topic, repr(exc)[:80], file=sys.stderr)
            continue
        for r in items:
            name = str(r.get("full_name", ""))
            desc = clean(r.get("description"), 300)
            if not REPO_ID.match(name) or BAD.search(name + " " + desc) or r.get("fork") or r.get("archived"):
                continue
            if name in seen:
                seen[name]["groups"].append(topic)
                continue
            seen[name] = {"id": name, "groups": [topic], "desc": desc, "stars": int(r.get("stargazers_count") or 0), "lang": clean(r.get("language"), 24),
                          "ts": stamp(r.get("pushed_at") or ""), "topics": [t for t in (r.get("topics") or []) if TOPIC.match(str(t))][:4],
                          "url": "https://github.com/" + name}
    if not seen:
        raise ValueError("populer depo verisi yok")
    rows = sorted(seen.values(), key=lambda r: -r["stars"])
    keep = set(r["id"] for r in rows[:25])
    for topic in TOP_TOPICS:
        keep.update([r["id"] for r in rows if topic in r["groups"]][:15])
    return [dict(r, top=i < 25) for i, r in enumerate(rows) if r["id"] in keep]


def show_hn():
    since = int(time.time() - 7 * 86400)
    seen = {}
    for query in ("AI", "LLM"):
        url = ("https://hn.algolia.com/api/v1/search?tags=show_hn&query=%s&numericFilters=created_at_i%%3E%d,points%%3E30&hitsPerPage=20"
               % (query, since))
        for h in get(url).get("hits", []):
            hid = str(h.get("objectID", ""))
            title = clean(h.get("title"), 200)
            if not hid.isdigit() or BAD.search(title):
                continue
            seen[hid] = {"id": hid, "title": title, "points": int(h.get("points") or 0), "comments": int(h.get("num_comments") or 0),
                         "ts": int(h.get("created_at_i") or 0), "url": "https://news.ycombinator.com/item?id=" + hid}
    return sorted(seen.values(), key=lambda r: -r["points"])[:LIMIT]


ARENA = ["text", "webdev", "vision", "search", "text_to_image", "text_to_video"]
ARENA_API = "https://datasets-server.huggingface.co/first-rows?dataset=lmarena-ai/leaderboard-dataset&config=%s&split=latest"


def arena():
    """LMArena siralamalari (Hugging Face'teki acik veri kumesi, CC BY 4.0). Her tablodan genel siralamanin ilk 8'i."""
    out = []
    for cfg in ARENA:
        try:
            rows = [r.get("row") or {} for r in get(ARENA_API % cfg).get("rows", [])]
        except Exception as exc:
            print("HATA arena", cfg, repr(exc)[:120], file=sys.stderr)
            continue
        rows = [r for r in rows if r.get("category") == "overall" and isinstance(r.get("rating"), (int, float))
                and isinstance(r.get("rank"), (int, float))]
        rows.sort(key=lambda r: r["rank"])
        top = [{"name": clean(r.get("model_name"), 60), "org": clean(r.get("organization"), 30), "rank": int(r["rank"]),
                "rating": round(r["rating"]), "lo": round(r.get("rating_lower") or r["rating"]),
                "hi": round(r.get("rating_upper") or r["rating"]), "votes": int(r.get("vote_count") or 0)} for r in rows[:8]]
        date = clean(rows[0].get("leaderboard_publish_date"), 10) if rows else ""
        if len(top) >= 3 and all(t["name"] for t in top):
            out.append({"id": cfg, "date": date if re.match(r"^\d{4}-\d{2}-\d{2}$", date) else "", "rows": top})
    if not out:
        raise ValueError("arena verisi yok")
    return out


# ---------- Günün sözü (Vikisöz, CC BY-SA). Daha önce gösterilen söz tekrar gösterilmez. ----------
PREV = {}
WQ = "https://tr.wikiquote.org/w/index.php?action=raw&title="


def wiki_plain(t):
    t = re.sub(r"\{\{[^{}]*\}\}", "", t)
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", t)
    t = re.sub(r"<[^>]*>|'{2,}", "", t)
    return clean(t, 600)


def quote_for(day):
    title = "Vikisöz:Günün sözü/" + day
    req = urllib.request.Request(WQ + urllib.parse.quote(title.replace(" ", "_")), headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            wt = resp.read(65536).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    m = re.search(r"\|\s*söz\s*=(.*?)(?=\n\s*\||\n\}\})", wt, re.S)
    b = re.search(r"\|\s*söyleyen\s*=(.*?)(?=\n\s*\||\n\}\})", wt, re.S)
    text, by = wiki_plain(m.group(1)) if m else "", wiki_plain(b.group(1))[:80] if b else ""
    if not (8 <= len(text) <= 420) or not by or BAD.search(text):
        return None
    return {"text": text, "by": by, "url": "https://tr.wikiquote.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))}


def quote():
    old = PREV.get("quote") if isinstance(PREV.get("quote"), dict) else {}
    today = time.strftime("%Y/%m/%d", time.gmtime(time.time() + 3 * 3600))  # Türkiye saati
    if old.get("date") == today and old.get("text"):
        return old
    seen = [s for s in old.get("seen", []) if isinstance(s, str)][-3000:]
    key = lambda q: re.sub(r"\W+", "", q["text"].lower())[:80]
    days = [today]
    import random
    start, now = time.mktime((2020, 1, 1, 0, 0, 0, 0, 0, -1)), time.time()
    days += [time.strftime("%Y/%m/%d", time.gmtime(random.uniform(start, now - 86400))) for _ in range(8)]
    for day in days:  # bugünün sözü daha önce gösterildiyse arşivden gösterilmemiş bir söz seçilir
        time.sleep(1)  # Vikisöz çok sık istekte 429 döndürüyor
        try:
            q = quote_for(day)
        except Exception as exc:
            print("HATA soz", day, repr(exc)[:80], file=sys.stderr)
            continue
        if q and key(q) not in seen:
            return dict(q, date=today, seen=seen + [key(q)])
    raise ValueError("yeni soz bulunamadi")


SECTIONS = [("models", new_models), ("hf_models", lambda: hf_list("models")), ("spaces", lambda: hf_list("spaces")),
            ("papers", papers), ("repos", repos), ("showhn", show_hn), ("arena", arena), ("catalog", catalog), ("releases", releases), ("top_repos", top_repos), ("quote", quote)]


def main():
    try:
        if PREV_URL:
            prev = get(PREV_URL + "?t=" + str(int(time.time())))
        else:
            with open(OUT, encoding="utf-8") as fh:
                prev = json.load(fh)
    except Exception:
        prev = {}
    PREV.update(prev)
    out = prev
    if time.time() - prev.get("updated", 0) > MAX_AGE or any(k not in prev for k, _ in SECTIONS):
        out, errors = {}, []
        for key, fn in SECTIONS:
            try:
                out[key] = fn()
            except Exception as exc:
                errors.append(key)
                print("HATA", key, repr(exc)[:160], file=sys.stderr)
                out[key] = prev.get(key, [])  # çekilemeyen bölümde eski veri kalır
        out["errors"] = errors
        out["updated"] = int(time.time()) if len(errors) < len(SECTIONS) else prev.get("updated", 0)
        print("ai verisi yenilendi:", {k: len(out[k]) for k, _ in SECTIONS}, "hata:", errors)
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
