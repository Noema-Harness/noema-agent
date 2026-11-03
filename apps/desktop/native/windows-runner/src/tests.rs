use crate::appcontainer::{derive_capability_name, derive_package_sid};
use crate::parse_request;
use crate::policy::{
    BackendIdentity, EnvironmentPolicy, FileIdentity, FilesystemPolicy, NetworkMode, NetworkPolicy,
    PathRoot, WindowsCommandPolicyV2,
};
use crate::protocol::{Operation, RequestEnvelope, ResultFrame, parse_readiness_response};
use crate::{
    handle_request, setup_operation_denied, setup_probe_response, validate_setup_user_data_path,
};
use serde_json::Value;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn appcontainer_capability_names_derive_stable_distinct_read_write_sids() {
    let read_name = "Noema.Read.4eeb0c18e86e40eb";
    let write_name = "Noema.Write.4eeb0c18e86e40eb";
    let read_sid = derive_capability_name(read_name).expect("read capability SID");
    let repeated_read_sid = derive_capability_name(read_name).expect("repeat capability SID");
    let write_sid = derive_capability_name(write_name).expect("write capability SID");

    assert_eq!(read_sid, repeated_read_sid);
    assert_ne!(read_sid, write_sid);
    assert!(read_sid.starts_with("S-1-15-3-"));
    assert!(write_sid.starts_with("S-1-15-3-"));
    assert!(
        derive_package_sid()
            .expect("package SID derivation")
            .starts_with("S-1-15-2-")
    );
    assert_eq!(
        derive_capability_name("Network.Noema.Read.4eeb0c18e86e40eb"),
        Err("appcontainer_capability_name_invalid")
    );
}

#[test]
fn setup_protocol_rejects_the_retired_machine_firewall_operation() {
    let request = br#"{"protocolVersion":8,"requestId":"remove_request_01","operation":{"type":"remove_sandbox_setup","operationId":"remove_request_01"}}"#;
    assert_eq!(parse_request(request).err(), Some("request_invalid"));
}

