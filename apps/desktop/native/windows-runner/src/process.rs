use std::collections::HashMap;
use std::ffi::{OsStr, OsString, c_void};
use std::fs::File;
use std::io::Read;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle, OwnedHandle};
use std::ptr;
use std::thread;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{
    GENERIC_READ, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation,
    WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::{SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, IsProcessInJob, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
    EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, InitializeProcThreadAttributeList,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION, ResumeThread,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject,
};

const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
const PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES_VALUE: usize =
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize;
const PROCESS_WAIT_SLICE_MS: u32 = 100;
const CLEANUP_WAIT_MS: u32 = 5_000;
const IO_CHUNK_BYTES: usize = 16 * 1024;
const MAX_COMMAND_OUTPUT_BYTES: usize = 128 * 1024;

pub struct CommandResult {
    pub child_started: bool,
    pub exit_code: i32,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

pub struct CommandFailure {
    pub code: &'static str,
    pub outcome_unknown: bool,
    pub cleanup_confirmed: bool,
    pub child_started: bool,
}

impl From<&'static str> for CommandFailure {
    fn from(code: &'static str) -> Self {
        if matches!(
            code,
            "runner_child_cleanup_unknown" | "runner_child_termination_failed"
        ) {
            Self {
                code,
                outcome_unknown: true,
                cleanup_confirmed: false,
                child_started: false,
            }
        } else {
            Self {
                code,
                outcome_unknown: false,
                cleanup_confirmed: true,
                child_started: false,
            }
        }
    }
}

impl CommandFailure {
    fn unknown(code: &'static str) -> Self {
        Self {
            code,
            outcome_unknown: true,
            cleanup_confirmed: false,
            child_started: true,
        }
    }
}

struct ProcessHandles {
    process: OwnedHandle,
    thread: OwnedHandle,
}

struct PipeHandles {
    stdout_read: OwnedHandle,
    stdout_write: OwnedHandle,
    stderr_read: OwnedHandle,
    stderr_write: OwnedHandle,
}

struct StartupAttributes {
    buffer: Vec<u8>,
    handles: Vec<HANDLE>,
    jobs: Vec<HANDLE>,
}

impl StartupAttributes {
    fn new(
        handles: [HANDLE; 3],
        capabilities: &SECURITY_CAPABILITIES,
        job: HANDLE,
    ) -> Result<Self, &'static str> {
        let attribute_count = 3;
        let mut size = 0usize;
        // SAFETY: first call queries the required byte size for one attribute.
        unsafe {
            InitializeProcThreadAttributeList(ptr::null_mut(), attribute_count, 0, &mut size);
        }
        if size == 0 {
            return Err("runner_process_attribute_init_failed");
        }
        let mut buffer = vec![0u8; size];
        let list = buffer.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
        // SAFETY: `buffer` is the size returned by the query and suitably aligned
        // by the Windows allocator used for Vec's allocation on this target.
        if unsafe { InitializeProcThreadAttributeList(list, attribute_count, 0, &mut size) } == 0 {
            return Err("runner_process_attribute_init_failed");
        }
        let mut value = Self {
            buffer,
            handles: handles.into(),
            jobs: vec![job],
        };
        let bytes = std::mem::size_of_val(value.handles.as_slice());
        // SAFETY: the handle list stays owned by `value` until the process is
        // created and the attribute list is deleted.
        if unsafe {
            UpdateProcThreadAttribute(
                value.as_mut_ptr(),
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                value.handles.as_mut_ptr().cast(),
                bytes,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        } == 0
        {
            return Err("runner_process_attribute_update_failed");
        }
        // SAFETY: the job handle array stays owned by `value` until process
        // creation returns. Windows assigns the new process to this job before
        // its initial thread can run, closing the suspended-child orphan gap.
        if unsafe {
            UpdateProcThreadAttribute(
                value.as_mut_ptr(),
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                value.jobs.as_mut_ptr().cast(),
                std::mem::size_of_val(value.jobs.as_slice()),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        } == 0
        {
            return Err("runner_process_attribute_update_failed");
        }
        // SAFETY: the capability structure and its referenced SID storage
        // remain alive in the caller until process creation has returned.
        if unsafe {
            UpdateProcThreadAttribute(
                value.as_mut_ptr(),
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES_VALUE,
                (capabilities as *const SECURITY_CAPABILITIES)
                    .cast_mut()
                    .cast(),
                std::mem::size_of::<SECURITY_CAPABILITIES>(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        } == 0
        {
            return Err("runner_process_attribute_update_failed");
        }
        Ok(value)
    }

    fn as_mut_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.buffer.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST
    }
}

impl Drop for StartupAttributes {
    fn drop(&mut self) {
        // SAFETY: the buffer was successfully initialized before this value was
        // returned. Construction errors occur before Self is returned.
        unsafe {
            windows_sys::Win32::System::Threading::DeleteProcThreadAttributeList(self.as_mut_ptr())
        };
    }
}

pub fn run_appcontainer_command(
    package_sid: &str,
    capability_names: &[String],
    command: &str,
    cwd: &str,
    environment_names: &[String],
    timeout_ms: u32,
) -> Result<CommandResult, CommandFailure> {
    validate_command(command, cwd, timeout_ms)?;
    let security_capabilities =
        crate::appcontainer::ProcessSecurityCapabilities::new(package_sid, capability_names)?;
    let started = Instant::now();
    let job = create_kill_on_close_job()?;
    let pipes = create_output_pipes()?;
    let stdin = open_nul_stdin()?;
    let mut startup_attributes = StartupAttributes::new(
        [
            stdin.as_raw_handle() as HANDLE,
            pipes.stdout_write.as_raw_handle() as HANDLE,
            pipes.stderr_write.as_raw_handle() as HANDLE,
        ],
        security_capabilities.as_ref(),
        job.as_raw_handle() as HANDLE,
    )?;
    let mut startup = unsafe { std::mem::zeroed::<STARTUPINFOEXW>() };
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin.as_raw_handle() as HANDLE;
    startup.StartupInfo.hStdOutput = pipes.stdout_write.as_raw_handle() as HANDLE;
    startup.StartupInfo.hStdError = pipes.stderr_write.as_raw_handle() as HANDLE;
    startup.lpAttributeList = startup_attributes.as_mut_ptr();

    let application = system_cmd_path()?;
    let environment = restricted_environment_block(std::env::vars_os(), environment_names)?;
    let mut command_line = wide(&format!(
        "{} /D /S /C \"{}\"",
        quote_windows_argument(&application),
        command
    ));
    let cwd = wide(cwd);
    let mut process_info = unsafe { std::mem::zeroed::<PROCESS_INFORMATION>() };
    // SAFETY: all strings, the SECURITY_CAPABILITIES storage, startup info, and
    // attribute list remain alive through CreateProcessW. Inheritance is only
    // permitted for the three listed standard handles.
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            1,
            CREATE_NO_WINDOW
                | CREATE_SUSPENDED
                | CREATE_UNICODE_ENVIRONMENT
                | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_ptr().cast(),
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut process_info,
        )
    };
    if created == 0 {
        return Err("runner_appcontainer_child_create_failed".into());
    }
    finish_child(process_info, job, pipes, started, timeout_ms)
}

fn validate_command(command: &str, cwd: &str, timeout_ms: u32) -> Result<(), &'static str> {
    if command.trim().is_empty()
        || command.len() > 8_000
        || command.contains('\0')
        || cwd.is_empty()
        || cwd.len() > 1_000
        || cwd.contains('\0')
        || timeout_ms == 0
        || timeout_ms > 180_000
    {
        return Err("runner_command_invalid");
    }
    Ok(())
}

