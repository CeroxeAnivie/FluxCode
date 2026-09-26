"""Install hash-pinned release assets and generate the matching protocol."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def publish_verified_resources(staged):
    """Replace a verified batch with rollback on ordinary filesystem failures.

    Each replace is atomic, but the batch is not crash-atomic. Run preparation
    with FluxCode closed; retain recoverable originals if rollback itself fails.
    """
    if not staged:
        return
    backup = Path(tempfile.mkdtemp(prefix="fluxcode-engine-backup-", dir=staged[0][1].parent))
    originals = {}
    installed = []
    retain_backup = False
    try:
        for index, (_, target) in enumerate(staged):
            original = backup / str(index) if target.exists() else None
            if original is not None:
                shutil.copy2(target, original)
            originals[target] = original
        try:
            for temporary, target in staged:
                temporary.replace(target)
                installed.append(target)
        except OSError as error:
            failures = []
            for target in reversed(installed):
                try:
                    original = originals[target]
                    if original is None:
                        target.unlink(missing_ok=True)
                    else:
                        original.replace(target)
                except OSError as rollback_error:
                    failures.append(rollback_error)
            if failures:
                retain_backup = True
                raise ExceptionGroup(f"Engine replacement failed; recovery files retained at {backup}", [error, *failures])
            raise
    finally:
        if not retain_backup:
            shutil.rmtree(backup)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-directory", type=Path)
    args = parser.parse_args()
    release = tomllib.loads((ROOT / "config/engine-release.toml").read_text(encoding="utf-8"))
    resources = ROOT / "src-tauri/resources"
    tag = release["upstream_tag"]
    assets = [
        ("engine/codex.exe", "engine_sha256", "codex-x86_64-pc-windows-msvc.exe"),
        ("engine/codex-code-mode-host.exe", "code_mode_sha256", "codex-code-mode-host-x86_64-pc-windows-msvc.exe"),
        ("legal/CODEX-LICENSE.txt", "license_sha256", "LICENSE"),
        ("legal/CODEX-NOTICE.txt", "notice_sha256", "NOTICE"),
    ]
    staged = []
    try:
        for relative, key, upstream in assets:
            target = resources / relative
            expected = release[key]
            if target.is_file() and digest(target) == expected:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(target.suffix + ".download")
            staged.append((temporary, target))
            local = args.artifact_directory / target.name if args.artifact_directory else None
            if local and local.is_file():
                shutil.copyfile(local, temporary)
            else:
                if relative.startswith("legal/"):
                    url = f"https://raw.githubusercontent.com/openai/codex/{tag}/{upstream}"
                elif release["distribution"] == "upstream":
                    url = f"https://github.com/openai/codex/releases/download/{tag}/{upstream}"
                elif release.get("download_base_url"):
                    url = release["download_base_url"].rstrip("/") + "/" + target.name
                else:
                    raise RuntimeError("Custom engine required: supply --artifact-directory with verified release binaries; see engine/security/README.md")
                request = urllib.request.Request(url, headers={"User-Agent": "FluxCode-engine-prepare"})
                with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as stream:
                    shutil.copyfileobj(response, stream)
            if digest(temporary) != expected:
                raise RuntimeError(f"Engine resource checksum mismatch: {target.name}")
        # Verify the entire pair before publishing either binary.
        publish_verified_resources(staged)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    binary = resources / "engine/codex.exe"
    subprocess.run([str(binary), "app-server", "generate-ts", "--experimental", "--out", str(ROOT / "src/generated/codex")], check=True)
    subprocess.run([str(binary), "--version"], check=True)
    print("Verified engine resources: " + release["version"])


if __name__ == "__main__":
    main()