/// A target-machine acceptance probe for the real AppContainer process and Job
/// behavior. It is ignored by default, has a second explicit opt-in, and never
/// provisions a profile, changes ACLs, or changes system firewall state.
#[cfg(windows)]
#[test]
#[ignore = "target-machine AppContainer acceptance; requires explicit opt-in and completed setup"]
fn windows_live_appcontainer_process_tree_acceptance() {
    assert_eq!(
        std::env::var("NOEMA_RUN_WINDOWS_LIVE_ACCEPTANCE").as_deref(),
        Ok("1"),
        "set NOEMA_RUN_WINDOWS_LIVE_ACCEPTANCE=1 to run fixed live acceptance commands"
    );

    let platform = crate::windows_probe::read_platform().expect("read current Windows version");
    assert!(
        platform.major == 10
            && platform.minor == 0
            && platform.build >= crate::protocol::MINIMUM_WINDOWS_BUILD
            && platform.architecture == "x86_64",
        "native command acceptance requires supported Windows 10 x64"
    );
    let package_sid = crate::appcontainer::derive_package_sid().expect("derive fixed package SID");
    let profile_path = crate::appcontainer::probe_profile(&package_sid)
        .expect("Noema AppContainer profile is ready");

    let system_root = std::env::var("SystemRoot").expect("SystemRoot is available");
    let working_directory = std::path::Path::new(&system_root).join("System32");
    let working_directory = working_directory
        .to_str()
        .expect("System32 path is valid UTF-8 for this test");
    let environment_names = [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "PATH",
        "LOCALAPPDATA",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();

    // The root cmd exits immediately; the fixed CPU-bound cmd descendant
    // remains in its Job without relying on console timer APIs unavailable to
    // an AppContainer's redirected standard input.
    let root_exit = crate::process::run_appcontainer_command(
        &package_sid,
        &[],
        "start /b \"\" cmd.exe /d /q /c \"@for /L %i in (1,1,1000000) do @rem\" & exit /b 0",
        working_directory,
        &environment_names,
        8_000,
    )
    .unwrap_or_else(|failure| panic!("root-exit process-tree command fails: {}", failure.code));
    assert!(root_exit.child_started);
    assert!(!root_exit.timed_out);
    assert_eq!(root_exit.exit_code, 0);
    eprintln!(
        "live_acceptance=root_exit job_duration_ms={} stdout_bytes={} stderr_bytes={}",
        root_exit.duration_ms,
        root_exit.stdout.len(),
        root_exit.stderr.len()
    );
    assert!(
        root_exit.duration_ms >= 1_000,
        "Job wait must include descendant lifetime"
    );

    // A bounded timeout must terminate the Job and confirm its signaled state
    // before reporting cleanup as complete.
    let timeout = crate::process::run_appcontainer_command(
        &package_sid,
        &[],
        "@for /L %i in (1,1,1000000000) do @rem",
        working_directory,
        &environment_names,
        1_000,
    )
    .unwrap_or_else(|failure| panic!("timeout cleanup is unconfirmed: {}", failure.code));
    assert!(timeout.child_started);
    assert!(timeout.timed_out);
    assert!(
        timeout.duration_ms < 8_000,
        "timeout cleanup remains bounded"
    );
    eprintln!(
        "live_acceptance=timeout cleanup_duration_ms={}",
        timeout.duration_ms
    );

    assert_helper_stop_kills_child(&profile_path);
}

#[cfg(windows)]
#[test]
#[ignore = "target-machine AppContainer ACL enforcement; creates and removes isolated temporary roots"]
fn windows_live_appcontainer_enforces_read_and_write_capability_acls() {
    assert_eq!(
        std::env::var("NOEMA_RUN_APPCONTAINER_ACL_ENFORCEMENT").as_deref(),
        Ok("1"),
        "set NOEMA_RUN_APPCONTAINER_ACL_ENFORCEMENT=1 to run the temporary-root ACL probe"
    );
    let platform = crate::windows_probe::read_platform().expect("read current Windows version");
    assert!(
        platform.major == 10
            && platform.minor == 0
            && platform.build >= crate::protocol::MINIMUM_WINDOWS_BUILD
            && platform.architecture == "x86_64",
        "ACL enforcement probe requires supported Windows 10 x64"
    );
    let package_sid = crate::appcontainer::derive_package_sid().expect("derive fixed package SID");
    crate::appcontainer::probe_profile(&package_sid).expect("Noema AppContainer profile is ready");

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let roots = TemporaryAclProbeRoots::new(nonce);
    let read_root = roots.path.join("read");
    let write_root = roots.path.join("write");
    std::fs::create_dir(&read_root).expect("create isolated read-root fixture");
    std::fs::create_dir(&write_root).expect("create isolated write-root fixture");
    let read_file = read_root.join("seed.txt");
    std::fs::write(&read_file, "read-capability-proof").expect("write read-root fixture");
    let system_root = std::env::var("SystemRoot").expect("SystemRoot is available");
    let working_directory = Path::new(&system_root).join("System32");
    let working_directory = working_directory
        .to_str()
        .expect("System32 path is valid UTF-8 for this test");
    let environment_names = [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "PATH",
        "LOCALAPPDATA",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    let suffix = format!("{nonce:064x}");
    let grants = vec![
        crate::policy::AclGrant {
            path: read_root.to_str().expect("read root is UTF-8").to_string(),
            file_identity: crate::path_identity::file_identity_for_directory(&read_root)
                .expect("verify read-root identity"),
            capability_name: format!("Noema.Read.{suffix}"),
            access: crate::policy::FilesystemAccessMode::Read,
            is_directory: true,
        },
        crate::policy::AclGrant {
            path: write_root
                .to_str()
                .expect("write root is UTF-8")
                .to_string(),
            file_identity: crate::path_identity::file_identity_for_directory(&write_root)
                .expect("verify write-root identity"),
            capability_name: format!("Noema.Write.{suffix}"),
            access: crate::policy::FilesystemAccessMode::Write,
            is_directory: true,
        },
    ];
    let evidence = crate::run_windows_acl_operation(&grants, true)
        .expect("reconcile and verify ACLs on isolated temporary roots");
    assert_eq!(evidence.len(), 2);
    assert!(evidence.iter().all(|grant| {
        grant.object_count == grant.acl_verified_count
            && grant.object_count > 0
            && grant.inheritance_verified
    }));

    let read_capability = grants[0].capability_name.clone();
    let write_capability = grants[1].capability_name.clone();
    let read_command = format!(
        "type {}",
        crate::process::quote_windows_argument(
            &read_file.as_os_str().encode_wide().collect::<Vec<_>>()
        )
    );
    let read_result = crate::process::run_appcontainer_command(
        &package_sid,
        &[read_capability.clone()],
        &read_command,
        working_directory,
        &environment_names,
        5_000,
    )
    .unwrap_or_else(|failure| panic!("read-capability check failed: {}", failure.code));
    assert_eq!(read_result.exit_code, 0);
    assert!(String::from_utf8_lossy(&read_result.stdout).contains("read-capability-proof"));

    let denied_read_write = read_root.join("must-not-exist.txt");
    let denied_read_write_command = format!(
        "echo denied > {}",
        crate::process::quote_windows_argument(
            &denied_read_write
                .as_os_str()
                .encode_wide()
                .collect::<Vec<_>>()
        )
    );
    let denied_read_write_result = crate::process::run_appcontainer_command(
        &package_sid,
        &[read_capability],
        &denied_read_write_command,
        working_directory,
        &environment_names,
        5_000,
    )
    .unwrap_or_else(|failure| panic!("read-only denial check failed: {}", failure.code));
    assert!(!denied_read_write_result.timed_out);
    assert!(
        !denied_read_write.exists(),
        "read capability must not write"
    );

    let write_file = write_root.join("created.txt");
    let write_command = format!(
        "echo write-capability-proof > {}",
        crate::process::quote_windows_argument(
            &write_file.as_os_str().encode_wide().collect::<Vec<_>>()
        )
    );
    let write_result = crate::process::run_appcontainer_command(
        &package_sid,
        &[write_capability],
        &write_command,
        working_directory,
        &environment_names,
        5_000,
    )
    .unwrap_or_else(|failure| panic!("write-capability check failed: {}", failure.code));
    assert_eq!(write_result.exit_code, 0);
    assert_eq!(
        std::fs::read_to_string(&write_file)
            .expect("host reads AppContainer-created file")
            .trim(),
        "write-capability-proof"
    );

    let denied_write = write_root.join("without-capability.txt");
    let denied_write_command = format!(
        "echo denied > {}",
        crate::process::quote_windows_argument(
            &denied_write.as_os_str().encode_wide().collect::<Vec<_>>()
        )
    );
    let denied_write_result = crate::process::run_appcontainer_command(
        &package_sid,
        &[],
        &denied_write_command,
        working_directory,
        &environment_names,
        5_000,
    )
    .unwrap_or_else(|failure| panic!("no-capability denial check failed: {}", failure.code));
    assert!(!denied_write_result.timed_out);
    assert!(!denied_write.exists(), "package SID alone must not write");
    eprintln!(
        "live_acceptance=appcontainer_filesystem_acl read=allowed read_write=denied write=allowed missing_capability=denied evidence_roots={}",
        evidence.len()
    );
}

#[cfg(windows)]
struct TemporaryAclProbeRoots {
    path: PathBuf,
}

#[cfg(windows)]
impl TemporaryAclProbeRoots {
    fn new(nonce: u128) -> Self {
        let path =
            std::env::temp_dir().join(format!("Noema.AclProbe.{}.{nonce:x}", std::process::id()));
        std::fs::create_dir(&path).expect("create isolated ACL-probe root");
        Self { path }
    }
}

#[cfg(windows)]
impl Drop for TemporaryAclProbeRoots {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(windows)]
#[test]
#[ignore = "target-machine AppContainer default network isolation probe; opt-in only"]
fn windows_live_appcontainer_without_network_capability_denies_loopback() {
    assert_eq!(
        std::env::var("NOEMA_RUN_APPCONTAINER_NETWORK_ISOLATION").as_deref(),
        Ok("1"),
        "set NOEMA_RUN_APPCONTAINER_NETWORK_ISOLATION=1 to run the fixed loopback probe"
    );
    let platform = crate::windows_probe::read_platform().expect("read current Windows version");
    assert!(
        platform.major == 10
            && platform.minor == 0
            && platform.build >= crate::protocol::MINIMUM_WINDOWS_BUILD
            && platform.architecture == "x86_64",
        "network isolation probe requires supported Windows 10 x64"
    );

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let profile_name = format!("Noema.NetProbe.{:x}{:x}", std::process::id(), nonce);
    let profile_sid = crate::appcontainer::ensure_profile_for(&profile_name)
        .expect("create isolated AppContainer profile with no capabilities");
    let temporary_profile = TemporaryAppContainerProfile::new(profile_name, profile_sid);
    assert_ne!(
        temporary_profile.sid,
        crate::appcontainer::derive_package_sid().expect("derive Noema runner SID"),
        "temporary profile must have a unique package identity"
    );

    let system_root = std::env::var("SystemRoot").expect("SystemRoot is available");
    let working_directory = Path::new(&system_root).join("System32");
    let working_directory = working_directory
        .to_str()
        .expect("System32 path is valid UTF-8 for this test");
    let environment_names = [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "PATH",
        "LOCALAPPDATA",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    assert_appcontainer_network_is_denied(
        &temporary_profile.name,
        &temporary_profile.sid,
        working_directory,
        &environment_names,
    );
    temporary_profile
        .remove()
        .expect("remove the temporary AppContainer profile");
    eprintln!(
        "live_acceptance=appcontainer_default_network_denied loopback=1 system_firewall_mutation=0"
    );
}

#[cfg(windows)]
struct TemporaryAppContainerProfile {
    name: String,
    sid: String,
    removed: bool,
}

#[cfg(windows)]
impl TemporaryAppContainerProfile {
    fn new(name: String, sid: String) -> Self {
        Self {
            name,
            sid,
            removed: false,
        }
    }

    fn remove(mut self) -> Result<(), &'static str> {
        if delete_appcontainer_profile(&self.name) < 0 {
            return Err("temporary_appcontainer_profile_delete_failed");
        }
        self.removed = true;
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for TemporaryAppContainerProfile {
    fn drop(&mut self) {
        if !self.removed {
            let _ = delete_appcontainer_profile(&self.name);
        }
    }
}

#[cfg(windows)]
fn delete_appcontainer_profile(name: &str) -> i32 {
    use windows_sys::Win32::Security::Isolation::DeleteAppContainerProfile;

    let name = name.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    // SAFETY: the profile name is NUL terminated and Windows owns the profile state.
    unsafe { DeleteAppContainerProfile(name.as_ptr()) }
}

#[cfg(windows)]
fn assert_appcontainer_network_is_denied(
    profile_name: &str,
    package_sid: &str,
    working_directory: &str,
    environment_names: &[String],
) {
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::thread::sleep;
    use std::time::Duration;

    let system_root = std::env::var("SystemRoot").expect("SystemRoot is available");
    let curl_path = Path::new(&system_root).join("System32").join("curl.exe");
    assert!(
        curl_path.is_file(),
        "Windows curl.exe is required for this fixed probe"
    );

    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind controlled loopback endpoint");
    listener
        .set_nonblocking(true)
        .expect("configure controlled listener");
    let endpoint = listener.local_addr().expect("read local endpoint");
    let accepted_count = Arc::new(AtomicUsize::new(0));
    let stop_server = Arc::new(AtomicBool::new(false));
    let thread_count = Arc::clone(&accepted_count);
    let thread_stop = Arc::clone(&stop_server);
    let server = std::thread::spawn(move || {
        while !thread_stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    thread_count.fetch_add(1, Ordering::SeqCst);
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });

    let control = TcpStream::connect_timeout(&endpoint, Duration::from_secs(2))
        .expect("host positive control reaches the local endpoint");
    drop(control);
    let control_deadline = std::time::Instant::now() + Duration::from_secs(1);
    while accepted_count.load(Ordering::SeqCst) == 0 && std::time::Instant::now() < control_deadline
    {
        sleep(Duration::from_millis(20));
    }
    assert_eq!(
        accepted_count.load(Ordering::SeqCst),
        1,
        "host positive control must reach the endpoint before the child probe"
    );

    let version = crate::process::run_appcontainer_command_for_profile(
        profile_name,
        package_sid,
        &[],
        "curl.exe --version",
        working_directory,
        environment_names,
        4_000,
    )
    .unwrap_or_else(|failure| panic!("AppContainer curl bootstrap fails: {}", failure.code));
    assert_eq!(
        version.exit_code, 0,
        "curl must execute inside the AppContainer"
    );
    assert!(
        String::from_utf8_lossy(&version.stdout)
            .to_ascii_lowercase()
            .contains("curl"),
        "fixed curl bootstrap command must actually run"
    );

    let command = format!("curl.exe -sS --connect-timeout 1 --max-time 2 http://{endpoint}/");
    let attempt = crate::process::run_appcontainer_command_for_profile(
        profile_name,
        package_sid,
        &[],
        &command,
        working_directory,
        environment_names,
        8_000,
    )
    .unwrap_or_else(|failure| panic!("AppContainer network probe fails: {}", failure.code));
    sleep(Duration::from_millis(200));
    stop_server.store(true, Ordering::SeqCst);
    server.join().expect("join controlled loopback server");

    assert!(
        !attempt.timed_out,
        "curl's own bounded timeout must finish first: exit_code={} duration_ms={} stdout={} stderr={}",
        attempt.exit_code,
        attempt.duration_ms,
        String::from_utf8_lossy(&attempt.stdout),
        String::from_utf8_lossy(&attempt.stderr)
    );
    assert_ne!(
        attempt.exit_code, 0,
        "AppContainer network request must fail"
    );
    assert_eq!(
        accepted_count.load(Ordering::SeqCst),
        1,
        "the AppContainer request must not reach the controlled listener"
    );
    eprintln!("live_acceptance=appcontainer_network denied=1 endpoint=loopback");
}

#[cfg(windows)]
fn assert_helper_stop_kills_child(profile_path: &Path) {
    use std::process::Stdio;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    let nonce = format!(
        "{}_{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos()
    );
    let ready = profile_path.join(format!("noema-stop-{nonce}.ready"));
    let leaked = profile_path.join(format!("noema-stop-{nonce}.leaked"));
    let helper = std::env::current_exe().expect("current test executable path");
    let mut helper = std::process::Command::new(helper)
        .args([
            "--ignored",
            "--exact",
            "tests::windows_live_appcontainer_stop_helper",
            "--nocapture",
        ])
        .env("NOEMA_RUN_WINDOWS_LIVE_STOP_HELPER", "1")
        .env("NOEMA_LIVE_STOP_NONCE", nonce)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn the opt-in native helper process");

    let ready_deadline = Instant::now() + Duration::from_secs(10);
    let mut helper_exited_early = false;
    while !ready.exists() && Instant::now() < ready_deadline {
        helper_exited_early = helper
            .try_wait()
            .expect("check native helper state")
            .is_some();
        if helper_exited_early {
            break;
        }
        sleep(Duration::from_millis(50));
    }
    if helper_exited_early || !ready.exists() {
        let _ = helper.kill();
        let _ = helper.wait();
        let _ = std::fs::remove_file(&ready);
        let _ = std::fs::remove_file(&leaked);
        panic!("AppContainer child did not create its ready marker");
    }

    helper
        .kill()
        .expect("simulate Noema Stop terminating the helper");
    let status = helper.wait().expect("wait for terminated helper");
    assert!(
        !status.success(),
        "terminated helper must not report success"
    );

    sleep(Duration::from_secs(7));
    let child_survived = leaked.exists();
    let _ = std::fs::remove_file(&ready);
    let _ = std::fs::remove_file(&leaked);
    assert!(
        !child_survived,
        "a child survived helper termination and wrote its delayed marker"
    );
    eprintln!("live_acceptance=stop child_residue=none");
}

#[cfg(windows)]
#[test]
#[ignore = "helper mode for the opt-in AppContainer Stop acceptance"]
fn windows_live_appcontainer_stop_helper() {
    assert_eq!(
        std::env::var("NOEMA_RUN_WINDOWS_LIVE_STOP_HELPER").as_deref(),
        Ok("1"),
        "this helper test is started only by the parent acceptance test"
    );
    let platform = crate::windows_probe::read_platform().expect("read current Windows version");
    assert!(
        platform.major == 10
            && platform.minor == 0
            && platform.build >= crate::protocol::MINIMUM_WINDOWS_BUILD
            && platform.architecture == "x86_64",
        "native command acceptance requires supported Windows 10 x64"
    );
    let package_sid = crate::appcontainer::derive_package_sid().expect("derive package SID");
    let profile_path = crate::appcontainer::probe_profile(&package_sid)
        .expect("Noema AppContainer profile is ready");
    let system_root = std::env::var("SystemRoot").expect("SystemRoot is available");
    let working_directory = Path::new(&system_root).join("System32");
    let working_directory = working_directory
        .to_str()
        .expect("System32 path is valid UTF-8 for this test");
    let environment_names = [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "PATH",
        "LOCALAPPDATA",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    let nonce = std::env::var("NOEMA_LIVE_STOP_NONCE").expect("fixed marker identity is passed");
    assert!(
        nonce.split_once('_').is_some_and(|(pid, ticks)| {
            !pid.is_empty()
                && !ticks.is_empty()
                && pid.bytes().all(|byte| byte.is_ascii_digit())
                && ticks.bytes().all(|byte| byte.is_ascii_digit())
        }),
        "marker identity contains only the parent PID and timestamp"
    );
    let ready = profile_path.join(format!("noema-stop-{nonce}.ready"));
    let leaked = profile_path.join(format!("noema-stop-{nonce}.leaked"));
    let ready_arg = crate::process::quote_windows_argument(
        &ready.as_os_str().encode_wide().collect::<Vec<_>>(),
    );
    let leaked_arg = crate::process::quote_windows_argument(
        &leaked.as_os_str().encode_wide().collect::<Vec<_>>(),
    );
    let command = format!(
        "echo ready > {ready_arg} & start /b \"\" cmd.exe /d /q /c \"@for /L %i in (1,1,10000000) do @rem & echo leaked > {leaked_arg}\""
    );

    let result = crate::process::run_appcontainer_command(
        &package_sid,
        &[],
        &command,
        working_directory,
        &environment_names,
        20_000,
    )
    .unwrap_or_else(|failure| panic!("Stop helper command fails: {}", failure.code));
    assert!(!result.timed_out);
}

#[test]
fn mismatched_network_identity_is_rejected_before_runner_admission() {
    let mut policy = valid_policy();
    policy.network.identity = "another_request_identity".to_string();
    let response = handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Execute {
            execution_id: "execution-01".to_string(),
            task_id: "task-01".to_string(),
            tool_call_id: "call-01".to_string(),
            user_data_path: "C:\\Users\\fixture\\AppData\\Roaming\\Noema".to_string(),
            package_sid: derive_package_sid().expect("package SID"),
            policy,
            grants: vec![],
            command: "whoami".to_string(),
            timeout_ms: 1_000,
        },
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "network_identity_mismatch" && stage == "admission"
    ));
}

#[test]
fn invalid_tool_identity_is_rejected_before_readiness_or_child_creation() {
    let policy = valid_policy();
    let response = handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Execute {
            execution_id: "execution-01".to_string(),
            task_id: "task-01".to_string(),
            tool_call_id: "invalid tool identity".to_string(),
            user_data_path: "C:\\Users\\fixture\\AppData\\Roaming\\Noema".to_string(),
            package_sid: derive_package_sid().expect("package SID"),
            policy,
            grants: vec![],
            command: "whoami".to_string(),
            timeout_ms: 1_000,
        },
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "tool_identity_invalid" && stage == "admission"
    ));
}

#[test]
fn native_admission_rejects_a_workspace_junction_before_readiness() {
    let test_root = create_test_root();
    let target = test_root.join("target");
    let alias = test_root.join("workspace-alias");
    std::fs::create_dir(&target).expect("create junction target");
    let output = std::process::Command::new("cmd.exe")
        .args(["/c", "mklink", "/J"])
        .arg(&alias)
        .arg(&target)
        .output()
        .expect("mklink starts");
    assert!(
        output.status.success(),
        "mklink /J creates fixture junction"
    );

    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &alias, &target);
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("junction policy is valid IPC JSON");
    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "path_reparse_point" && stage == "admission"
    ));

    std::fs::remove_dir(&alias).expect("remove fixture junction");
    std::fs::remove_dir_all(test_root).expect("remove temporary policy tree");
}