fn finish_child(
    process_info: PROCESS_INFORMATION,
    job: OwnedHandle,
    pipes: PipeHandles,
    started: Instant,
    timeout_ms: u32,
) -> Result<CommandResult, CommandFailure> {
    // SAFETY: successful CreateProcess* returns owned process/thread handles.
    let handles = ProcessHandles {
        process: unsafe { OwnedHandle::from_raw_handle(process_info.hProcess as _) },
        thread: unsafe { OwnedHandle::from_raw_handle(process_info.hThread as _) },
    };
    drop(pipes.stdout_write);
    drop(pipes.stderr_write);
    verify_job_then_resume_child(
        || {
            let mut assigned = 0;
            // SAFETY: both handles remain live and `assigned` is writable.
            unsafe {
                IsProcessInJob(
                    handles.process.as_raw_handle() as HANDLE,
                    job.as_raw_handle() as HANDLE,
                    &mut assigned,
                ) != 0
                    && assigned != 0
            }
        },
        || unsafe { ResumeThread(handles.thread.as_raw_handle() as HANDLE) },
        || terminate_and_wait(&handles, &job),
    )?;

    let stdout_reader = spawn_bounded_reader(pipes.stdout_read, MAX_COMMAND_OUTPUT_BYTES);
    let stderr_reader = spawn_bounded_reader(pipes.stderr_read, MAX_COMMAND_OUTPUT_BYTES);
    let timed_out = wait_for_job(&job, timeout_ms).map_err(CommandFailure::unknown)?;
    if timed_out {
        terminate_timed_out_job(
            || unsafe { TerminateJobObject(job.as_raw_handle() as HANDLE, 1) != 0 },
            || unsafe {
                WaitForSingleObject(job.as_raw_handle() as HANDLE, CLEANUP_WAIT_MS) == WAIT_OBJECT_0
            },
        )
        .map_err(CommandFailure::unknown)?;
    }
    let exit_code = read_exit_code(handles.process.as_raw_handle() as HANDLE)
        .map_err(CommandFailure::unknown)?;
    let (stdout, stdout_truncated) = join_reader(stdout_reader).map_err(CommandFailure::unknown)?;
    let (stderr, stderr_truncated) = join_reader(stderr_reader).map_err(CommandFailure::unknown)?;
    Ok(CommandResult {
        child_started: true,
        exit_code,
        duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        timed_out,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}

const ALLOWED_ENVIRONMENT_NAMES: [&str; 5] = ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"];

pub(super) fn restricted_environment_block(
    source: impl IntoIterator<Item = (OsString, OsString)>,
    allow_names: &[String],
) -> Result<Vec<u16>, &'static str> {
    let allowed = allow_names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<std::collections::HashSet<_>>();
    if allow_names.len() != ALLOWED_ENVIRONMENT_NAMES.len()
        || ALLOWED_ENVIRONMENT_NAMES
            .iter()
            .any(|name| !allowed.contains(&name.to_ascii_lowercase()))
    {
        return Err("runner_environment_policy_invalid");
    }

    let mut selected = HashMap::<String, (OsString, OsString)>::new();
    for (key, value) in source {
        let Some(key_text) = key.to_str() else {
            continue;
        };
        let normalized_key = key_text.to_ascii_lowercase();
        if !allowed.contains(&normalized_key) {
            continue;
        }
        if key_text.contains('=') || key.encode_wide().any(|unit| unit == 0) {
            return Err("runner_environment_invalid");
        }
        if value.encode_wide().any(|unit| unit == 0) {
            return Err("runner_environment_invalid");
        }
        if selected.insert(normalized_key, (key, value)).is_some() {
            return Err("runner_environment_duplicate_name");
        }
    }
    if !selected.contains_key("systemroot") {
        return Err("runner_environment_system_root_missing");
    }

    let mut entries = selected.into_values().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| key.to_string_lossy().to_ascii_lowercase());
    let mut block = Vec::new();
    for (key, value) in entries {
        block.extend(key.encode_wide());
        block.push(b'=' as u16);
        block.extend(value.encode_wide());
        block.push(0);
        if block.len() > 32_767 {
            return Err("runner_environment_too_large");
        }
    }
    block.push(0);
    if block.len() > 32_767 {
        return Err("runner_environment_too_large");
    }
    Ok(block)
}

