"""GitHub Pages dağıtımı ve dağıtımın gerçekten yayına girdiğinin doğrulanması.

Neden var: hazır deploy-pages eylemi sürüm kimliği olarak commit SHA'sını kullanır. Zincir aynı commit'le
günde yüzlerce kez dağıtım yaptığı için GitHub bir süre sonra yeni dağıtımı uygulamayı bırakıyor ama
"başarılı" bildiriyor (11.11.2026'da 26 saat fark edilmeden eski veri yayınlandı). Burada her dağıtıma
benzersiz bir sürüm kimliği verilir ve sonunda sitenin gerçekten yeni veriyi sunduğu kontrol edilir.

Kullanım:
  python scripts/deploy_pages.py deploy <artifact_id>
  python scripts/deploy_pages.py verify <yerel news.json> <site news.json adresi> [durum_klasörü]
Yalnızca standart kütüphaneyi kullanır. Gizli değerler hiçbir yere yazılmaz.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"


def call(url, token, body=None, bearer="Bearer"):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": bearer + " " + token, "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "finans-paneli"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read(1024 * 1024).decode("utf-8") or "{}")


def deploy(artifact_id):
    repo = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GH_TOKEN"]
    version = "%s-%s-%s" % (os.environ["GITHUB_SHA"][:12], os.environ["GITHUB_RUN_ID"], os.environ.get("GITHUB_RUN_ATTEMPT", "1"))
    oidc = call(os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"], os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"], bearer="bearer")["value"]
    try:
        made = call("%s/repos/%s/pages/deployments" % (API, repo), token,
                    {"artifact_id": int(artifact_id), "pages_build_version": version, "oidc_token": oidc})
    except urllib.error.HTTPError as exc:
        print("dağıtım oluşturulamadı:", exc.code, exc.read(400).decode("utf-8", "replace"))
        return 1
    dep_id = made.get("id") or version
    print("dağıtım oluşturuldu, sürüm:", version)
    status = ""
    for _ in range(60):
        time.sleep(4)
        try:
            status = call("%s/repos/%s/pages/deployments/%s" % (API, repo, dep_id), token).get("status", "")
        except urllib.error.HTTPError as exc:
            status = "http %d" % exc.code
        if status == "succeed":
            print("dağıtım tamamlandı")
            return 0
        if status in ("deployment_failed", "deployment_perms_error", "deployment_content_failed", "deployment_cancelled", "deployment_lost"):
            break
    print("dağıtım tamamlanmadı, son durum:", status)
    return 1


def warn(state_dir):
    """Yayın güncellenmiyorsa telefona en fazla 6 saatte bir uyarı gönderir."""
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic or not state_dir:
        return
    path = os.path.join(state_dir, "notify_state.json")
    try:
        with open(path, encoding="utf-8") as fh:
            state = json.load(fh)
    except Exception:
        state = {"sent": {}}
    sent = state.setdefault("sent", {})
    if time.time() - sent.get("w:deploy", 0) < 6 * 3600:
        return
    body = {"topic": topic, "title": "Panel yayını güncellenmiyor", "priority": 4, "tags": ["warning"],
            "message": "Veri toplanıyor ama GitHub Pages yeni veriyi yayına almıyor. Panel eski veri gösteriyor olabilir."}
    try:
        req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
        sent["w:deploy"] = int(time.time())
        os.makedirs(state_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(state, fh, separators=(",", ":"))
    except Exception as exc:
        print("uyarı gönderilemedi:", type(exc).__name__)


def verify(local_path, site_url, state_dir):
    with open(local_path, encoding="utf-8") as fh:
        want = json.load(fh).get("updated", 0)
    got = 0
    for _ in range(18):
        try:
            req = urllib.request.Request("%s?v=%d" % (site_url, time.time() * 1000), headers={"User-Agent": "finans-paneli", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                got = json.loads(resp.read(5 * 1024 * 1024).decode("utf-8")).get("updated", 0)
        except Exception as exc:
            print("site okunamadı:", type(exc).__name__)
        if got >= want:
            print("yayın doğrulandı: site güncel veriyi sunuyor")
            return 0
        time.sleep(5)
    print("YAYIN GÜNCELLENMEDİ: sitedeki veri %d sn eski" % (want - got))
    warn(state_dir)
    return 1


if __name__ == "__main__":
    if sys.argv[1] == "deploy":
        sys.exit(deploy(sys.argv[2]))
    sys.exit(verify(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else ""))