#[test]
fn native_admission_rejects_a_changed_file_identity_before_readiness() {
    let test_root = create_test_root();
    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &test_root, &test_root);
    let current = fixture["operation"]["policy"]["workspaceRoot"]["fileIdentity"]["fileIndex"]
        .as_str()
        .expect("file index is serialized as decimal text")
        .parse::<u64>()
        .expect("file index fits u64");
    fixture["operation"]["policy"]["workspaceRoot"]["fileIdentity"]["fileIndex"] =
        Value::String(if current == 1 {
            "2".to_string()
        } else {
            (current - 1).to_string()
        });
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("changed object identity is schema-valid IPC");
    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "path_identity_mismatch" && stage == "admission"
    ));
    std::fs::remove_dir_all(test_root).expect("remove temporary policy directory");
}

#[test]
fn native_write_root_scan_rejects_a_hard_link_before_setup_or_child_creation() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_target = test_root.join("outside-target.txt");
    std::fs::write(&external_target, b"outside data").expect("create external target");
    std::fs::hard_link(&external_target, workspace.join("linked.txt"))
        .expect("create workspace hard link");

    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &workspace, &workspace);
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("hard-link policy is valid IPC JSON");
    let Operation::Execute { policy, .. } = request.operation else {
        panic!("fixture must contain execute operation");
    };
    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("policy directories are pinned before write-root scanning");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );
    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove hard-link fixture");
}

