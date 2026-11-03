mod policy;
mod protocol;

#[cfg(windows)]
mod acl;
#[cfg(windows)]
mod appcontainer;
#[cfg(windows)]
mod path_identity;
#[cfg(windows)]
mod process;
#[cfg(windows)]
mod setup_mutex;
#[cfg(windows)]
mod wfp;
#[cfg(windows)]
mod windows_probe;

use std::io::{self, BufRead, Read, Write};

const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;

fn main() {
    #[cfg(windows)]
    let arguments = std::env::args().collect::<Vec<_>>();
    #[cfg(windows)]
    if arguments.get(1).map(String::as_str) == Some(wfp::ELEVATED_WORKER_ARGUMENT) {
        std::process::exit(
            if arguments.len() == 4
                && wfp::run_elevated_worker(&arguments[2], &arguments[3]).is_ok()
            {
                0
            } else {
                1
            },
        );
    }
    #[cfg(windows)]
    if arguments.get(1).map(String::as_str) == Some(wfp::ELEVATED_REMOVE_WORKER_ARGUMENT) {
        std::process::exit(
            if arguments.len() == 3 && wfp::run_elevated_remove_worker(&arguments[2]).is_ok() {
                0
            } else {
                1
            },
        );
    }

    let response = match read_request() {
        Ok(request) => handle_request(request),
        Err(code) => protocol::ResponseEnvelope::error(protocol::PROTOCOL_VERSION, code),
    };

    let stdout = io::stdout();
    let mut output = stdout.lock();
    if serde_json::to_writer(&mut output, &response).is_err() {
        std::process::exit(2);
    }
    if output.write_all(b"\n").is_err() || output.flush().is_err() {
        std::process::exit(2);
    }
}

fn read_request() -> Result<protocol::RequestEnvelope, &'static str> {
    let stdin = io::stdin();
    let mut line = Vec::new();
    let bytes_read = stdin
        .lock()
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_until(b'\n', &mut line)
        .map_err(|_| "request_read_failed")?;
    if bytes_read == 0 {
        return Err("request_missing");
    }
    if line.len() > MAX_REQUEST_BYTES {
        return Err("request_too_large");
    }
    parse_request(&line)
}

fn parse_request(bytes: &[u8]) -> Result<protocol::RequestEnvelope, &'static str> {
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err("request_too_large");
    }
    serde_json::from_slice(bytes).map_err(|_| "request_invalid")
}