fn create_output_pipes() -> Result<PipeHandles, &'static str> {
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: ptr::null_mut(),
        bInheritHandle: 1,
    };
    let (mut stdout_read, mut stdout_write) = (ptr::null_mut(), ptr::null_mut());
    // SAFETY: output pointers are writable and the security attributes are valid.
    if unsafe { CreatePipe(&mut stdout_read, &mut stdout_write, &mut attributes, 0) } == 0 {
        return Err("runner_stdout_pipe_create_failed");
    }
    let stdout_read = unsafe { OwnedHandle::from_raw_handle(stdout_read) };
    let stdout_write = unsafe { OwnedHandle::from_raw_handle(stdout_write) };
    let (mut stderr_read, mut stderr_write) = (ptr::null_mut(), ptr::null_mut());
    // SAFETY: output pointers are writable and the security attributes are valid.
    if unsafe { CreatePipe(&mut stderr_read, &mut stderr_write, &mut attributes, 0) } == 0 {
        return Err("runner_stderr_pipe_create_failed");
    }
    let stderr_read = unsafe { OwnedHandle::from_raw_handle(stderr_read) };
    let stderr_write = unsafe { OwnedHandle::from_raw_handle(stderr_write) };
    for handle in [&stdout_read, &stderr_read] {
        // SAFETY: these parent-owned read handles must not enter the child.
        if unsafe { SetHandleInformation(handle.as_raw_handle() as HANDLE, HANDLE_FLAG_INHERIT, 0) }
            == 0
        {
            return Err("runner_output_pipe_configure_failed");
        }
    }
    Ok(PipeHandles {
        stdout_read,
        stdout_write,
        stderr_read,
        stderr_write,
    })
}