#[test]
fn native_policy_accepts_a_single_file_read_write_root_and_checks_its_identity() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_file = test_root.join("authorized.txt");
    std::fs::write(&external_file, b"authorized file").expect("create authorized file");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let external_identity = crate::path_identity::file_identity_for_path(&external_file)
        .expect("single file has a native identity");
    let external_path = external_file.to_string_lossy().into_owned();
    let external_root = || PathRoot {
        path: external_path.clone(),
        file_identity: FileIdentity {
            volume_serial_number: external_identity.volume_serial_number.clone(),
            file_index: external_identity.file_index.clone(),
        },
    };
    policy.filesystem.read_roots.push(external_root());
    policy.filesystem.write_roots.push(external_root());

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens directory and file roots");
    assert_eq!(pins.scan_filesystem_roots(&policy), Ok(()));

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove single-file policy fixture");
}

#[test]
fn native_policy_rejects_a_hard_linked_single_file_write_root() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_file = test_root.join("authorized.txt");
    std::fs::write(&external_file, b"authorized file").expect("create authorized file");
    std::fs::hard_link(&external_file, test_root.join("outside-alias.txt"))
        .expect("create external hard link");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let external_identity = crate::path_identity::file_identity_for_path(&external_file)
        .expect("hard-linked file has a native identity");
    let external_path = external_file.to_string_lossy().into_owned();
    let external_root = || PathRoot {
        path: external_path.clone(),
        file_identity: FileIdentity {
            volume_serial_number: external_identity.volume_serial_number.clone(),
            file_index: external_identity.file_index.clone(),
        },
    };
    policy.filesystem.read_roots.push(external_root());
    policy.filesystem.write_roots.push(external_root());

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens the file before checking its links");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove hard-link policy fixture");
}

#[test]
fn native_policy_rejects_a_hard_linked_read_only_capability_root() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_file = test_root.join("authorized-read.txt");
    std::fs::write(&external_file, b"authorized data").expect("create authorized file");
    std::fs::hard_link(&external_file, test_root.join("outside-read-alias.txt"))
        .expect("create external hard link");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let identity = crate::path_identity::file_identity_for_path(&external_file)
        .expect("hard-linked file has a native identity");
    policy.filesystem.read_roots.push(PathRoot {
        path: external_file.to_string_lossy().into_owned(),
        file_identity: identity,
    });

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens the read-only capability root");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove read hard-link fixture");
}

