use crate::config::Settings;

fn entry(settings: &Settings) -> Result<keyring::Entry, String> {
    // Separate credentials for different providers. Never derive an account ID from a secret.
    let account = format!("{}|{}", settings.base_url, settings.api_key_env);
    keyring::Entry::new("dev.fluxcode.desktop", &account).map_err(|_| "无法访问系统凭据库".into())
}

pub fn load(settings: &Settings) -> Result<Option<String>, String> {
    match entry(settings)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取系统凭据库，请检查系统登录状态。".into()),
    }
}

pub fn save(settings: &Settings, key: &str) -> Result<(), String> {
    entry(settings)?
        .set_password(key)
        .map_err(|_| "无法将密钥保存到系统凭据库".into())
}

pub fn remove(settings: &Settings) -> Result<(), String> {
    match entry(settings)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法从系统凭据库删除密钥".into()),
    }
}
