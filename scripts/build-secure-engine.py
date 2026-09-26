"""Reproduce the reviewed Windows Codex dependency backports, then build locally.

Requires Python 3.12+, Git, Cargo and the Windows C++ build tools. Network clients
inherit the caller's proxy variables. Never edits the installed/bundled engine.
"""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
RECIPE = ROOT / "engine" / "security"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url, path, expected):
    if path.is_file() and digest(path) == expected:
        return
    temporary = path.with_suffix(path.suffix + ".download")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "FluxCode-engine-build"})
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as stream:
            shutil.copyfileobj(response, stream)
        if digest(temporary) != expected:
            raise RuntimeError(f"Checksum mismatch: {path.name}")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def extract(archive, destination):
    destination.mkdir(parents=True)
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle.getmembers():
            parts = Path(member.name).parts
            if len(parts) < 2:
                continue
            member.name = Path(*parts[1:]).as_posix()
            bundle.extract(member, destination, filter="data")


def run(*args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "work" / "secure-engine-repro")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 1,
                        help="Concurrent Cargo jobs (default: available logical CPUs)")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_relative_to(ROOT / "work") or source == ROOT / "work":
        raise ValueError("Build sources must use an isolated directory below work")
    if args.jobs < 1:
        raise ValueError("jobs must be positive")
    manifest = tomllib.loads((RECIPE / "manifest.toml").read_text(encoding="utf-8"))
    fingerprint = hashlib.sha256(b"".join((RECIPE / name).read_bytes() for name in
        ["manifest.toml", "Cargo.lock", "dependency-fixes.patch"])).hexdigest()
    stamp = source / ".fluxcode-recipe"
    if source.exists():
        if not stamp.is_file() or stamp.read_text(encoding="utf-8").strip() != fingerprint:
            raise RuntimeError("Existing source directory has another recipe; choose a fresh directory")
    else:
        cache = ROOT / "work" / "engine-build-downloads"
        cache.mkdir(parents=True, exist_ok=True)
        archive = cache / (manifest["upstream_tag"] + ".tar.gz")
        download(manifest["source_url"], archive, manifest["source_sha256"])
        extract(archive, source)
        for crate in manifest["backports"]:
            name = f'{crate["name"]}-{crate["version"]}'
            archive = cache / (name + ".crate")
            download(f'https://static.crates.io/crates/{crate["name"]}/{name}.crate', archive, crate["sha256"])
            extract(archive, source / "codex-rs" / "vendor" / name)
        run("git", "init", "--quiet", str(source))
        run("git", "apply", "--check", str(RECIPE / "dependency-fixes.patch"), cwd=source)
        run("git", "apply", str(RECIPE / "dependency-fixes.patch"), cwd=source)
        shutil.copyfile(RECIPE / "Cargo.lock", source / "codex-rs" / "Cargo.lock")
        stamp.write_text(fingerprint + "\n", encoding="utf-8")
    if args.prepare_only:
        print(f"Prepared verified sources: {source}")
        return

    # Codex uses its own sandbox-enabled V8 distribution. The standard Deno
    # Windows archive lacks that build configuration and must not substitute it.
    version = manifest["v8_version"]
    stem = f'ptrcomp_sandbox_release_{manifest["target"]}'
    checksums_name = f"rusty_v8_{stem}.sha256"
    trusted = source / "third_party" / "v8" / f'rusty_v8_{version.replace(".", "_")}_release_manifests.sha256'
    expected = next(line.split()[0] for line in trusted.read_text(encoding="utf-8").splitlines()
                    if line.split()[-1] == checksums_name)
    cache = ROOT / "work" / "engine-build-downloads"
    base = f"https://github.com/openai/codex/releases/download/rusty-v8-v{version}/"
    download(base + checksums_name, cache / checksums_name, expected)
    entries = (cache / checksums_name).read_text(encoding="utf-8").splitlines()
    if len(entries) != 2:
        raise RuntimeError("Expected two pinned V8 artifacts")
    for line in entries:
        checksum, filename = line.split()
        if Path(filename).name != filename:
            raise RuntimeError("Invalid V8 artifact path")
        download(base + filename, cache / filename, checksum)
    env = os.environ.copy()
    env["RUSTY_V8_ARCHIVE"] = str(cache / f"rusty_v8_{stem}.lib.gz")
    env["RUSTY_V8_SRC_BINDING_PATH"] = str(cache / f"src_binding_{stem}.rs")
    # An explicit toolchain overrides upstream's developer toolchain file.
    run("cargo", "+" + manifest["rust_version"], "build", "--locked", "--release",
        "--manifest-path", str(source / "codex-rs" / "Cargo.toml"),
        "-p", "codex-cli", "-p", "codex-code-mode-host", "--bin", "codex",
        "--bin", "codex-code-mode-host", "--target", manifest["target"],
        "-j", str(args.jobs), cwd=source / "codex-rs", env=env)


if __name__ == "__main__":
    main()
