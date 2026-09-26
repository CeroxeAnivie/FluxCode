"""Collect pinned engine graph licenses and locally cached MPL source archives."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tomllib

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--packages", type=Path, required=True)
    parser.add_argument("--cargo-home", type=Path, required=True)
    args = parser.parse_args()
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    selected = {(p["name"], p["version"]) for p in json.loads(args.packages.read_text(encoding="utf-8"))}
    lock = tomllib.loads((ROOT / "engine/security/Cargo.lock").read_text(encoding="utf-8"))
    checksums = {(p["name"], p["version"]): p.get("checksum") for p in lock["package"]}
    legal = ROOT / "src-tauri/resources/legal"
    sections = ["FluxCode embedded Codex dependency notices\n\nConservative Windows normal/build source graph; not a binary SBOM.\n"]
    inventory, missing, archives = [], [], []
    for package in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
        identity = (package["name"], package["version"])
        if identity not in selected:
            continue
        directory = Path(package["manifest_path"]).parent
        files = [p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(("license", "licence", "copying", "notice", "copyright", "unlicense"))]
        for folder in [directory / "LICENSES", directory / "licenses"]:
            if folder.is_dir():
                files.extend(p for p in folder.rglob("*") if p.is_file() and p not in files)
        source_lib = directory / "src/lib.rs"
        if not files and source_lib.is_file():
            header = source_lib.read_text(encoding="utf-8").splitlines()[:35]
            if any("Permission is hereby granted" in line for line in header):
                files.append(source_lib)
        if package.get("license_file"):
            path = directory / package["license_file"]
            if path.is_file() and path not in files:
                files.append(path)
        texts = []
        for file in sorted(files):
            content = file.read_text(encoding="utf-8-sig")
            if file == source_lib:
                content = "\n".join(content.splitlines()[:35])
            texts.append(file.relative_to(directory).as_posix() + "\n" + content)
        entry = {k: package.get(k) for k in ("name", "version", "license", "source", "repository")}
        inventory.append(entry)
        if not texts:
            missing.append(entry)
        sections.append("\n" + "=" * 72 + "\n" + " ".join(identity) + "\nLicense: " + (package.get("license") or "UNKNOWN") + "\n\n" + ("\n\n".join(texts) or "No standalone license file; see upstream license supplements."))
        if package.get("license") == "MPL-2.0":
            if (package.get("source") or "").startswith("git+"):
                revision = package["source"].rsplit("#", 1)[-1]
                git_root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=directory, text=True, encoding="utf-8").strip())
                actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=git_root, text=True, encoding="utf-8").strip()
                if actual != revision:
                    raise RuntimeError("Git source revision mismatch: " + package["name"])
                name = package["name"] + "-" + revision + ".tar"
                destination = legal / "sources" / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run(["git", "archive", "--format=tar", "--output", str(destination), revision], cwd=git_root, check=True)
                checksum = hashlib.sha256(destination.read_bytes()).hexdigest()
                archives.append({"name": name, "sha256": checksum, "repository": package.get("source")})
                continue
            name = "-".join(identity) + ".crate"
            candidates = list((args.cargo_home / "registry/cache").glob("*/" + name))
            if len(candidates) != 1:
                raise RuntimeError("Expected one cached source archive: " + name)
            content = candidates[0].read_bytes()
            if hashlib.sha256(content).hexdigest() != checksums[identity]:
                raise RuntimeError("Source archive checksum mismatch: " + name)
            destination = legal / "sources" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(candidates[0], destination)
            archives.append({"name": name, "sha256": checksums[identity], "repository": package.get("repository")})
    (legal / "ENGINE-THIRD-PARTY-NOTICES.txt").write_text("\n".join(sections) + "\n", encoding="utf-8", newline="\n")
    (ROOT / "docs/engine-dependency-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8", newline="\n")
    (ROOT / "work/engine-missing-license-files.json").write_text(json.dumps(missing, indent=2), encoding="utf-8", newline="\n")
    (legal / "ENGINE-SOURCE-AVAILABILITY.txt").write_text("Corresponding unmodified MPL-2.0 source archives are bundled in legal/sources.\n" + "\n".join(p["name"] + " | SHA-256 " + p["sha256"] + " | " + (p["repository"] or "crates.io") for p in archives) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"packages": len(inventory), "mplArchives": len(archives), "missingStandaloneFiles": len(missing)}))


if __name__ == "__main__":
    main()