pub(super) fn create_kill_on_close_job() -> Result<OwnedHandle, &'static str> {
    // SAFETY: unnamed job creation uses a null security descriptor/name.
    let raw = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if raw.is_null() {
        return Err("runner_job_create_failed");
    }
    let job = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut limits = unsafe { std::mem::zeroed::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: `limits` is the exact structure for JobObjectExtendedLimitInformation.
    if unsafe {
        SetInformationJobObject(
            raw,
            JobObjectExtendedLimitInformation,
            (&mut limits as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err("runner_job_configure_failed");
    }
    Ok(job)
}

fn open_nul_stdin() -> Result<OwnedHandle, &'static str> {
    let path = wide("NUL");
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: ptr::null_mut(),
        bInheritHandle: 1,
    };
    // SAFETY: path is NUL-terminated and security attributes are valid.
    let raw = unsafe {
        CreateFileW(
            path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &mut attributes,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            ptr::null_mut(),
        )
    };
    if raw.is_null() || raw == INVALID_HANDLE_VALUE {
        return Err("runner_stdin_open_failed");
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(raw) })
}

fn spawn_bounded_reader(
    handle: OwnedHandle,
    max_bytes: usize,
) -> thread::JoinHandle<Result<(Vec<u8>, bool), &'static str>> {
    thread::spawn(move || {
        // SAFETY: ownership of the unique handle is transferred to File.
        let mut reader = unsafe { File::from_raw_handle(handle.into_raw_handle()) };
        read_bounded_output(&mut reader, max_bytes)
    })
}

fn read_bounded_output(
    reader: &mut impl Read,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), &'static str> {
    let mut retained = Vec::with_capacity(max_bytes.min(IO_CHUNK_BYTES));
    let mut scratch = [0u8; IO_CHUNK_BYTES];
    let mut truncated = false;
    loop {
        let count = reader
            .read(&mut scratch)
            .map_err(|_| "runner_output_pipe_read_failed")?;
        if count == 0 {
            return Ok((retained, truncated));
        }
        let remaining = max_bytes.saturating_sub(retained.len());
        let copied = remaining.min(count);
        retained.extend_from_slice(&scratch[..copied]);
        truncated |= copied < count;
    }
}

fn terminate_timed_out_job(
    terminate: impl FnOnce() -> bool,
    wait_for_cleanup: impl FnOnce() -> bool,
) -> Result<(), &'static str> {
    if !terminate() {
        return Err("runner_child_termination_failed");
    }
    if !wait_for_cleanup() {
        return Err("runner_child_cleanup_unknown");
    }
    Ok(())
}

