//! Windows owns the whole engine process tree. Closing this handle also closes
//! terminal/tool descendants, including when the desktop process crashes.
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};

pub fn attach(child: &tokio::process::Child) -> Result<OwnedHandle, String> {
    let process = child.raw_handle().ok_or("引擎进程句柄不可用")?;
    attach_handle(process)
}

pub fn attach_desktop(child: &std::process::Child) -> Result<OwnedHandle, String> {
    attach_handle(child.as_raw_handle())
}

fn attach_handle(process: std::os::windows::io::RawHandle) -> Result<OwnedHandle, String> {
    // SAFETY: no name or security attributes; a non-null returned handle is owned here.
    let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if raw.is_null() {
        return Err(format!(
            "无法创建执行进程组：{}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: CreateJobObjectW returned a new valid owned handle.
    let job = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: pointer and size describe a live initialized extended-limit structure.
    let configured = unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        )
    };
    if configured == 0 {
        return Err(format!(
            "无法配置执行进程组：{}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: both handles are valid and remain alive during assignment.
    if unsafe { AssignProcessToJobObject(job.as_raw_handle(), process) } == 0 {
        return Err(format!(
            "无法绑定执行进程组：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(job)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn closing_job_terminates_owned_process() {
        let mut command = tokio::process::Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .creation_flags(0x08000000)
            .kill_on_drop(true);
        let mut child = command.spawn().unwrap();
        let job = attach(&child).unwrap();
        assert!(child.try_wait().unwrap().is_none());
        drop(job);
        // Kill-on-close may report exit code zero on Windows. The contract is
        // that an otherwise long-running child exits when its owner closes.
        tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap();
    }
}
