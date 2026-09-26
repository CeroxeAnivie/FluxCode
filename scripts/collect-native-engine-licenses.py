"""Collect native V8 notices at the exact Rusty V8 source revision.

Uses standard urllib proxy environment settings. License provenance records the
actual upstream URL and decoded UTF-8 content digest for each bundled text.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import configparser
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
REVISION = "5c15a6995c9bb4bacd3e341b59fff32c909c80bf"
CACHE = ROOT / "work/native-license-cache"


def fetch(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / hashlib.sha256(url.encode("utf-8")).hexdigest()
    if path.is_file():
        return path.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": "FluxCode-license-review"})
    with urllib.request.urlopen(request, timeout=45) as response:
        content = response.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024:
        raise RuntimeError("Unexpectedly large license response: " + url)
    path.write_bytes(content)
    return content


def collect(entry):
    name, repository, revision = entry
    if repository.startswith("https://github.com/"):
        repo = repository.removeprefix("https://github.com/").removesuffix(".git")
        tree = json.loads(fetch(f"https://api.github.com/repos/{repo}/git/trees/{revision}"))["tree"]
        names = [p["path"] for p in tree if p["type"] == "blob"]
        url_for = lambda path: f"https://raw.githubusercontent.com/{repo}/{revision}/{path}"
        decode = lambda content: content
    else:
        base = repository.removesuffix(".git") + "/+/" + revision + "/"
        tree = json.loads(fetch(base + "?format=JSON").decode("utf-8")[4:])["entries"]
        names = [p["name"] for p in tree if p["type"] == "blob"]
        url_for = lambda path: base + path + "?format=TEXT"
        decode = base64.b64decode
    names = [name for name in names if re.match(r"^(license|licence|copying|notice|copyright)", name, re.I)]
    if not names and name == "third_party/partition_alloc":
        # This split repository omits Chromium's parent LICENSE. Its commit
        # records the exact original Chromium revision; use that license.
        commit = json.loads(fetch(repository.removesuffix(".git") + "/+/" + revision + "?format=JSON").decode("utf-8")[4:])
        origin = re.search(r"^GitOrigin-RevId: ([0-9a-f]{40})$", commit["message"], re.M)
        if not origin:
            raise RuntimeError("Missing Chromium origin for PartitionAlloc")
        chromium = "https://chromium.googlesource.com/chromium/src/+/" + origin[1] + "/"
        names = ["LICENSE"]
        url_for = lambda path: chromium + path + "?format=TEXT"
    if not names:
        raise RuntimeError("No root native license found: " + name)
    result = []
    for path in sorted(names):
        url = url_for(path)
        content = decode(fetch(url)).decode("utf-8-sig")
        result.append({"component": name, "revision": revision, "source": url,
                       "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(), "text": content})
    return result


def main():
    base = f"https://raw.githubusercontent.com/denoland/rusty_v8/{REVISION}/"
    modules = configparser.ConfigParser()
    modules.read_string(fetch(base + ".gitmodules").decode("utf-8"))
    tree = json.loads(fetch(f"https://api.github.com/repos/denoland/rusty_v8/git/trees/{REVISION}?recursive=1"))["tree"]
    pins = {p["path"]: p["sha"] for p in tree if p["type"] == "commit"}
    entries = [("rusty_v8", "https://github.com/denoland/rusty_v8", REVISION)]
    for section in modules.sections():
        path = modules[section]["path"]
        # Runtime native libraries, including platform alternatives. Build-only
        # Python templates and compiler distribution tools are not shipped.
        if path == "v8" or path.startswith("third_party/") and path not in {
            "third_party/jinja2", "third_party/markupsafe", "third_party/rust"
        }:
            entries.append((path, modules[section]["url"], pins[path]))
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = [record for group in pool.map(collect, entries) for record in group]
    sections = ["Native engine dependency licenses\nPinned Rusty V8 native source dependencies; includes platform alternatives.\n"]
    provenance = []
    for record in records:
        sections.append("\n" + "=" * 72 + "\n" + record["component"] + "\nSource: " + record["source"] + "\n\n" + record["text"])
        provenance.append({k: v for k, v in record.items() if k != "text"})
    (ROOT / "src-tauri/resources/legal/ENGINE-NATIVE-NOTICES.txt").write_text("\n".join(sections) + "\n", encoding="utf-8", newline="\n")
    (ROOT / "docs/engine-native-license-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Collected {len(records)} native license files from {len(entries)} pinned components")


if __name__ == "__main__":
    main()