fn handle_request(request: protocol::RequestEnvelope) -> protocol::ResponseEnvelope {
    if request.protocol_version != protocol::PROTOCOL_VERSION {
        return protocol::ResponseEnvelope::error(
            protocol::PROTOCOL_VERSION,
            "protocol_version_unsupported",
        );
    }
    if !protocol::valid_request_id(&request.request_id) {
        return protocol::ResponseEnvelope::error(
            protocol::PROTOCOL_VERSION,
            "request_identity_invalid",
        );
    }

    match request.operation {
        protocol::Operation::Probe {} => probe(request.request_id),
        protocol::Operation::Execute {
            execution_id,
            task_id,
            tool_call_id,
            user_data_path,
            package_sid,
            policy,
            grants,
            command,
            timeout_ms,
        } => {
            #[cfg(windows)]
            let mut path_pins = None;
            #[cfg(windows)]
            let mut grant_pins = None;
            let mut capability_names = None;
            let denial = {
                #[cfg(windows)]
                let caller_denial = acl::require_unrestricted_caller().err();
                #[cfg(not(windows))]
                let caller_denial: Option<&'static str> = None;

                caller_denial
                    .or_else(|| {
                        (!protocol::valid_trace_identity(&execution_id))
                            .then_some("execution_identity_invalid")
                    })
                    .or_else(|| {
                        (!protocol::valid_trace_identity(&task_id))
                            .then_some("task_identity_invalid")
                    })
                    .or_else(|| {
                        (!protocol::valid_trace_identity(&tool_call_id))
                            .then_some("tool_identity_invalid")
                    })
                    .or_else(|| policy.validate(&request.request_id).err())
                    .or_else(|| match policy.verified_capability_names(&grants) {
                        Ok(names) => {
                            capability_names = Some(names);
                            None
                        }
                        Err(code) => Some(code),
                    })
                    .or_else(|| {
                        #[cfg(windows)]
                        {
                            if !appcontainer::is_appcontainer_package_sid(&package_sid) {
                                return Some("appcontainer_package_sid_invalid");
                            }
                            match appcontainer::derive_package_sid() {
                                Ok(derived) if derived == package_sid => None,
                                Ok(_) => Some("appcontainer_profile_identity_mismatch"),
                                Err(code) => Some(code),
                            }
                        }
                        #[cfg(not(windows))]
                        {
                            Some("windows_required")
                        }
                    })
                    .or_else(|| {
                        #[cfg(windows)]
                        {
                            match path_identity::verify_policy_paths(&policy) {
                                Ok(pins) => {
                                    path_pins = Some(pins);
                                    match path_identity::verify_filesystem_root_paths(&grants) {
                                        Ok(pins) => {
                                            grant_pins = Some(pins);
                                            None
                                        }
                                        Err(code) => Some(code),
                                    }
                                }
                                Err(code) => Some(code),
                            }
                        }
                        #[cfg(not(windows))]
                        {
                            Some("windows_required")
                        }
                    })
                    .or_else(|| {
                        (command.trim().is_empty() || command.len() > 8_000)
                            .then_some("command_invalid")
                    })
                    .or_else(|| {
                        (timeout_ms == 0 || timeout_ms > 180_000).then_some("timeout_invalid")
                    })
                    .or_else(|| {
                        #[cfg(windows)]
                        {
                            validate_setup_user_data_path(&user_data_path).err()
                        }
                        #[cfg(not(windows))]
                        {
                            Some("windows_required")
                        }
                    })
                    .or_else(|| {
                        protocol::validate_readiness_response(
                            &probe(request.request_id.clone()),
                            &request.request_id,
                        )
                        .err()
                    })
                    .or_else(|| {
                        #[cfg(windows)]
                        {
                            path_pins
                                .as_ref()
                                .and_then(|pins| pins.scan_filesystem_roots(&policy).err())
                        }
                        #[cfg(not(windows))]
                        {
                            None
                        }
                    })
                    .or_else(|| {
                        #[cfg(windows)]
                        {
                            grant_pins
                                .as_ref()
                                .and_then(|_| run_windows_acl_operation(&grants, false).err())
                        }
                        #[cfg(not(windows))]
                        {
                            None
                        }
                    })
            };
            let result = if let Some(code) = denial {
                protocol::ResultFrame::Denied {
                    code: code.to_string(),
                    stage: "admission".to_string(),
                }
            } else {
                #[cfg(windows)]
                {
                    match process::run_appcontainer_command(
                        &package_sid,
                        capability_names.as_deref().unwrap_or_default(),
                        &command,
                        &policy.working_directory.path,
                        &policy.environment.allow_names,
                        timeout_ms,
                    ) {
                        Ok(command_result) => protocol::ResultFrame::CommandComplete {
                            backend_id: protocol::BACKEND_ID.to_string(),
                            backend_version: env!("CARGO_PKG_VERSION").to_string(),
                            child_started: command_result.child_started,
                            exit_code: command_result.exit_code,
                            duration_ms: command_result.duration_ms,
                            timed_out: command_result.timed_out,
                            stdout: command_result.stdout,
                            stderr: command_result.stderr,
                            stdout_truncated: command_result.stdout_truncated,
                            stderr_truncated: command_result.stderr_truncated,
                        },
                        Err(failure) if failure.outcome_unknown => {
                            protocol::ResultFrame::CommandOutcomeUnknown {
                                backend_id: protocol::BACKEND_ID.to_string(),
                                backend_version: env!("CARGO_PKG_VERSION").to_string(),
                                child_started: failure.child_started,
                                code: failure.code.to_string(),
                                cleanup_confirmed: failure.cleanup_confirmed,
                                stdout: Vec::new(),
                                stderr: Vec::new(),
                                stdout_truncated: false,
                                stderr_truncated: false,
                            }
                        }
                        Err(failure) => protocol::ResultFrame::Denied {
                            code: failure.code.to_string(),
                            stage: "runner_launch".to_string(),
                        },
                    }
                }
                #[cfg(not(windows))]
                {
                    protocol::ResultFrame::Denied {
                        code: "windows_required".to_string(),
                        stage: "runner_launch".to_string(),
                    }
                }
            };
            let response = protocol::ResponseEnvelope {
                protocol_version: protocol::PROTOCOL_VERSION,
                request_id: Some(request.request_id),
                result,
            };
            #[cfg(windows)]
            drop(path_pins);
            #[cfg(windows)]
            drop(grant_pins);
            response
        }
        protocol::Operation::ReconcileFilesystemRootAcls { grants } => {
            handle_acl_operation(request.request_id, grants, true)
        }
        protocol::Operation::VerifyFilesystemRootAcls { grants } => {
            handle_acl_operation(request.request_id, grants, false)
        }
        protocol::Operation::ReconcileSandboxSetup {
            operation_id,
            user_data_path,
        } => handle_setup_operation(request.request_id, operation_id, user_data_path, true),
        protocol::Operation::ProbeSandboxSetup {
            operation_id,
            user_data_path,
        } => handle_setup_operation(request.request_id, operation_id, user_data_path, false),
        protocol::Operation::RemoveSandboxSetup { operation_id } => {
            handle_setup_removal(request.request_id, operation_id)
        }
    }
}