#[test]
fn native_policy_rejects_a_hard_link_inside_a_read_only_directory_root() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    let runtime_root = test_root.join("approved-runtime");
    std::fs::create_dir(&workspace).expect("create workspace");
    std::fs::create_dir(&runtime_root).expect("create read-only runtime root");
    let external_target = test_root.join("outside-runtime-target.txt");
    std::fs::write(&external_target, b"outside data").expect("create external target");
    std::fs::hard_link(
        &external_target,
        runtime_root.join("linked-runtime-file.txt"),
    )
    .expect("create hard link inside the read-only root");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let identity = crate::path_identity::file_identity_for_path(&runtime_root)
        .expect("read-only directory has a native identity");
    policy.filesystem.read_roots.push(PathRoot {
        path: runtime_root.to_string_lossy().into_owned(),
        file_identity: identity,
    });

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens read-only directory roots");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove read-only directory hard-link fixture");
}

#[test]
fn native_policy_requires_workspace_and_working_directory_to_be_directories() {
    let test_root = create_test_root();
    let workspace_file = test_root.join("not-a-workspace-directory.txt");
    std::fs::write(&workspace_file, b"file").expect("create non-directory workspace");
    let path = workspace_file.to_string_lossy().into_owned();
    let identity = crate::path_identity::file_identity_for_path(&workspace_file)
        .expect("file has a native identity");
    let mut policy = valid_policy();
    policy.workspace_root.path = path.clone();
    policy.workspace_root.file_identity = FileIdentity {
        volume_serial_number: identity.volume_serial_number.clone(),
        file_index: identity.file_index.clone(),
    };
    policy.working_directory.path = path.clone();
    policy.working_directory.file_identity = FileIdentity {
        volume_serial_number: identity.volume_serial_number.clone(),
        file_index: identity.file_index.clone(),
    };
    for root in policy
        .filesystem
        .read_roots
        .iter_mut()
        .chain(policy.filesystem.write_roots.iter_mut())
    {
        root.path = path.clone();
        root.file_identity = FileIdentity {
            volume_serial_number: identity.volume_serial_number.clone(),
            file_index: identity.file_index.clone(),
        };
    }

    assert_eq!(
        crate::path_identity::verify_policy_paths(&policy).err(),
        Some("path_identity_unverified")
    );
    std::fs::remove_dir_all(test_root).expect("remove wrong-root-type fixture");
}

#[test]
fn native_admission_rejects_unsupported_network_policy_mode() {
    let mut policy = valid_policy();
    policy.network.mode = NetworkMode::PromptPerDestination;
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("network_policy_unsupported")
    );
}

#[test]
fn a_valid_serialized_policy_cannot_bypass_live_acl_admission() {
    let test_root = create_test_root();
    let mut policy = valid_policy();
    set_policy_root(&mut policy, &test_root);
    let response = crate::handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Execute {
            execution_id: "execution-01".to_string(),
            task_id: "task-01".to_string(),
            tool_call_id: "call-01".to_string(),
            user_data_path: "C:\\Users\\fixture\\AppData\\Roaming\\Noema".to_string(),
            package_sid: derive_package_sid().expect("package SID"),
            grants: grants_for_policy(&policy),
            policy,
            command: "whoami".to_string(),
            timeout_ms: 1_000,
        },
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { stage, .. } if stage == "admission"
    ));
    std::fs::remove_dir_all(test_root).expect("remove temporary policy directory");
}

#[test]
fn serialized_d2_policy_is_validated_before_live_acl_admission() {
    let test_root = create_test_root();
    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &test_root, &test_root);
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("complete D2 execute fixture parses through the IPC boundary");
    let Operation::Execute { policy, .. } = &request.operation else {
        panic!("fixture must contain an execute operation");
    };
    assert_eq!(policy.validate(&request.request_id), Ok(()));

    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { stage, .. } if stage == "admission"
    ));
    std::fs::remove_dir_all(test_root).expect("remove temporary policy directory");
}

#[test]
fn execute_rejects_capability_grants_that_do_not_match_current_policy() {
    let mut fixture = execute_fixture_value();
    fixture["operation"]["grants"][0]["access"] = Value::String("read".to_string());
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("execute request with a structurally valid but stale grant parses");
    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "acl_grants_mismatch" && stage == "admission"
    ));
}

#[test]
fn serialized_d2_policy_rejects_incomplete_unknown_and_unsupported_identity() {
    let mut missing = execute_fixture_value();
    missing["operation"]["policy"]
        .as_object_mut()
        .expect("policy is an object")
        .remove("environment");
    assert!(parse_request(&serde_json::to_vec(&missing).unwrap()).is_err());

    let mut unknown = execute_fixture_value();
    unknown["operation"]["policy"]["unexpected"] = Value::Bool(true);
    assert!(parse_request(&serde_json::to_vec(&unknown).unwrap()).is_err());

    for (path, value, expected) in [
        (
            &["version"][..],
            Value::from(1),
            "policy_version_unsupported",
        ),
        (
            &["backend", "id"][..],
            Value::from("other-runner"),
            "backend_identity_unsupported",
        ),
        (
            &["backend", "version"][..],
            Value::from("9.9.9"),
            "backend_identity_unsupported",
        ),
        (
            &["requestId"][..],
            Value::from("another_request_identity"),
            "policy_request_identity_mismatch",
        ),
    ] {
        let mut fixture = execute_fixture_value();
        let field = path.last().expect("policy field path is non-empty");
        let parent = path[..path.len() - 1]
            .iter()
            .fold(&mut fixture["operation"]["policy"], |current, segment| {
                &mut current[*segment]
            });
        parent[*field] = value;
        let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
            .expect("unsupported policy is still valid JSON schema");
        let Operation::Execute { policy, .. } = request.operation else {
            panic!("fixture must contain execute operation");
        };
        assert_eq!(policy.validate(&request.request_id), Err(expected));
    }
}

#[test]
fn serialized_ipc_request_enforces_the_size_limit() {
    let oversized = vec![b' '; crate::MAX_REQUEST_BYTES + 1];
    assert!(matches!(
        parse_request(&oversized),
        Err("request_too_large")
    ));
}

#[test]
fn policy_rejects_ambient_read_or_write_modes() {
    let mut policy = valid_policy();
    policy.filesystem.default_deny = false;
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("filesystem_default_deny_required")
    );
}

#[test]
fn policy_rejects_a_path_without_main_process_identity_preflight() {
    let mut policy = valid_policy();
    policy.filesystem.read_roots[0]
        .file_identity
        .file_index
        .clear();
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("path_identity_unverified")
    );
}

#[test]
fn policy_rejects_win32_path_aliases_before_admission() {
    for unsafe_path in [
        "C:\\workspace\\file:stream",
        "C:\\workspace\\trailing.",
        "C:\\workspace\\trailing ",
        "C:\\workspace\\CON.txt",
        "C:\\workspace\\COM¹",
        "C:\\workspace\\bad?name",
        "C:\\workspace\\..\\outside",
    ] {
        let mut policy = valid_policy();
        policy.workspace_root.path = unsafe_path.to_string();
        assert_eq!(
            policy.validate("execution_request_01"),
            Err("path_identity_unverified"),
            "unsafe path must be rejected without echoing it"
        );
    }
}

