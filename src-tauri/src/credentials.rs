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

/// Explicit reconnects re-read the vault, including a deliberately deleted entry.
/// Background reconnects may reuse the credential of the still-active session.
pub(crate) fn resolve_for_connection(
    settings: &Settings,
    supplied: Option<String>,
    force: bool,
    cached: Option<&(String, String, String)>,
    read_saved: impl FnOnce(&Settings) -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    if supplied.is_some() {
        return Ok(supplied);
    }
    if !force {
        if let Some((_, _, key)) = cached
            .filter(|(base, name, _)| base == &settings.base_url && name == &settings.api_key_env)
        {
            return Ok(Some(key.clone()));
        }
    }
    read_saved(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_reconnect_uses_replaced_or_deleted_vault_entry() {
        let settings = Settings::default();
        let cached = (
            settings.base_url.clone(),
            settings.api_key_env.clone(),
            "old-fixture".into(),
        );
        assert_eq!(
            resolve_for_connection(&settings, None, true, Some(&cached), |_| Ok(Some(
                "new-fixture".into()
            )))
            .unwrap(),
            Some("new-fixture".into())
        );
        assert_eq!(
            resolve_for_connection(&settings, None, true, Some(&cached), |_| Ok(None)).unwrap(),
            None
        );
        assert!(
            resolve_for_connection(&settings, None, true, Some(&cached), |_| Err(
                "vault unavailable".into()
            ))
            .is_err()
        );
    }

    #[test]
    fn session_cache_is_scoped_and_supplied_credentials_take_precedence() {
        let settings = Settings::default();
        let cached = (
            settings.base_url.clone(),
            settings.api_key_env.clone(),
            "session-fixture".into(),
        );
        assert_eq!(
            resolve_for_connection(&settings, None, false, Some(&cached), |_| panic!(
                "same session should not read vault"
            ))
            .unwrap(),
            Some("session-fixture".into())
        );
        assert_eq!(
            resolve_for_connection(
                &settings,
                Some("supplied-fixture".into()),
                true,
                Some(&cached),
                |_| panic!("supplied key should win")
            )
            .unwrap(),
            Some("supplied-fixture".into())
        );
        let another = Settings {
            api_key_env: "OTHER_FIXTURE".into(),
            ..settings.clone()
        };
        assert_eq!(
            resolve_for_connection(&another, None, false, Some(&cached), |_| Ok(None)).unwrap(),
            None
        );
    }
}