fn handle_setup_removal(request_id: String, operation_id: String) -> protocol::ResponseEnvelope {
    #[cfg(windows)]
    let result = acl::require_unrestricted_caller().and_then(|()| {
        if request_id != operation_id {
            return Err("setup_operation_identity_mismatch");
        }
        let package_sid = appcontainer::derive_package_sid()?;
        wfp::remove_with_uac(&package_sid)
    });
    #[cfg(not(windows))]
    let result: Result<(), &'static str> = Err("windows_required");

    let frame = match result {
        Ok(()) => protocol::ResultFrame::SetupRemoved {
            backend_id: protocol::BACKEND_ID.to_string(),
            backend_version: env!("CARGO_PKG_VERSION").to_string(),
            operation_id: operation_id.clone(),
        },
        Err(code) => protocol::ResultFrame::Denied {
            code: if request_id != operation_id {
                "setup_operation_identity_mismatch".to_string()
            } else {
                code.to_string()
            },
            stage: "setup".to_string(),
        },
    };
    protocol::ResponseEnvelope {
        protocol_version: protocol::PROTOCOL_VERSION,
        request_id: Some(request_id),
        result: frame,
    }
}

fn handle_setup_operation(
    request_id: String,
    operation_id: String,
    user_data_path: String,
    reconcile: bool,
) -> protocol::ResponseEnvelope {
    #[cfg(windows)]
    let caller_check = acl::require_unrestricted_caller()
        .and_then(|()| validate_setup_user_data_path(&user_data_path));
    #[cfg(not(windows))]
    let caller_check = Err("windows_required");

    if let Err(code) = caller_check {
        return setup_operation_denied(request_id, operation_id, code);
    }
    if request_id != operation_id {
        return setup_operation_denied(
            request_id,
            operation_id,
            "setup_operation_identity_mismatch",
        );
    }
    if !reconcile {
        #[cfg(windows)]
        return handle_setup_probe(request_id, operation_id);
        #[cfg(not(windows))]
        return setup_operation_denied(request_id, operation_id, "windows_required");
    }

    #[cfg(windows)]
    {
        let package_sid = match (|| {
            let setup_lock = setup_mutex::acquire_windows_runner_setup_lock(
                setup_mutex::DEFAULT_SETUP_MUTEX_TIMEOUT_MS,
            )?;
            setup_mutex::validate_abandoned_setup_action(setup_lock.was_abandoned(), true)?;
            appcontainer::ensure_profile()
        })() {
            Ok(value) => value,
            Err(code) => return setup_operation_denied(request_id, operation_id, code),
        };
        if let Err(code) = wfp::install_with_uac(&package_sid) {
            return setup_operation_denied(request_id, operation_id, code);
        }
        return protocol::ResponseEnvelope {
            protocol_version: protocol::PROTOCOL_VERSION,
            request_id: Some(request_id),
            result: protocol::ResultFrame::SetupReconciled {
                backend_id: protocol::BACKEND_ID.to_string(),
                backend_version: env!("CARGO_PKG_VERSION").to_string(),
                operation_id,
                package_sid,
            },
        };
    }

    #[cfg(not(windows))]
    setup_operation_denied(request_id, operation_id, "windows_required")
}

