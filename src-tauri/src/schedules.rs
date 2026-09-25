//! Bounded desktop schedules. Persist the running state before dispatch; never replay an
//! ambiguous run after restart. An open desktop and connected engine are required.
use crate::{AppState, engine::Engine};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub project: String,
    pub prompt: String,
    pub interval_minutes: u32,
    pub enabled: bool,
    pub next_run: u64,
    pub status: String,
    pub last_thread_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Store {
    schema_version: u32,
    jobs: Vec<Schedule>,
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn validate(jobs: &[Schedule]) -> Result<(), String> {
    if jobs.len() > 20 {
        return Err("最多保存 20 个定时任务".into());
    }
    let mut ids = std::collections::HashSet::new();
    for job in jobs {
        if job.id.is_empty()
            || job.id.len() > 100
            || !ids.insert(&job.id)
            || job.name.trim().is_empty()
            || job.name.len() > 200
            || job.prompt.trim().is_empty()
            || job.prompt.len() > 100000
            || !(1..=525600).contains(&job.interval_minutes)
            || !std::path::Path::new(&job.project).is_absolute()
        {
            return Err("定时任务配置无效".into());
        }
    }
    Ok(())
}
pub async fn list(root: &Path) -> Result<Vec<Schedule>, String> {
    let bytes = match tokio::fs::read(root.join("schedules.toml")).await {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err("无法读取定时任务".into()),
    };
    if bytes.len() > 2_097_152 {
        return Err("定时任务配置过大".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "定时任务配置必须使用 UTF-8")?;
    let store: Store = toml_edit::de::from_str(text).map_err(|_| "定时任务配置无效")?;
    if store.schema_version != 1 {
        return Err("不支持此配置版本".into());
    }
    validate(&store.jobs)?;
    Ok(store.jobs)
}
pub async fn save(root: &Path, jobs: Vec<Schedule>) -> Result<(), String> {
    validate(&jobs)?;
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|e| e.to_string())?;
    let text = toml_edit::ser::to_string_pretty(&Store {
        schema_version: 1,
        jobs,
    })
    .map_err(|e| e.to_string())?;
    let temporary = root.join("schedules.toml.tmp");
    tokio::fs::write(&temporary, text)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(temporary, root.join("schedules.toml"))
        .await
        .map_err(|e| e.to_string())
}
pub async fn update(root: &Path, mut job: Schedule) -> Result<(), String> {
    let mut jobs = list(root).await?;
    if let Some(old) = jobs.iter_mut().find(|old| old.id == job.id) {
        if old.status == "running" {
            return Err("请等待定时任务完成后再修改".into());
        }
        job.last_thread_id = old.last_thread_id.clone();
        *old = job;
    } else {
        job.last_thread_id = None;
        jobs.push(job);
    }
    save(root, jobs).await
}
async fn execute(
    engine: Arc<Engine>,
    job: &Schedule,
    state: &AppState,
    app: &tauri::AppHandle,
) -> Result<(String, String), String> {
    let lifecycle = state.lifecycle.lock().await;
    let engine = state.engine.lock().await.clone().unwrap_or(engine);
    let config = state.configuration.config().await;
    let started=engine.request("thread/start",serde_json::json!({"cwd":job.project,"sandbox":"danger-full-access","approvalPolicy":"never","modelProvider":"fluxcode","developerInstructions":crate::context::instructions(&config,&job.project),"model":config.provider.model}),Duration::from_secs(45)).await?;
    let id = started["thread"]["id"]
        .as_str()
        .ok_or("Invalid scheduled thread")?
        .to_owned();
    {
        let _guard = state.scheduling.lock().await;
        let mut jobs = list(&state.data_dir).await?;
        if let Some(saved) = jobs.iter_mut().find(|saved| saved.id == job.id) {
            saved.last_thread_id = Some(id.clone());
        }
        save(&state.data_dir, jobs).await?;
        let _ = app.emit(
            "engine-event",
            serde_json::json!({"method":"schedule/updated","params":{}}),
        );
    }
    let mut params = serde_json::json!({"threadId":id,"model":config.provider.model,"collaborationMode":{"settings":{"reasoning_effort":null}},"input":[{"type":"text","text":job.prompt,"text_elements":[]}],"approvalPolicy":"never","sandboxPolicy":{"type":"dangerFullAccess"}});
    crate::model_selection::normalize_turn(&mut params)?;
    let turn = engine
        .request("turn/start", params, Duration::from_secs(45))
        .await?;
    drop(lifecycle);
    let turn_id = turn["turn"]["id"]
        .as_str()
        .ok_or("Invalid scheduled turn")?;
    match engine.wait_turn(&id, turn_id).await {
        Ok(status) => Ok((id, status)),
        Err(_) => {
            let _ = engine
                .request(
                    "turn/interrupt",
                    serde_json::json!({"threadId":id,"turnId":turn_id}),
                    Duration::from_secs(15),
                )
                .await;
            Ok((id, "failed".into()))
        }
    }
}
pub async fn serve(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    {
        let _guard = state.scheduling.lock().await;
        match list(&state.data_dir).await {
            Ok(mut jobs) => {
                for job in &mut jobs {
                    if job.status == "running" || job.next_run < now() {
                        job.status = "paused".into();
                        job.enabled = false;
                    }
                }
                if save(&state.data_dir, jobs).await.is_err() {
                    tracing::error!("schedule_recovery_failed");
                    return;
                }
            }
            Err(_) => {
                tracing::error!("schedule_store_invalid");
                return;
            }
        }
    }
    let mut tick = tokio::time::interval(Duration::from_secs(30));
    loop {
        tick.tick().await;
        let engine = state.engine.lock().await.clone();
        let candidate = {
            let _guard = state.scheduling.lock().await;
            let Ok(mut jobs) = list(&state.data_dir).await else {
                tracing::error!("schedule_read_failed");
                continue;
            };
            if engine.as_ref().is_none_or(|engine| engine.is_busy()) {
                if pause_missed(&mut jobs, now()) {
                    if save(&state.data_dir, jobs).await.is_err() {
                        tracing::error!("schedule_missed_save_failed");
                    }
                    let _ = app.emit(
                        "engine-event",
                        serde_json::json!({"method":"schedule/updated","params":{}}),
                    );
                }
                continue;
            }
            let Some(job) = jobs
                .iter_mut()
                .find(|job| job.enabled && job.status != "running" && job.next_run <= now())
            else {
                continue;
            };
            job.status = "running".into();
            job.next_run = now() + u64::from(job.interval_minutes) * 60;
            let candidate = job.clone();
            if save(&state.data_dir, jobs).await.is_err() {
                tracing::error!("schedule_claim_failed");
                continue;
            }
            candidate
        };
        let Some(engine) = engine else {
            continue;
        };
        let outcome = execute(engine, &candidate, &state, &app).await;
        let _guard = state.scheduling.lock().await;
        if let Ok(mut jobs) = list(&state.data_dir).await {
            if let Some(job) = jobs.iter_mut().find(|job| job.id == candidate.id) {
                match outcome {
                    Ok((id, status)) => {
                        job.last_thread_id = Some(id);
                        job.status = status;
                    }
                    Err(_) => {
                        job.status = "failed".into();
                    }
                }
                if job.status != "completed" {
                    job.enabled = false;
                }
                job.next_run = now() + u64::from(job.interval_minutes) * 60;
            }
            if save(&state.data_dir, jobs).await.is_err() {
                tracing::error!("schedule_result_save_failed");
            }
        }
        let _ = app.emit(
            "engine-event",
            serde_json::json!({"method":"schedule/updated","params":{}}),
        );
    }
}
fn pause_missed(jobs: &mut [Schedule], current: u64) -> bool {
    let mut changed = false;
    for job in jobs {
        if job.enabled && job.status != "running" && job.next_run <= current {
            job.enabled = false;
            job.status = "paused".into();
            changed = true;
        }
    }
    changed
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn validates_and_persists_schedules() {
        let dir = tempfile::tempdir().unwrap();
        let job = Schedule {
            id: "job".into(),
            name: "任务".into(),
            project: dir.path().to_string_lossy().into(),
            prompt: "Inspect".into(),
            interval_minutes: 5,
            enabled: true,
            next_run: now() + 300,
            status: "waiting".into(),
            last_thread_id: None,
        };
        update(dir.path(), job.clone()).await.unwrap();
        assert_eq!(list(dir.path()).await.unwrap()[0].name, "任务");
        let mut invalid = job;
        invalid.interval_minutes = 0;
        assert!(update(dir.path(), invalid).await.is_err());
        assert_eq!(list(dir.path()).await.unwrap()[0].interval_minutes, 5);
        let mut jobs = list(dir.path()).await.unwrap();
        let due = jobs[0].next_run;
        assert!(!pause_missed(&mut jobs, due - 1));
        assert!(pause_missed(&mut jobs, due));
        assert!(!jobs[0].enabled);
        assert_eq!(jobs[0].status, "paused");
        assert!(!pause_missed(&mut jobs, due + 60));
    }
}