fn join_reader(
    reader: thread::JoinHandle<Result<(Vec<u8>, bool), &'static str>>,
) -> Result<(Vec<u8>, bool), &'static str> {
    reader.join().map_err(|_| "runner_output_reader_failed")?
}

fn wait_for_job(job: &OwnedHandle, timeout_ms: u32) -> Result<bool, &'static str> {
    wait_for_job_with(timeout_ms, |_| unsafe {
        WaitForSingleObject(job.as_raw_handle() as HANDLE, PROCESS_WAIT_SLICE_MS)
    })
}

fn wait_for_job_with(
    timeout_ms: u32,
    mut wait: impl FnMut(u32) -> u32,
) -> Result<bool, &'static str> {
    let started = Instant::now();
    loop {
        let waited = wait(PROCESS_WAIT_SLICE_MS);
        if waited == WAIT_OBJECT_0 {
            return Ok(false);
        }
        if waited != WAIT_TIMEOUT {
            return Err("runner_job_wait_failed");
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms as u64) {
            return Ok(true);
        }
    }
}

fn read_exit_code(process: HANDLE) -> Result<i32, &'static str> {
    let mut code = 0u32;
    // SAFETY: the process has signaled and `code` is writable.
    if unsafe { GetExitCodeProcess(process, &mut code) } == 0 {
        return Err("runner_child_exit_code_unavailable");
    }
    Ok(code as i32)
}

fn terminate_and_wait(handles: &ProcessHandles, job: &OwnedHandle) -> Result<(), &'static str> {
    let process = handles.process.as_raw_handle() as HANDLE;
    // SAFETY: the process is still suspended; terminate it directly so this
    // also handles assignment failure, where the job may still be empty.
    let _ = unsafe { TerminateProcess(process, 1) };
    // SAFETY: if assignment already succeeded, also close over any associated
    // process tree before waiting for the root process handle.
    let _ = unsafe { TerminateJobObject(job.as_raw_handle() as HANDLE, 1) };
    if unsafe { WaitForSingleObject(process, 0) } != WAIT_OBJECT_0
        && unsafe { WaitForSingleObject(process, CLEANUP_WAIT_MS) } != WAIT_OBJECT_0
    {
        return Err("runner_child_cleanup_unknown");
    }
    Ok(())
}

fn verify_job_then_resume_child(
    verify_job_membership: impl FnOnce() -> bool,
    resume: impl FnOnce() -> u32,
    cleanup: impl FnOnce() -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    if !verify_job_membership() {
        cleanup().map_err(|_| "runner_child_cleanup_unknown")?;
        return Err("runner_child_job_membership_unverified");
    }
    if resume() != 1 {
        cleanup().map_err(|_| "runner_child_cleanup_unknown")?;
        return Err("runner_child_resume_failed");
    }
    Ok(())
}

fn system_cmd_path() -> Result<Vec<u16>, &'static str> {
    let mut buffer = vec![0u16; 32_768];
    // SAFETY: buffer is writable and sized to the Win32 path limit.
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err("runner_system_directory_unavailable");
    }
    buffer.truncate(length);
    let mut path = String::from_utf16(&buffer).map_err(|_| "runner_system_directory_invalid")?;
    path.push_str("\\cmd.exe");
    Ok(wide(&path))
}