#[cfg(windows)]
fn handle_setup_probe(request_id: String, operation_id: String) -> protocol::ResponseEnvelope {
    let package_sid = match appcontainer::derive_package_sid() {
        Ok(value) => value,
        Err(code) => return setup_operation_denied(request_id, operation_id, code),
    };
    let profile_valid = appcontainer::probe_profile(&package_sid).is_ok();
    let network_filters_valid = wfp::probe_network_deny(&package_sid).unwrap_or(false);
    protocol::ResponseEnvelope {
        protocol_version: protocol::PROTOCOL_VERSION,
        request_id: Some(request_id),
        result: protocol::ResultFrame::SetupEvidence {
            backend_id: protocol::BACKEND_ID.to_string(),
            backend_version: env!("CARGO_PKG_VERSION").to_string(),
            operation_id,
            evidence: protocol::SandboxSetupEvidence {
                package_sid,
                profile_valid,
                network_filters_valid,
            },
        },
    }
}

#[cfg(windows)]
fn validate_setup_user_data_path(value: &str) -> Result<(), &'static str> {
    use std::path::Component;

    if value.len() < 4
        || value.len() > 1024
        || !std::path::Path::new(value).is_absolute()
        || value.starts_with("\\\\")
        || value.starts_with("\\\\?\\")
        || value.starts_with("\\\\.\\")
        || value.contains('\0')
        || !value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
        || !value
            .as_bytes()
            .get(1..3)
            .is_some_and(|drive| drive == b":\\")
        || std::path::Path::new(value)
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("setup_user_data_path_invalid");
    }
    Ok(())
}

fn setup_operation_denied(
    request_id: String,
    operation_id: String,
    code: &'static str,
) -> protocol::ResponseEnvelope {
    let code = if request_id != operation_id {
        "setup_operation_identity_mismatch"
    } else {
        code
    };
    protocol::ResponseEnvelope {
        protocol_version: protocol::PROTOCOL_VERSION,
        request_id: Some(request_id),
        result: protocol::ResultFrame::Denied {
            code: code.to_string(),
            stage: "setup".to_string(),
        },
    }
}

fn handle_acl_operation(
    request_id: String,
    grants: Vec<policy::AclGrant>,
    reconcile: bool,
) -> protocol::ResponseEnvelope {
    #[cfg(windows)]
    let evidence = run_windows_acl_operation(&grants, reconcile);
    #[cfg(not(windows))]
    let evidence: Result<Vec<policy::VerifiedAclGrantEvidence>, &'static str> =
        Err("windows_required");

    let result = match evidence {
        Ok(evidence) => protocol::ResultFrame::AclEvidence {
            backend_id: protocol::BACKEND_ID.to_string(),
            backend_version: env!("CARGO_PKG_VERSION").to_string(),
            evidence,
        },
        Err(code) => protocol::ResultFrame::Denied {
            code: code.to_string(),
            stage: "acl".to_string(),
        },
    };
    protocol::ResponseEnvelope {
        protocol_version: protocol::PROTOCOL_VERSION,
        request_id: Some(request_id),
        result,
    }
}