#[test]
fn policy_requires_workspace_roots_and_confines_the_working_directory() {
    let mut outside = valid_policy();
    outside.working_directory = PathRoot {
        path: "C:\\workspace-sibling".to_string(),
        file_identity: FileIdentity {
            volume_serial_number: "1".to_string(),
            file_index: "1".to_string(),
        },
    };
    assert_eq!(
        outside.validate("execution_request_01"),
        Err("working_directory_outside_workspace")
    );

    let mut missing_workspace_grant = valid_policy();
    missing_workspace_grant.filesystem.write_roots[0].path = "C:\\other-workspace".to_string();
    assert_eq!(
        missing_workspace_grant.validate("execution_request_01"),
        Err("filesystem_policy_invalid")
    );
}

#[test]
fn current_policy_binds_one_mode_specific_sid_to_every_read_root() {
    let mut policy = valid_policy();
    let external = PathRoot {
        path: "D:\\reference".to_string(),
        file_identity: FileIdentity {
            volume_serial_number: "55".to_string(),
            file_index: "202".to_string(),
        },
    };
    policy.filesystem.read_roots.push(external.clone());
    let workspace = policy.workspace_root.path.clone();
    let workspace_identity = policy.workspace_root.file_identity.clone();
    let grants = vec![
        crate::policy::AclGrant {
            path: workspace,
            file_identity: workspace_identity,
            capability_name:
                "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                    .to_string(),
            access: crate::policy::FilesystemAccessMode::Write,
            is_directory: true,
        },
        crate::policy::AclGrant {
            path: external.path.clone(),
            file_identity: external.file_identity.clone(),
            capability_name:
                "Noema.Read.2222222222222222222222222222222222222222222222222222222222222222"
                    .to_string(),
            access: crate::policy::FilesystemAccessMode::Read,
            is_directory: true,
        },
    ];
    assert_eq!(
        policy.verified_capability_names(&grants),
        Ok(vec![
            "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                .to_string(),
            "Noema.Read.2222222222222222222222222222222222222222222222222222222222222222"
                .to_string(),
        ])
    );

    let mut stale_access = grants.clone();
    stale_access[1].access = crate::policy::FilesystemAccessMode::Write;
    assert_eq!(
        policy.verified_capability_names(&stale_access),
        Err("acl_grants_mismatch")
    );
    let mut stale_identity = grants.clone();
    stale_identity[1].file_identity.file_index = "303".to_string();
    assert_eq!(
        policy.verified_capability_names(&stale_identity),
        Err("acl_grants_mismatch")
    );
    let mut duplicate_sid = grants.clone();
    duplicate_sid[1].capability_name = duplicate_sid[0].capability_name.clone();
    assert_eq!(
        policy.verified_capability_names(&duplicate_sid),
        Err("acl_grants_mismatch")
    );
    assert_eq!(
        policy.verified_capability_names(&grants[..1]),
        Err("acl_grants_mismatch")
    );
}

#[test]
fn policy_request_identity_must_match_the_ipc_envelope() {
    let mut policy = valid_policy();
    policy.request_id = "another_request_identity".to_string();
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("policy_request_identity_mismatch")
    );
}

#[test]
fn implemented_probe_capabilities_match_the_os_enforcement_evidence() {
    let capabilities = crate::protocol::Capabilities::implemented();
    assert!(
        capabilities.filesystem_default_deny
            && capabilities.filesystem_read_allowlist
            && capabilities.filesystem_write_allowlist
            && capabilities.path_identity_validation
            && capabilities.working_directory_confinement
            && capabilities.environment_confinement
            && capabilities.network_default_deny
            && !capabilities.identity_bound_network_broker
            && capabilities.job_process_tree
            && capabilities.bounded_stdio
    );
}

#[test]
fn incomplete_setup_probe_serializes_typed_blockers_and_never_reports_ready() {
    let probe = crate::not_ready_probe(crate::protocol::PlatformInfo {
        major: 10,
        minor: 0,
        build: 19_045,
        ubr: 7_807,
        architecture: "x64".to_string(),
    });
    let json = serde_json::to_value(probe).expect("probe serializes");

    assert_eq!(json["type"], "probe");
    assert_eq!(json["ready"], false);
    assert_eq!(json["setupStatus"], "not_implemented");
    assert_eq!(json["blockers"][0], "runner_implementation_incomplete");
    assert_eq!(json["blockers"][1], "sandbox_setup_unavailable");
    assert_eq!(json["capabilities"]["filesystemDefaultDeny"], false);
    assert_eq!(json["platform"]["build"], 19_045);
    assert_eq!(json["platform"]["ubr"], 7_807);
}

#[test]
fn request_protocol_rejects_unknown_fields() {
    let parsed = serde_json::from_str::<RequestEnvelope>(
        r#"{"protocolVersion":8,"requestId":"execution_request_01","operation":{"type":"probe","extra":true}}"#,
    );
    assert!(parsed.is_err());
}

