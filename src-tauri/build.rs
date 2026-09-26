fn main() {
    println!("cargo:rerun-if-changed=../config/engine-release.toml");
    let release: toml_edit::DocumentMut = include_str!("../config/engine-release.toml")
        .parse()
        .expect("Invalid engine release manifest");
    for key in [
        "version",
        "engine_sha256",
        "code_mode_sha256",
        "license_sha256",
        "notice_sha256",
    ] {
        let value = release[key].as_str().expect("Missing engine release field");
        assert!(
            !value.is_empty() && !value.contains(['\r', '\n']),
            "Invalid engine release value"
        );
        if key.ends_with("sha256") {
            assert!(
                value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit()),
                "Invalid engine digest"
            );
        }
        println!(
            "cargo:rustc-env=FLUXCODE_ENGINE_{}={value}",
            key.to_ascii_uppercase()
        );
    }
    println!("cargo:rerun-if-changed=windows-app.manifest");
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app.manifest")),
    ))
    .expect("Unable to build FluxCode desktop resources");
}
