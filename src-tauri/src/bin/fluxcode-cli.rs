fn main() {
    match fluxcode_lib::run_headless(std::env::args().skip(1).collect()) {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
