# URLPattern compatibility backport

Base: crates.io urlpattern 0.3.0, MIT (original LICENSE retained).
Backport: https://github.com/denoland/rust-urlpattern/commit/b047afee9b901e19928f87470ba722bbac05a27f

Replace unmaintained unic-ucd-ident with the existing ICU4X properties dependency,
using the upstream ID_Start / ID_Continue implementation. Keep the 0.3 public API
required by stable Tauri 2.9.3 utils. This removes five rust-unic maintenance
advisories without suppressing the audit. Unicode properties now follow ICU's
current data; U+30FB is intentionally accepted as an identifier continuation.

Local regression tests cover Unicode names, ECMAScript special characters,
continuation-only characters and invalid delimiter/emoji characters. All original
crate tests remain. Remove this patch when stable Tauri uses maintained URLPattern.