pub(super) fn quote_windows_argument(value: &[u16]) -> String {
    let value = String::from_utf16_lossy(value);
    let mut output = String::from("\"");
    let mut backslashes = 0usize;
    for ch in value.chars() {
        if ch == '\\' {
            backslashes += 1;
        } else if ch == '"' {
            output.push_str(&"\\".repeat(backslashes * 2 + 1));
            output.push(ch);
            backslashes = 0;
        } else {
            output.push_str(&"\\".repeat(backslashes));
            output.push(ch);
            backslashes = 0;
        }
    }
    output.push_str(&"\\".repeat(backslashes * 2));
    output.push('"');
    output
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        CommandFailure, WAIT_OBJECT_0, WAIT_TIMEOUT, quote_windows_argument, read_bounded_output,
        restricted_environment_block, system_cmd_path, terminate_timed_out_job,
        verify_job_then_resume_child, wait_for_job_with,
    };
    use std::cell::RefCell;
    use std::ffi::OsString;
    use std::io::{Cursor, Read};

    #[test]
    fn command_path_argument_is_quoted_for_windows() {
        let actual = quote_windows_argument(
            &"C:\\Program Files\\Noema\\cmd.exe"
                .encode_utf16()
                .collect::<Vec<_>>(),
        );
        assert_eq!(actual, "\"C:\\Program Files\\Noema\\cmd.exe\"");
    }

    #[test]
    fn child_started_fact_distinguishes_prelaunch_and_postresume_failures() {
        let prelaunch = CommandFailure::from("runner_appcontainer_child_create_failed");
        let after_resume = CommandFailure::unknown("runner_child_cleanup_unknown");
        assert!(!prelaunch.child_started);
        assert!(!prelaunch.outcome_unknown);
        assert!(after_resume.child_started);
        assert!(after_resume.outcome_unknown);
    }

    #[test]
    fn appcontainer_bootstrap_resolves_the_system_command_interpreter() {
        let path = system_cmd_path().expect("Windows system directory is available");
        let path = String::from_utf16(&path[..path.len() - 1]).expect("valid UTF-16 path");
        assert!(path.to_ascii_lowercase().ends_with("\\system32\\cmd.exe"));
        assert!(std::path::Path::new(&path).is_file());
    }

    #[test]
    fn command_path_quotes_embedded_quotes_and_trailing_slashes() {
        let actual =
            quote_windows_argument(&"C:\\path with space\\".encode_utf16().collect::<Vec<_>>());
        assert_eq!(actual, "\"C:\\path with space\\\\\"");
    }

    #[test]
    fn suspended_child_job_membership_is_verified_before_resume() {
        let calls = RefCell::new(Vec::new());
        let result = verify_job_then_resume_child(
            || {
                calls.borrow_mut().push("verify_job");
                true
            },
            || {
                calls.borrow_mut().push("resume");
                1
            },
            || {
                calls.borrow_mut().push("cleanup");
                Ok(())
            },
        );
        assert_eq!(result, Ok(()));
        assert_eq!(*calls.borrow(), ["verify_job", "resume"]);
    }

    #[test]
    fn unverified_job_membership_terminates_before_any_resume() {
        let calls = RefCell::new(Vec::new());
        let result = verify_job_then_resume_child(
            || {
                calls.borrow_mut().push("verify_job");
                false
            },
            || {
                calls.borrow_mut().push("resume");
                1
            },
            || {
                calls.borrow_mut().push("cleanup");
                Ok(())
            },
        );
        assert_eq!(result, Err("runner_child_job_membership_unverified"));
        assert_eq!(*calls.borrow(), ["verify_job", "cleanup"]);
    }

    #[test]
    fn failed_resume_requires_confirmed_cleanup() {
        let calls = RefCell::new(Vec::new());
        let result = verify_job_then_resume_child(
            || {
                calls.borrow_mut().push("verify_job");
                true
            },
            || {
                calls.borrow_mut().push("resume");
                0
            },
            || {
                calls.borrow_mut().push("cleanup");
                Err("wait_failed")
            },
        );
        assert_eq!(result, Err("runner_child_cleanup_unknown"));
        assert_eq!(*calls.borrow(), ["verify_job", "resume", "cleanup"]);
    }

    #[test]
    fn output_capture_keeps_only_the_limit_and_marks_truncation() {
        let mut reader = Cursor::new((0u8..64).collect::<Vec<_>>());
        let (output, truncated) = read_bounded_output(&mut reader, 17).unwrap();
        assert_eq!(output, (0u8..17).collect::<Vec<_>>());
        assert!(truncated);
    }

    #[test]
    fn output_capture_does_not_mark_exact_limit_as_truncated() {
        let mut reader = Cursor::new((0u8..17).collect::<Vec<_>>());
        let (output, truncated) = read_bounded_output(&mut reader, 17).unwrap();
        assert_eq!(output, (0u8..17).collect::<Vec<_>>());
        assert!(!truncated);
    }

    #[test]
    fn timeout_cleanup_requires_termination_and_confirmed_job_exit() {
        let calls = RefCell::new(Vec::new());
        let result = terminate_timed_out_job(
            || {
                calls.borrow_mut().push("terminate");
                true
            },
            || {
                calls.borrow_mut().push("wait");
                false
            },
        );
        assert_eq!(result, Err("runner_child_cleanup_unknown"));
        assert_eq!(*calls.borrow(), ["terminate", "wait"]);
    }

    #[test]
    fn timeout_cleanup_does_not_claim_success_when_termination_fails() {
        let wait_called = RefCell::new(false);
        let result = terminate_timed_out_job(
            || false,
            || {
                *wait_called.borrow_mut() = true;
                true
            },
        );
        assert_eq!(result, Err("runner_child_termination_failed"));
        assert!(!*wait_called.borrow());
    }

    #[test]
    fn job_wait_does_not_finish_when_only_the_root_process_has_exited() {
        let mut waits = [WAIT_TIMEOUT, WAIT_OBJECT_0].into_iter();
        let result = wait_for_job_with(5_000, |_| waits.next().unwrap());
        assert_eq!(result, Ok(false));
    }

    #[test]
    fn job_wait_timeout_and_wait_failure_are_not_reported_as_completion() {
        assert_eq!(wait_for_job_with(0, |_| WAIT_TIMEOUT), Ok(true));
        assert_eq!(
            wait_for_job_with(1_000, |_| u32::MAX),
            Err("runner_job_wait_failed")
        );
    }

    #[test]
    fn output_capture_reports_reader_errors() {
        struct Fails;
        impl Read for Fails {
            fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("fixture"))
            }
        }
        assert_eq!(
            read_bounded_output(&mut Fails, 16),
            Err("runner_output_pipe_read_failed")
        );
    }

    #[test]
    fn command_environment_contains_only_the_exact_allowed_names() {
        let allow_names = ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"].map(str::to_string);
        let source = [
            ("SystemRoot", "C:\\Windows"),
            ("PATH", "C:\\Windows\\System32"),
            ("OPENAI_API_KEY", "secret-value"),
            ("USERPROFILE", "C:\\Users\\operator"),
        ]
        .map(|(key, value)| (OsString::from(key), OsString::from(value)));
        let block = restricted_environment_block(source, &allow_names).unwrap();
        assert!(block.ends_with(&[0, 0]));
        let entries = String::from_utf16_lossy(&block)
            .split('\0')
            .filter(|entry| !entry.is_empty())
            .map(str::to_ascii_lowercase)
            .collect::<Vec<_>>();
        assert_eq!(
            entries,
            ["path=c:\\windows\\system32", "systemroot=c:\\windows",]
        );
    }

    #[test]
    fn command_environment_rejects_missing_system_root_or_invalid_allowlist() {
        let allow_names = ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"].map(str::to_string);
        assert_eq!(
            restricted_environment_block(
                [(
                    OsString::from("PATH"),
                    OsString::from("C:\\Windows\\System32")
                )],
                &allow_names,
            ),
            Err("runner_environment_system_root_missing")
        );
        assert_eq!(
            restricted_environment_block(
                [(OsString::from("SystemRoot"), OsString::from("C:\\Windows"))],
                &["SystemRoot".to_string()],
            ),
            Err("runner_environment_policy_invalid")
        );
    }

    #[test]
    fn command_environment_rejects_duplicate_names_and_oversized_values() {
        let allow_names = ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"].map(str::to_string);
        assert_eq!(
            restricted_environment_block(
                [
                    (OsString::from("SystemRoot"), OsString::from("C:\\Windows")),
                    (OsString::from("SYSTEMROOT"), OsString::from("C:\\Windows")),
                ],
                &allow_names,
            ),
            Err("runner_environment_duplicate_name")
        );
        assert_eq!(
            restricted_environment_block(
                [(
                    OsString::from("SystemRoot"),
                    OsString::from(format!("C:\\{}", "x".repeat(32_768))),
                ),],
                &allow_names,
            ),
            Err("runner_environment_too_large")
        );
    }
}
