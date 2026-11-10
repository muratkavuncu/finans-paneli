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


def new_models():
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
    return rows[:LIMIT + 2]


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


SECTIONS = [("models", new_models), ("hf_models", lambda: hf_list("models")), ("spaces", lambda: hf_list("spaces")),
            ("papers", papers), ("repos", repos), ("showhn", show_hn)]


def main():
    try:
        if PREV_URL:
            prev = get(PREV_URL + "?t=" + str(int(time.time())))
        else:
            with open(OUT, encoding="utf-8") as fh:
                prev = json.load(fh)
    except Exception:
        prev = {}
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