#[test]
fn acl_protocol_operations_are_strictly_versioned_and_evidence_is_serializable() {
    let mut request = execute_fixture_value();
    request["operation"] = serde_json::json!({
        "type": "verify_filesystem_root_acls",
        "grants": [{
            "path": request["operation"]["policy"]["workspaceRoot"]["path"].clone(),
            "fileIdentity": request["operation"]["policy"]["workspaceRoot"]["fileIdentity"].clone(),
            "capabilityName": "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
            "access": "write",
            "isDirectory": true
        }]
    });
    assert!(matches!(
        parse_request(&serde_json::to_vec(&request).unwrap())
            .expect("strict ACL verification request parses")
            .operation,
        Operation::VerifyFilesystemRootAcls { .. }
    ));

    request["operation"]["policy"] = Value::Object(Default::default());
    assert!(parse_request(&serde_json::to_vec(&request).unwrap()).is_err());

    request["operation"]
        .as_object_mut()
        .unwrap()
        .remove("policy");
    request["operation"]["unexpected"] = Value::Bool(true);
    assert!(parse_request(&serde_json::to_vec(&request).unwrap()).is_err());

    let response = crate::protocol::ResponseEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: Some("execution_request_01".to_string()),
        result: ResultFrame::AclEvidence {
            backend_id: crate::protocol::BACKEND_ID.to_string(),
            backend_version: env!("CARGO_PKG_VERSION").to_string(),
            evidence: vec![crate::policy::VerifiedAclGrantEvidence {
                volume_serial_number: "1".to_string(),
                file_index: "2".to_string(),
                capability_name:
                    "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                        .to_string(),
                access: crate::policy::FilesystemAccessMode::Write,
                object_count: 1,
                acl_verified_count: 1,
                tree_digest: "00".repeat(32),
                inheritance_verified: true,
            }],
        },
    };
    let json = serde_json::to_value(response).expect("ACL evidence response serializes");
    assert_eq!(json["result"]["type"], "acl_evidence");
    assert_eq!(json["result"]["backendId"], crate::protocol::BACKEND_ID);
    assert_eq!(json["result"]["backendVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(json["result"]["evidence"][0]["aclVerifiedCount"], 1);
}

#[test]
fn readiness_fixture_accepts_only_a_complete_current_report() {
    assert_eq!(
        parse_readiness_response(READY_READINESS_FIXTURE, "execution_request_01"),
        Ok(())
    );
}

#[test]
fn readiness_rejects_each_missing_required_field() {
    for path in [
        &["result", "backendVersion"][..],
        &["result", "policyVersion"][..],
        &["result", "ready"][..],
        &["result", "setupStatus"][..],
        &["result", "capabilities", "jobProcessTree"][..],
        &["result", "platform", "ubr"][..],
    ] {
        let mut fixture = readiness_fixture_value();
        remove_json_field(&mut fixture, path);
        assert_eq!(
            parse_readiness_response(&fixture.to_string(), "execution_request_01"),
            Err("readiness_response_invalid"),
            "missing readiness field must reject: {}",
            path.join(".")
        );
    }
}

#[test]
fn readiness_rejects_unsupported_protocol_helper_and_policy_versions() {
    assert_readiness_rejected(
        &["protocolVersion"],
        serde_json::json!(0),
        "protocol_version_unsupported",
    );
    assert_readiness_rejected(
        &["result", "backendVersion"],
        serde_json::json!("0.0.9"),
        "helper_version_unsupported",
    );
    assert_readiness_rejected(
        &["result", "policyVersion"],
        serde_json::json!(0),
        "policy_version_unsupported",
    );
}

#[test]
fn readiness_rejects_unsupported_windows_build() {
    assert_readiness_rejected(
        &["result", "platform", "build"],
        serde_json::json!(19_044),
        "os_baseline_unsupported",
    );
}

#[test]
fn readiness_accepts_windows_10_with_older_security_ubr() {
    let mut fixture = readiness_fixture_value();
    fixture["result"]["platform"]["ubr"] = serde_json::json!(6_093);
    let response = serde_json::from_value(fixture).expect("readiness fixture deserializes");
    assert_eq!(
        crate::protocol::validate_readiness_response(&response, "execution_request_01"),
        Ok(())
    );
}

#[test]
fn readiness_rejects_incomplete_setup_and_missing_capabilities() {
    assert_readiness_rejected(
        &["result", "setupStatus"],
        serde_json::json!("incomplete"),
        "sandbox_setup_unavailable",
    );
    assert_readiness_rejected(
        &["result", "capabilities", "jobProcessTree"],
        serde_json::json!(false),
        "required_capability_missing",
    );
    assert_readiness_rejected(
        &["result", "ready"],
        serde_json::json!(false),
        "runner_not_ready",
    );
    assert_readiness_rejected(
        &["result", "blockers"],
        serde_json::json!(["runner_implementation_incomplete"]),
        "runner_not_ready",
    );
}

#[test]
fn readiness_rejects_a_response_for_a_different_request() {
    assert_eq!(
        parse_readiness_response(READY_READINESS_FIXTURE, "another_request_identity"),
        Err("readiness_request_identity_mismatch")
    );

    let mut fixture = readiness_fixture_value();
    fixture
        .as_object_mut()
        .expect("fixture envelope is an object")
        .remove("requestId");
    assert_eq!(
        parse_readiness_response(&fixture.to_string(), "execution_request_01"),
        Err("readiness_request_identity_mismatch")
    );
}

#[test]
fn unsupported_protocol_versions_are_denied_before_operation_dispatch() {
    let response = crate::handle_request(RequestEnvelope {
        protocol_version: 2,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Probe {},
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "protocol_version_unsupported" && stage == "protocol"
    ));
}

pub(crate) fn valid_policy() -> WindowsCommandPolicyV2 {
    let root = || PathRoot {
        path: "C:\\workspace".to_string(),
        file_identity: FileIdentity {
            volume_serial_number: "1".to_string(),
            file_index: "1".to_string(),
        },
    };
    WindowsCommandPolicyV2 {
        version: 2,
        backend: BackendIdentity {
            id: crate::protocol::BACKEND_ID.to_string(),
            version: "0.1.0".to_string(),
        },
        request_id: "execution_request_01".to_string(),
        workspace_root: root(),
        filesystem: FilesystemPolicy {
            read_roots: vec![root()],
            write_roots: vec![root()],
            default_deny: true,
        },
        working_directory: root(),
        environment: EnvironmentPolicy {
            inherit: false,
            allow_names: vec![
                "SystemRoot".to_string(),
                "WINDIR".to_string(),
                "TEMP".to_string(),
                "TMP".to_string(),
                "PATH".to_string(),
                "LOCALAPPDATA".to_string(),
            ],
        },
        network: NetworkPolicy {
            mode: NetworkMode::Deny,
            identity: "execution_request_01".to_string(),
        },
    }
}

fn create_test_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("noema-runner-policy-{nonce}"));
    std::fs::create_dir(&path).expect("create temporary policy directory");
    path
}

fn set_policy_root(policy: &mut WindowsCommandPolicyV2, path: &Path) {
    let path = path.to_string_lossy().into_owned();
    let identity = crate::path_identity::file_identity_for_directory(Path::new(&path))
        .expect("test directory has a native file identity");
    policy.workspace_root.path = path.clone();
    policy.workspace_root.file_identity = identity;
    for root in policy
        .filesystem
        .read_roots
        .iter_mut()
        .chain(policy.filesystem.write_roots.iter_mut())
    {
        root.path = path.clone();
        root.file_identity = crate::path_identity::file_identity_for_directory(Path::new(&path))
            .expect("test directory has a native file identity");
    }
    policy.working_directory.path = path.clone();
    policy.working_directory.file_identity =
        crate::path_identity::file_identity_for_directory(Path::new(&path))
            .expect("test directory has a native file identity");
}

fn grants_for_policy(policy: &WindowsCommandPolicyV2) -> Vec<crate::policy::AclGrant> {
    policy
        .filesystem
        .read_roots
        .iter()
        .enumerate()
        .map(|(index, root)| {
            let key = root.path.to_ascii_lowercase();
            let access = if policy
                .filesystem
                .write_roots
                .iter()
                .any(|write_root| write_root.path.to_ascii_lowercase() == key)
            {
                crate::policy::FilesystemAccessMode::Write
            } else {
                crate::policy::FilesystemAccessMode::Read
            };
            crate::policy::AclGrant {
                path: root.path.clone(),
                file_identity: root.file_identity.clone(),
                capability_name: format!("Noema.Write.{index:064x}"),
                access,
                is_directory: true,
            }
        })
        .collect()
}

fn set_execute_fixture_root(fixture: &mut Value, path: &Path, identity_path: &Path) {
    let path = path.to_string_lossy().into_owned();
    let identity = crate::path_identity::file_identity_for_directory(identity_path)
        .expect("identity source has a native file identity");
    let policy = &mut fixture["operation"]["policy"];
    policy["workspaceRoot"]["path"] = Value::String(path.clone());
    policy["workspaceRoot"]["fileIdentity"] =
        serde_json::to_value(&identity).expect("file identity serializes");
    policy["workingDirectory"]["path"] = Value::String(path.clone());
    policy["workingDirectory"]["fileIdentity"] =
        serde_json::to_value(&identity).expect("file identity serializes");
    for key in ["readRoots", "writeRoots"] {
        for root in policy["filesystem"][key]
            .as_array_mut()
            .expect("root list exists")
        {
            root["path"] = Value::String(path.clone());
            root["fileIdentity"] =
                serde_json::to_value(&identity).expect("file identity serializes");
        }
    }
    for grant in fixture["operation"]["grants"]
        .as_array_mut()
        .expect("grant list exists")
    {
        grant["path"] = Value::String(path.clone());
        grant["fileIdentity"] = serde_json::to_value(&identity).expect("identity serializes");
        grant["isDirectory"] = Value::Bool(true);
    }
}

