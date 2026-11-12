use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const ALLOWED_ENVIRONMENT_NAMES: [&str; 6] = [
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "PATH",
    "LOCALAPPDATA",
];

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowsCommandPolicy {
    pub version: u16,
    pub backend: BackendIdentity,
    pub request_id: String,
    pub workspace_root: PathRoot,
    pub filesystem: FilesystemPolicy,
    pub working_directory: PathRoot,
    pub environment: EnvironmentPolicy,
    pub network: NetworkPolicy,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackendIdentity {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilesystemPolicy {
    pub mode: FilesystemMode,
    pub read_roots: Vec<PathRoot>,
    pub write_roots: Vec<PathRoot>,
    pub default_deny: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FilesystemMode {
    ReadOnly,
    ReadWrite,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PathRoot {
    pub path: String,
    pub file_identity: FileIdentity,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AclGrant {
    pub path: String,
    pub file_identity: FileIdentity,
    pub capability_name: String,
    pub access: FilesystemAccessMode,
    pub is_directory: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FilesystemAccessMode {
    Read,
    Write,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedAclGrantEvidence {
    pub volume_serial_number: String,
    pub file_index: String,
    pub capability_name: String,
    pub access: FilesystemAccessMode,
    pub object_count: u32,
    pub acl_verified_count: u32,
    pub tree_digest: String,
    pub inheritance_verified: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileIdentity {
    pub volume_serial_number: String,
    pub file_index: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentPolicy {
    pub inherit: bool,
    pub allow_names: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkPolicy {
    pub mode: NetworkMode,
    pub identity: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NetworkMode {
    Deny,
    PromptPerDestination,
}

impl WindowsCommandPolicy {
    /// Validate the serialized D2 policy shape before any backend preparation.
    /// The serialized file identity must still match the native object handle before ACL use.
    pub fn validate(&self, request_id: &str) -> Result<(), &'static str> {
        if self.version != crate::protocol::POLICY_VERSION {
            return Err("policy_version_unsupported");
        }
        if self.backend.id != crate::protocol::BACKEND_ID
            || self.backend.version != env!("CARGO_PKG_VERSION")
        {
            return Err("backend_identity_unsupported");
        }
        if self.request_id != request_id {
            return Err("policy_request_identity_mismatch");
        }
        validate_path_root(&self.workspace_root)?;
        if !self.filesystem.default_deny {
            return Err("filesystem_default_deny_required");
        }
        let write_roots_valid = match self.filesystem.mode {
            FilesystemMode::ReadOnly => self.filesystem.write_roots.is_empty(),
            FilesystemMode::ReadWrite => {
                !self.filesystem.write_roots.is_empty() && self.filesystem.write_roots.len() <= 5
            }
        };
        if self.filesystem.read_roots.is_empty()
            || self.filesystem.read_roots.len() > 37
            || !write_roots_valid
        {
            return Err("filesystem_policy_invalid");
        }
        let read_roots = validate_roots(&self.filesystem.read_roots)?;
        let write_roots = validate_roots(&self.filesystem.write_roots)?;
        let workspace_key = self.workspace_root.path.to_ascii_lowercase();
        if !read_roots.contains(&workspace_key)
            || (self.filesystem.mode == FilesystemMode::ReadWrite
                && !write_roots.contains(&workspace_key))
            || (self.filesystem.mode == FilesystemMode::ReadOnly
                && write_roots.contains(&workspace_key))
            || write_roots.iter().any(|root| !read_roots.contains(root))
        {
            return Err("filesystem_policy_invalid");
        }
        validate_path_root(&self.working_directory)?;
        if !is_within(
            &workspace_key,
            &self.working_directory.path.to_ascii_lowercase(),
        ) {
            return Err("working_directory_outside_workspace");
        }
        let environment_names: HashSet<&str> = self
            .environment
            .allow_names
            .iter()
            .map(String::as_str)
            .collect();
        if self.environment.inherit
            || environment_names.len() != ALLOWED_ENVIRONMENT_NAMES.len()
            || ALLOWED_ENVIRONMENT_NAMES
                .iter()
                .any(|name| !environment_names.contains(name))
        {
            return Err("environment_policy_invalid");
        }
        if self.network.identity != request_id {
            return Err("network_identity_mismatch");
        }
        if self.network.mode != NetworkMode::Deny {
            return Err("network_policy_unsupported");
        }
        Ok(())
    }

    /// Bind the journaled grants to this exact policy before their SIDs may be
    /// used to construct a command token. A write root upgrades its matching
    /// read root to one write-mode grant; no duplicate or stale path grant is
    /// accepted.
    #[allow(dead_code)] // Consumed by trusted execute admission after grants enter the wire contract.
    pub fn verified_capability_names(
        &self,
        grants: &[AclGrant],
    ) -> Result<Vec<String>, &'static str> {
        if grants.len() != self.filesystem.read_roots.len() || grants.len() > 37 {
            return Err("acl_grants_mismatch");
        }
        let read_roots = self
            .filesystem
            .read_roots
            .iter()
            .map(|root| (root.path.to_ascii_lowercase(), root))
            .collect::<HashMap<_, _>>();
        let write_roots = self
            .filesystem
            .write_roots
            .iter()
            .map(|root| root.path.to_ascii_lowercase())
            .collect::<HashSet<_>>();
        let mut seen_paths = HashSet::new();
        let mut seen_sids = HashSet::new();
        let mut sids = Vec::with_capacity(grants.len());
        for grant in grants {
            let key = grant.path.to_ascii_lowercase();
            let Some(root) = read_roots.get(&key) else {
                return Err("acl_grants_mismatch");
            };
            let expected_access = if write_roots.contains(&key) {
                FilesystemAccessMode::Write
            } else {
                FilesystemAccessMode::Read
            };
            let expected_prefix = match expected_access {
                FilesystemAccessMode::Read => "Noema.Read.",
                FilesystemAccessMode::Write => "Noema.Write.",
            };
            if !seen_paths.insert(key)
                || !seen_sids.insert(grant.capability_name.as_str())
                || !crate::appcontainer::is_capability_name(&grant.capability_name)
                || !grant.capability_name.starts_with(expected_prefix)
                || grant.file_identity != root.file_identity
                || grant.access != expected_access
            {
                return Err("acl_grants_mismatch");
            }
            sids.push(grant.capability_name.clone());
        }
        Ok(sids)
    }
}

fn validate_roots(roots: &[PathRoot]) -> Result<HashSet<String>, &'static str> {
    let mut unique = HashSet::with_capacity(roots.len());
    for root in roots {
        validate_path_root(root)?;
        let key = root.path.to_ascii_lowercase();
        if !unique.insert(key) {
            return Err("filesystem_policy_invalid");
        }
    }
    Ok(unique)
}

fn validate_path_root(root: &PathRoot) -> Result<(), &'static str> {
    let bytes = root.path.as_bytes();
    let is_drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    let lower = root.path.to_ascii_lowercase();
    if !is_drive_absolute
        || root.path.len() > 1_000
        || bytes.len() == 3
        || root.path.starts_with("\\\\")
        || lower.starts_with("\\\\?\\")
        || lower.starts_with("\\\\.\\")
        || root.path.ends_with(':')
        || root.path.as_bytes().get(2).is_some_and(|_| {
            root.path
                .split(|ch| ch == '\\' || ch == '/')
                .skip(1)
                .any(|component| !valid_win32_component(component))
        })
    {
        return Err("path_identity_unverified");
    }
    if !valid_identity_integer(&root.file_identity.volume_serial_number)
        || !valid_identity_integer(&root.file_identity.file_index)
    {
        return Err("path_identity_unverified");
    }
    Ok(())
}

fn valid_identity_integer(value: &str) -> bool {
    if value.is_empty() || value.len() > 20 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    value
        .parse::<u64>()
        .is_ok_and(|parsed| parsed > 0 && parsed.to_string() == value)
}

fn valid_win32_component(component: &str) -> bool {
    if component.is_empty() {
        return true;
    }
    if component == "."
        || component == ".."
        || component.ends_with('.')
        || component.ends_with(' ')
        || component.chars().any(|character| {
            character <= '\u{1f}' || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
    {
        return false;
    }
    let device_stem = component
        .split('.')
        .next()
        .unwrap_or(component)
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    !matches!(
        device_stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "COM¹"
            | "COM²"
            | "COM³"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
            | "LPT¹"
            | "LPT²"
            | "LPT³"
    )
}

fn is_within(root: &str, candidate: &str) -> bool {
    let root = root.trim_end_matches(|ch| ch == '\\' || ch == '/');
    candidate == root
        || candidate
            .strip_prefix(root)
            .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'))
}
