use crate::policy::{AclGrant, VerifiedAclGrantEvidence, WindowsCommandPolicy};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 8;
pub const POLICY_VERSION: u16 = 3;
pub const BACKEND_ID: &str = "noema-codex-windows";
pub const MINIMUM_WINDOWS_BUILD: u32 = 19_045;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestEnvelope {
    pub protocol_version: u16,
    pub request_id: String,
    pub operation: Operation,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operation {
    Probe {},
    Execute {
        execution_id: String,
        task_id: String,
        tool_call_id: String,
        user_data_path: String,
        package_sid: String,
        policy: WindowsCommandPolicy,
        grants: Vec<AclGrant>,
        command: String,
        timeout_ms: u32,
    },
    ReconcileFilesystemRootAcls {
        grants: Vec<AclGrant>,
    },
    VerifyFilesystemRootAcls {
        grants: Vec<AclGrant>,
    },
    ReconcileSandboxSetup {
        operation_id: String,
        user_data_path: String,
    },
    ProbeSandboxSetup {
        operation_id: String,
        user_data_path: String,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResponseEnvelope {
    pub protocol_version: u16,
    pub request_id: Option<String>,
    pub result: ResultFrame,
}

impl ResponseEnvelope {
    pub fn error(protocol_version: u16, code: &str) -> Self {
        Self {
            protocol_version,
            request_id: None,
            result: ResultFrame::Denied {
                code: code.to_string(),
                stage: "protocol".to_string(),
            },
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ResultFrame {
    Probe {
        backend_id: String,
        backend_version: String,
        policy_version: u16,
        ready: bool,
        blockers: Vec<ReadinessBlocker>,
        setup_status: SandboxSetupStatus,
        capabilities: Capabilities,
        platform: PlatformInfo,
    },
    ProbeUnavailable {
        code: String,
    },
    Denied {
        code: String,
        stage: String,
    },
    AclEvidence {
        backend_id: String,
        backend_version: String,
        evidence: Vec<VerifiedAclGrantEvidence>,
    },
    SetupReconciled {
        backend_id: String,
        backend_version: String,
        operation_id: String,
        package_sid: String,
    },
    SetupEvidence {
        backend_id: String,
        backend_version: String,
        operation_id: String,
        evidence: SandboxSetupEvidence,
    },
    CommandComplete {
        backend_id: String,
        backend_version: String,
        child_started: bool,
        exit_code: i32,
        duration_ms: u64,
        timed_out: bool,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
        stdout_truncated: bool,
        stderr_truncated: bool,
    },
    CommandOutcomeUnknown {
        backend_id: String,
        backend_version: String,
        child_started: bool,
        code: String,
        cleanup_confirmed: bool,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
        stdout_truncated: bool,
        stderr_truncated: bool,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SandboxSetupEvidence {
    pub package_sid: String,
    pub profile_valid: bool,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum ReadinessBlocker {
    RunnerImplementationIncomplete,
    SandboxSetupUnavailable,
    OsBaselineUnsupported,
    HelperResourceInvalid,
    RequiredCapabilityMissing,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum SandboxSetupStatus {
    NotImplemented,
    NotConfigured,
    Incomplete,
    Ready,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    pub filesystem_default_deny: bool,
    pub filesystem_read_allowlist: bool,
    pub filesystem_write_allowlist: bool,
    pub path_identity_validation: bool,
    pub working_directory_confinement: bool,
    pub environment_confinement: bool,
    pub network_default_deny: bool,
    pub identity_bound_network_broker: bool,
    pub job_process_tree: bool,
    pub bounded_stdio: bool,
}

impl Capabilities {
    pub fn implemented() -> Self {
        Self {
            filesystem_default_deny: true,
            filesystem_read_allowlist: true,
            filesystem_write_allowlist: true,
            path_identity_validation: true,
            working_directory_confinement: true,
            environment_confinement: true,
            network_default_deny: true,
            identity_bound_network_broker: false,
            job_process_tree: true,
            bounded_stdio: true,
        }
    }

    pub fn disabled() -> Self {
        Self {
            filesystem_default_deny: false,
            filesystem_read_allowlist: false,
            filesystem_write_allowlist: false,
            path_identity_validation: false,
            working_directory_confinement: false,
            environment_confinement: false,
            network_default_deny: false,
            identity_bound_network_broker: false,
            job_process_tree: false,
            bounded_stdio: false,
        }
    }

    fn all_required_enabled(&self) -> bool {
        self.filesystem_default_deny
            && self.filesystem_read_allowlist
            && self.filesystem_write_allowlist
            && self.path_identity_validation
            && self.working_directory_confinement
            && self.environment_confinement
            && self.network_default_deny
            && self.job_process_tree
            && self.bounded_stdio
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformInfo {
    pub major: u32,
    pub minor: u32,
    pub build: u32,
    /// Diagnostic Windows UBR; zero means the registry value was unavailable.
    pub ubr: u32,
    pub architecture: String,
}

#[cfg(test)]
pub fn parse_readiness_response(json: &str, expected_request_id: &str) -> Result<(), &'static str> {
    let response: ResponseEnvelope =
        serde_json::from_str(json).map_err(|_| "readiness_response_invalid")?;
    validate_readiness_response(&response, expected_request_id)
}

pub fn validate_readiness_response(
    response: &ResponseEnvelope,
    expected_request_id: &str,
) -> Result<(), &'static str> {
    if response.protocol_version != PROTOCOL_VERSION {
        return Err("protocol_version_unsupported");
    }
    if response.request_id.as_deref() != Some(expected_request_id) {
        return Err("readiness_request_identity_mismatch");
    }

    let ResultFrame::Probe {
        backend_id,
        backend_version,
        policy_version,
        ready,
        blockers,
        setup_status,
        capabilities,
        platform,
    } = &response.result
    else {
        return Err("readiness_probe_unavailable");
    };

    if backend_id != BACKEND_ID || backend_version != env!("CARGO_PKG_VERSION") {
        return Err("helper_version_unsupported");
    }
    if *policy_version != POLICY_VERSION {
        return Err("policy_version_unsupported");
    }
    if platform.major != 10
        || platform.minor != 0
        || platform.build < MINIMUM_WINDOWS_BUILD
        || platform.architecture != "x86_64"
    {
        return Err("os_baseline_unsupported");
    }
    if *setup_status != SandboxSetupStatus::Ready {
        return Err("sandbox_setup_unavailable");
    }
    if let Some(blocker) = blockers.first() {
        return Err(match blocker {
            ReadinessBlocker::RunnerImplementationIncomplete => "runner_not_ready",
            ReadinessBlocker::SandboxSetupUnavailable => "sandbox_setup_unavailable",
            ReadinessBlocker::OsBaselineUnsupported => "os_baseline_unsupported",
            ReadinessBlocker::HelperResourceInvalid => "helper_version_unsupported",
            ReadinessBlocker::RequiredCapabilityMissing => "required_capability_missing",
        });
    }
    if !ready {
        return Err("runner_not_ready");
    }
    if !capabilities.all_required_enabled() {
        return Err("required_capability_missing");
    }
    Ok(())
}

pub fn valid_request_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub fn valid_trace_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::{valid_request_id, valid_trace_identity};

    #[test]
    fn request_ids_are_bounded_and_ascii() {
        assert!(valid_request_id("execution_request_01"));
        assert!(!valid_request_id("short"));
        assert!(!valid_request_id(&"x".repeat(129)));
        assert!(!valid_request_id("request-with-非ascii"));
    }

    #[test]
    fn trace_identities_are_bounded_and_ascii() {
        assert!(valid_trace_identity("task_01:tool.call"));
        assert!(!valid_trace_identity(""));
        assert!(!valid_trace_identity(&"x".repeat(161)));
        assert!(!valid_trace_identity("task-非ascii"));
        assert!(!valid_trace_identity("task id"));
    }
}