const SERIALIZED_EXECUTE_FIXTURE: &str = r#"{
    "protocolVersion": 8,
    "requestId": "execution_request_01",
    "operation": {
        "type": "execute",
        "executionId": "execution-01",
        "taskId": "task-01",
        "toolCallId": "call-01",
        "userDataPath": "C:\\Users\\fixture\\AppData\\Roaming\\Noema",
        "policy": {
            "version": 2,
            "backend": {
                "id": "noema-codex-windows",
                "version": "0.1.0"
            },
            "requestId": "execution_request_01",
            "workspaceRoot": {
                "path": "C:\\workspace",
                "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
            },
            "filesystem": {
                "readRoots": [{
                    "path": "C:\\workspace",
                    "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
                }],
                "writeRoots": [{
                    "path": "C:\\workspace",
                    "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
                }],
                "defaultDeny": true
            },
            "workingDirectory": {
                "path": "C:\\workspace\\src",
                "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
            },
            "environment": {
                "inherit": false,
                "allowNames": ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "LOCALAPPDATA"]
            },
            "network": {
                "mode": "deny",
                "identity": "execution_request_01"
            }
        },
        "grants": [{
            "path": "C:\\workspace",
            "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" },
            "capabilityName": "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
            "access": "write",
            "isDirectory": true
        }],
        "command": "whoami",
        "timeoutMs": 1000
    }
}"#;

fn execute_fixture_value() -> Value {
    let mut value: Value = serde_json::from_str(SERIALIZED_EXECUTE_FIXTURE)
        .expect("static serialized execute fixture is valid JSON");
    value["operation"]["packageSid"] =
        Value::String(derive_package_sid().expect("current AppContainer package SID"));
    value
}

const READY_READINESS_FIXTURE: &str = r#"{
    "protocolVersion": 8,
    "requestId": "execution_request_01",
    "result": {
        "type": "probe",
        "backendId": "noema-codex-windows",
        "backendVersion": "0.1.0",
        "policyVersion": 2,
        "ready": true,
        "blockers": [],
        "setupStatus": "ready",
        "capabilities": {
            "filesystemDefaultDeny": true,
            "filesystemReadAllowlist": true,
            "filesystemWriteAllowlist": true,
            "pathIdentityValidation": true,
            "workingDirectoryConfinement": true,
            "environmentConfinement": true,
            "networkDefaultDeny": true,
            "identityBoundNetworkBroker": false,
            "jobProcessTree": true,
            "boundedStdio": true
        },
        "platform": {
            "major": 10,
            "minor": 0,
            "build": 19045,
            "ubr": 6093,
            "architecture": "x86_64"
        }
    }
}"#;

fn readiness_fixture_value() -> Value {
    serde_json::from_str(READY_READINESS_FIXTURE).expect("static readiness fixture is valid JSON")
}

fn remove_json_field(value: &mut Value, path: &[&str]) {
    let (field, parents) = path.split_last().expect("field path is not empty");
    let parent = parents.iter().fold(value, |current, segment| {
        current
            .get_mut(*segment)
            .expect("fixture path exists while removing field")
    });
    parent
        .as_object_mut()
        .expect("fixture parent is an object")
        .remove(*field)
        .expect("fixture field exists while removing field");
}

fn assert_readiness_rejected(path: &[&str], replacement: Value, expected: &'static str) {
    let mut fixture = readiness_fixture_value();
    let target = path.iter().fold(&mut fixture, |current, segment| {
        current
            .get_mut(*segment)
            .expect("fixture path exists while replacing field")
    });
    *target = replacement;
    assert_eq!(
        parse_readiness_response(&fixture.to_string(), "execution_request_01"),
        Err(expected),
        "readiness fixture must reject {}",
        path.join(".")
    );
}

#[test]
fn sandbox_setup_ipc_schema_is_strict_and_probe_fails_closed() {
    for operation_type in ["reconcile_sandbox_setup", "probe_sandbox_setup"] {
        let request_id = "setup_operation_0001";
        let request = serde_json::json!({
            "protocolVersion": 8,
            "requestId": request_id,
            "operation": {
                "type": operation_type,
                "operationId": request_id,
                "userDataPath": "C:\\Users\\fixture\\AppData\\Roaming\\Noema"
            }
        });
        let parsed = parse_request(&serde_json::to_vec(&request).unwrap())
            .expect("setup request follows the strict operation schema");
        if operation_type == "probe_sandbox_setup" {
            assert!(matches!(
                parsed.operation,
                Operation::ProbeSandboxSetup { .. }
            ));
        } else {
            assert!(matches!(
                parsed.operation,
                Operation::ReconcileSandboxSetup { .. }
            ));
        }

        let mut with_unknown_field = request;
        with_unknown_field["operation"]["secret"] = Value::String("reject-me".to_string());
        assert_eq!(
            parse_request(&serde_json::to_vec(&with_unknown_field).unwrap()).err(),
            Some("request_invalid")
        );
    }
}

#[test]
fn sandbox_setup_probe_reports_profile_evidence_without_machine_firewall_state() {
    let missing_profile = setup_probe_response(
        "setup_operation_0001".to_string(),
        "setup_operation_0001".to_string(),
        "S-1-15-2-100-200-300-400-500-600-700".to_string(),
        false,
    );
    assert!(matches!(
        missing_profile.result,
        ResultFrame::SetupEvidence { evidence, .. }
            if !evidence.profile_valid
    ));

    let ready_profile = setup_probe_response(
        "setup_operation_0002".to_string(),
        "setup_operation_0002".to_string(),
        "S-1-15-2-100-200-300-400-500-600-700".to_string(),
        true,
    );
    assert!(matches!(
        ready_profile.result,
        ResultFrame::SetupEvidence { evidence, .. }
            if evidence.profile_valid
    ));
}

#[test]
fn sandbox_setup_operation_identity_must_match_request_identity() {
    let response = handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "setup_operation_0001".to_string(),
        operation: Operation::ReconcileSandboxSetup {
            operation_id: "setup_operation_0002".to_string(),
            user_data_path: r"C:\Users\fixture\AppData\Roaming\Noema".to_string(),
        },
    });
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "setup_operation_identity_mismatch" && stage == "setup"
    ));
}

#[test]
fn setup_user_data_path_requires_a_bounded_local_drive_path() {
    assert_eq!(
        validate_setup_user_data_path(r"C:\Users\fixture\AppData\Roaming\Noema"),
        Ok(())
    );
    for path in [
        r"relative\Noema",
        r"\\server\share\Noema",
        r"\\?\C:\Users\fixture\Noema",
        r"C:\Users\fixture\..\Noema",
        r"C:\",
    ] {
        assert_eq!(
            validate_setup_user_data_path(path),
            Err("setup_user_data_path_invalid"),
            "reject unsafe setup root {path}"
        );
    }
    assert_eq!(
        validate_setup_user_data_path(&format!("C:\\{}", "x".repeat(1022))),
        Err("setup_user_data_path_invalid")
    );
}

#[test]
fn restricted_agent_cannot_reenter_native_setup_operations() {
    let response = setup_operation_denied(
        "setup_operation_0001".to_string(),
        "setup_operation_0001".to_string(),
        "runner_caller_restricted",
    );
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "runner_caller_restricted" && stage == "setup"
    ));
}
