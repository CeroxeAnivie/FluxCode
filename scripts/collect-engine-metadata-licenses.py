"""Supply declared standard license terms for crates without a license file.

Preserve upstream package metadata and source copyright headers as attribution;
do not fabricate a copyright owner or treat a README as a full license text.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True)
    args = parser.parse_args()
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    provenance = json.loads((ROOT / "docs/engine-license-provenance.json").read_text(encoding="utf-8"))
    names = {name for p in provenance if p.get("evidenceKind") == "upstream_readme_only" for name in p["packages"]}
    mit = (ROOT / "src-tauri/vendor/urlpattern/LICENSE").read_text(encoding="utf-8")
    mit_terms = mit[mit.index("Permission is hereby granted"):]
    apache = (ROOT / "LICENSE").read_text(encoding="utf-8")
    sections = ["Embedded engine standard license terms and attribution\n\n"
                "These packages declare a standard SPDX license in published Cargo metadata,\n"
                "but omit a standalone license file. Publisher-declared authors are reproduced\n"
                "below without inventing copyright dates or identifying authors as legal owners.\n"
                "Full standard terms accompany those declarations; repository evidence is\n"
                "preserved separately in ENGINE-LICENSE-SUPPLEMENTS.txt and the source inventory.\n"]
    found = set()
    for package in sorted(metadata["packages"], key=lambda p: p["name"]):
        if package["name"] not in names:
            continue
        license_id = package.get("license")
        if license_id not in {"MIT", "MIT OR Apache-2.0", "Apache-2.0/MIT"}:
            raise RuntimeError("Unreviewed license expression: " + str(license_id))
        selected = "MIT" if license_id == "MIT" else "Apache-2.0"
        found.add(package["name"])
        sections.append("\n" + "=" * 72 + "\n" + package["name"] + " " + package["version"] +
                        "\nDeclared license: " + license_id + "\nSelected license: " + selected +
                        "\nPublisher-declared authors: " + (", ".join(package.get("authors", [])) or "Not specified") +
                        "\nRepository: " + (package.get("repository") or "Not specified") +
                        "\nPackage source: " + (package.get("source") or "workspace"))
        directory = Path(package["manifest_path"]).parent
        for source in [directory / "lib.rs", directory / "src/lib.rs"]:
            if source.is_file():
                header = []
                for line in source.read_text(encoding="utf-8").splitlines():
                    if not line.startswith("//"):
                        break
                    header.append(line)
                if any("copyright" in line.lower() for line in header):
                    sections.append("Source notice (verbatim):\n" + "\n".join(header))
        sections.append(mit_terms if selected == "MIT" else apache)
    if names != found:
        raise RuntimeError("Missing packages: " + str(names - found))
    (ROOT / "src-tauri/resources/legal/ENGINE-METADATA-LICENSES.txt").write_text("\n\n".join(sections) + "\n", encoding="utf-8", newline="\n")
    print(f"Included declared standard terms and attribution for {len(found)} packages")


if __name__ == "__main__":
    main()