#[cfg(windows)]
fn run_windows_acl_operation(
    grants: &[policy::AclGrant],
    reconcile: bool,
) -> Result<Vec<policy::VerifiedAclGrantEvidence>, &'static str> {
    let _setup_lock = setup_mutex::acquire_windows_runner_setup_lock(
        setup_mutex::DEFAULT_SETUP_MUTEX_TIMEOUT_MS,
    )?;
    setup_mutex::validate_abandoned_setup_action(_setup_lock.was_abandoned(), reconcile)?;
    acl::require_unrestricted_caller()?;
    let paths = path_identity::verify_filesystem_root_paths(grants)?;
    // SAFETY: the caller token is unrestricted; policy identities and
    // no-reparse handles are verified above. ACL changes are only requested
    // by the journaled main-process coordinator while holding the setup lock.
    unsafe {
        if reconcile {
            paths.reconcile_filesystem_root_acls(grants)
        } else {
            paths.verify_filesystem_root_acls(grants)
        }
    }
}

fn probe(request_id: String) -> protocol::ResponseEnvelope {
    #[cfg(windows)]
    let platform = windows_probe::read_platform();
    #[cfg(not(windows))]
    let platform: Result<protocol::PlatformInfo, &'static str> = Err("windows_required");

    let result = match platform {
        Ok(platform) => runtime_probe(platform),
        Err(code) => protocol::ResultFrame::ProbeUnavailable {
            code: code.to_string(),
        },
    };
    protocol::ResponseEnvelope {
        protocol_version: protocol::PROTOCOL_VERSION,
        request_id: Some(request_id),
        result,
    }
}

fn runtime_probe(platform: protocol::PlatformInfo) -> protocol::ResultFrame {
    #[cfg(windows)]
    {
        let Ok(package_sid) = appcontainer::derive_package_sid() else {
            return not_ready_probe(platform);
        };
        let profile_valid = appcontainer::probe_profile(&package_sid).is_ok();
        let network_status = match wfp::probe_network_deny(&package_sid) {
            Ok(true) => protocol::NetworkFilterStatus::Ready,
            Ok(false) => protocol::NetworkFilterStatus::Incomplete,
            Err(_) => protocol::NetworkFilterStatus::Failed,
        };
        let setup_status =
            if profile_valid && network_status == protocol::NetworkFilterStatus::Ready {
                protocol::SandboxSetupStatus::Ready
            } else if profile_valid || network_status == protocol::NetworkFilterStatus::Ready {
                protocol::SandboxSetupStatus::Incomplete
            } else {
                protocol::SandboxSetupStatus::NotConfigured
            };
        let mut blockers = vec![protocol::ReadinessBlocker::RunnerImplementationIncomplete];
        if !profile_valid {
            blockers.push(protocol::ReadinessBlocker::SandboxSetupUnavailable);
        }
        if network_status != protocol::NetworkFilterStatus::Ready {
            blockers.push(protocol::ReadinessBlocker::NetworkFiltersUnverified);
        }
        return protocol::ResultFrame::Probe {
            backend_id: protocol::BACKEND_ID.to_string(),
            backend_version: env!("CARGO_PKG_VERSION").to_string(),
            policy_version: protocol::POLICY_VERSION,
            ready: false,
            blockers,
            setup_status,
            network_filter_status: network_status,
            capabilities: protocol::Capabilities::disabled(),
            platform,
        };
    }

    #[cfg(not(windows))]
    not_ready_probe(platform)
}

fn not_ready_probe(platform: protocol::PlatformInfo) -> protocol::ResultFrame {
    protocol::ResultFrame::Probe {
        backend_id: protocol::BACKEND_ID.to_string(),
        backend_version: env!("CARGO_PKG_VERSION").to_string(),
        policy_version: protocol::POLICY_VERSION,
        ready: false,
        blockers: vec![
            protocol::ReadinessBlocker::RunnerImplementationIncomplete,
            protocol::ReadinessBlocker::SandboxSetupUnavailable,
            protocol::ReadinessBlocker::NetworkFiltersUnverified,
        ],
        setup_status: protocol::SandboxSetupStatus::NotImplemented,
        network_filter_status: protocol::NetworkFilterStatus::NotVerified,
        capabilities: protocol::Capabilities::disabled(),
        platform,
    }
}

#[cfg(test)]
mod tests;
