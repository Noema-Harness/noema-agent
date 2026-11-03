//! AppContainer identity helpers for the Windows command child.
//!
//! This module derives SIDs and provides explicit profile setup/probe functions.
//! It does not change filesystem ACLs, start a child, or mutate firewall state.

use std::ffi::{OsString, c_void};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::PathBuf;
use std::ptr;
use windows_sys::Win32::Foundation::{HLOCAL, LocalFree};
use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSidToSidW};
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName, GetAppContainerFolderPath,
};
use windows_sys::Win32::Security::{
    DeriveCapabilitySidsFromName, FreeSid, IsValidSid, PSID, SECURITY_CAPABILITIES,
    SID_AND_ATTRIBUTES,
};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::System::SystemServices::SE_GROUP_ENABLED;

#[allow(dead_code)] // Used by the AppContainer readiness/setup integration.
pub const NOEMA_APPCONTAINER_PROFILE: &str = "Noema.WorkspaceRunner.V1";
const MAX_CAPABILITY_NAME_UNITS: usize = 128;

/// Resolve the fixed Noema AppContainer package SID from its profile moniker.
/// The profile does not need to exist for the SID to be derived.
#[allow(dead_code)] // Used by the AppContainer readiness/setup integration.
pub fn derive_package_sid() -> Result<String, &'static str> {
    let name = wide(NOEMA_APPCONTAINER_PROFILE);
    let mut sid: PSID = ptr::null_mut();
    // SAFETY: `name` is NUL terminated and `sid` is a valid output location.
    let result = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
    if result < 0 || sid.is_null() {
        free_sid(sid);
        return Err("appcontainer_package_sid_unavailable");
    }
    let result = sid_to_string(sid);
    free_sid(sid);
    result
}

/// Create the per-current-user Noema profile without network capabilities.
/// Call only after the main process has durably recorded repair-required state.
pub fn ensure_profile() -> Result<String, &'static str> {
    let name = wide(NOEMA_APPCONTAINER_PROFILE);
    let display_name = wide("Noema Workspace Runner");
    let description = wide("Restricted command execution for Noema workspaces");
    let mut sid: PSID = ptr::null_mut();
    // SAFETY: strings are NUL terminated; an empty capability list gives the
    // profile no persistent network capability.
    let result = unsafe {
        CreateAppContainerProfile(
            name.as_ptr(),
            display_name.as_ptr(),
            description.as_ptr(),
            ptr::null(),
            0,
            &mut sid,
        )
    };
    if result >= 0 && !sid.is_null() {
        let package_sid = sid_to_string(sid);
        free_sid(sid);
        let package_sid = package_sid?;
        let derived = derive_package_sid()?;
        if package_sid != derived {
            return Err("appcontainer_profile_identity_mismatch");
        }
        return Ok(derived);
    }
    free_sid(sid);
    if result != HRESULT_ALREADY_EXISTS {
        return Err("appcontainer_profile_create_failed");
    }
    let derived = derive_package_sid()?;
    probe_profile(&derived)?;
    Ok(derived)
}

/// Independently verify that the current Windows user's profile is resolvable.
pub fn probe_profile(expected_package_sid: &str) -> Result<PathBuf, &'static str> {
    if !is_appcontainer_package_sid(expected_package_sid) {
        return Err("appcontainer_package_sid_invalid");
    }
    let derived = derive_package_sid()?;
    if derived != expected_package_sid {
        return Err("appcontainer_profile_identity_mismatch");
    }
    let sid_wide = wide(expected_package_sid);
    let mut folder: *mut u16 = ptr::null_mut();
    // SAFETY: the SID string is NUL terminated and `folder` is a valid output.
    let result = unsafe { GetAppContainerFolderPath(sid_wide.as_ptr(), &mut folder) };
    if result < 0 || folder.is_null() {
        free_task_memory(folder.cast());
        return Err("appcontainer_profile_probe_failed");
    }
    let path = unsafe {
        let mut length = 0usize;
        while *folder.add(length) != 0 {
            length += 1;
        }
        PathBuf::from(OsString::from_wide(std::slice::from_raw_parts(
            folder, length,
        )))
    };
    free_task_memory(folder.cast());
    let metadata =
        std::fs::symlink_metadata(&path).map_err(|_| "appcontainer_profile_probe_failed")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("appcontainer_profile_probe_failed");
    }
    Ok(path)
}

pub fn is_appcontainer_package_sid(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix("S-1-15-2-") else {
        return false;
    };
    let parts = suffix.split('-').collect::<Vec<_>>();
    parts.len() == 7
        && parts.iter().all(|part| {
            !part.is_empty()
                && (*part == "0" || !part.starts_with('0'))
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && part
                    .parse::<u32>()
                    .is_ok_and(|number| number.to_string() == *part)
        })
}

/// Owned SECURITY_CAPABILITIES payload for one policy-compiled child. It
/// contains only the fixed package SID and current-request filesystem SIDs.
pub struct ProcessSecurityCapabilities {
    _package_sid: LocalSid,
    _capability_sids: Vec<LocalSid>,
    _attributes: Vec<SID_AND_ATTRIBUTES>,
    value: SECURITY_CAPABILITIES,
}

impl ProcessSecurityCapabilities {
    pub fn new(
        expected_package_sid: &str,
        capability_names: &[String],
    ) -> Result<Self, &'static str> {
        validate_process_capability_names(capability_names)?;
        let package_sid_text = derive_package_sid()?;
        if package_sid_text != expected_package_sid {
            return Err("appcontainer_profile_identity_mismatch");
        }
        probe_profile(expected_package_sid)?;
        let package_sid = LocalSid::from_string(&package_sid_text)?;
        let mut seen_names = std::collections::HashSet::with_capacity(capability_names.len());
        let mut capability_sids = Vec::with_capacity(capability_names.len());
        for name in capability_names {
            if !is_capability_name(name) || !seen_names.insert(name.as_str()) {
                return Err("appcontainer_capability_set_invalid");
            }
            let sid = derive_capability_name(name)?;
            capability_sids.push(LocalSid::from_string(&sid)?);
        }
        let capability_sid_ptrs = capability_sids.iter().map(|sid| sid.0).collect::<Vec<_>>();
        let (attributes, value) = make_security_capabilities(package_sid.0, &capability_sid_ptrs);
        Ok(Self {
            _package_sid: package_sid,
            _capability_sids: capability_sids,
            _attributes: attributes,
            value,
        })
    }

    pub fn as_ref(&self) -> &SECURITY_CAPABILITIES {
        &self.value
    }
}

fn validate_process_capability_names(names: &[String]) -> Result<(), &'static str> {
    if names.len() > 37 {
        return Err("appcontainer_capability_set_invalid");
    }
    let mut seen = std::collections::HashSet::with_capacity(names.len());
    if names.iter().any(|name| {
        !(name.starts_with("Noema.Read.") || name.starts_with("Noema.Write."))
            || !is_capability_name(name)
            || !seen.insert(name.as_str())
    }) {
        return Err("appcontainer_capability_set_invalid");
    }
    Ok(())
}

fn make_security_capabilities(
    package_sid: PSID,
    capability_sids: &[PSID],
) -> (Vec<SID_AND_ATTRIBUTES>, SECURITY_CAPABILITIES) {
    let mut attributes = capability_sids
        .iter()
        .map(|sid| SID_AND_ATTRIBUTES {
            Sid: *sid,
            Attributes: SE_GROUP_ENABLED as u32,
        })
        .collect::<Vec<_>>();
    let value = SECURITY_CAPABILITIES {
        AppContainerSid: package_sid,
        Capabilities: if attributes.is_empty() {
            ptr::null_mut()
        } else {
            attributes.as_mut_ptr()
        },
        CapabilityCount: attributes.len() as u32,
        Reserved: 0,
    };
    (attributes, value)
}

struct LocalSid(PSID);

impl LocalSid {
    fn from_string(value: &str) -> Result<Self, &'static str> {
        let wide = wide(value);
        let mut sid: PSID = ptr::null_mut();
        // SAFETY: the SID string is NUL terminated and `sid` is writable.
        if unsafe { ConvertStringSidToSidW(wide.as_ptr(), &mut sid) } == 0
            || sid.is_null()
            || unsafe { IsValidSid(sid) } == 0
        {
            free_local(sid);
            return Err("appcontainer_sid_parse_failed");
        }
        Ok(Self(sid))
    }
}

impl Drop for LocalSid {
    fn drop(&mut self) {
        free_local(self.0);
    }
}

/// Derive the AppAuthority capability SID for a stable, trusted Noema name.
/// Callers must bind that name to a verified file identity and access mode.
pub fn derive_capability_name(name: &str) -> Result<String, &'static str> {
    if !is_capability_name(name) {
        return Err("appcontainer_capability_name_invalid");
    }
    let name = wide(name);
    let mut group_sids: *mut PSID = ptr::null_mut();
    let mut group_count = 0u32;
    let mut capability_names: *mut PSID = ptr::null_mut();
    let mut capability_count = 0u32;
    // SAFETY: all output pointers refer to initialized locals; Windows owns the
    // returned arrays and individual SIDs until they are released with LocalFree.
    let ok = unsafe {
        DeriveCapabilitySidsFromName(
            name.as_ptr(),
            &mut group_sids,
            &mut group_count,
            &mut capability_names,
            &mut capability_count,
        )
    };
    if ok == 0 || capability_count != 1 || capability_names.is_null() {
        free_sid_array(group_sids, group_count);
        free_sid_array(capability_names, capability_count);
        return Err("appcontainer_capability_name_unavailable");
    }
    let sid = unsafe { *capability_names };
    if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
        free_sid_array(group_sids, group_count);
        free_sid_array(capability_names, capability_count);
        return Err("appcontainer_capability_name_invalid");
    }
    let result = sid_to_string(sid);
    free_sid_array(group_sids, group_count);
    free_sid_array(capability_names, capability_count);
    result
}

pub fn is_capability_name(value: &str) -> bool {
    value.starts_with("Noema.")
        && value.len() <= MAX_CAPABILITY_NAME_UNITS
        && value.is_ascii()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

fn sid_to_string(sid: PSID) -> Result<String, &'static str> {
    let mut text = ptr::null_mut();
    // SAFETY: `sid` is validated and Windows returns a LocalAlloc-owned string.
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 || text.is_null() {
        free_local(text.cast());
        return Err("appcontainer_sid_format_failed");
    }
    let value = unsafe {
        let mut length = 0usize;
        while *text.add(length) != 0 {
            length += 1;
        }
        String::from_utf16(std::slice::from_raw_parts(text, length))
            .map_err(|_| "appcontainer_sid_format_failed")
    };
    free_local(text.cast());
    value
}

fn free_sid_array(array: *mut PSID, count: u32) {
    if array.is_null() {
        return;
    }
    for index in 0..count as usize {
        // SAFETY: the API returns an array with `count` pointers; each entry is
        // individually LocalFree-owned according to its Win32 contract.
        let sid = unsafe { *array.add(index) };
        free_local(sid);
    }
    free_local(array.cast());
}

fn free_local(value: *mut c_void) {
    if !value.is_null() {
        // SAFETY: value came from a Win32 API that documents LocalFree ownership.
        unsafe { LocalFree(value as HLOCAL) };
    }
}

fn free_sid(value: PSID) {
    if !value.is_null() {
        // SAFETY: AppContainer SID APIs document FreeSid ownership.
        unsafe { FreeSid(value) };
    }
}

fn free_task_memory(value: *mut c_void) {
    if !value.is_null() {
        // SAFETY: GetAppContainerFolderPath allocates with CoTaskMemAlloc.
        unsafe { CoTaskMemFree(value) };
    }
}

fn wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

const HRESULT_ALREADY_EXISTS: i32 = 0x8007_00b7u32 as i32;

#[cfg(test)]
mod tests {
    use super::{
        is_appcontainer_package_sid, make_security_capabilities, validate_process_capability_names,
    };

    #[test]
    fn package_sid_requires_the_canonical_appcontainer_shape() {
        assert!(is_appcontainer_package_sid("S-1-15-2-1-2-3-4-5-6-7"));
        for invalid in [
            "S-1-5-21-1-2-3-4",
            "S-1-15-2-1-2-3-4-5-6",
            "S-1-15-2-1-2-3-4-5-6-7-8",
            "S-1-15-2-01-2-3-4-5-6-7",
            "S-1-15-2-4294967296-2-3-4-5-6-7",
        ] {
            assert!(!is_appcontainer_package_sid(invalid), "{invalid}");
        }
    }

    #[test]
    fn child_capabilities_accept_only_unique_noema_filesystem_names() {
        assert!(
            validate_process_capability_names(&[
                "Noema.Read.abc".to_string(),
                "Noema.Write.def".to_string(),
            ])
            .is_ok()
        );
        for names in [
            vec!["Noema.InternetClient".to_string()],
            vec!["Noema.Read.bad/segment".to_string()],
            vec!["Noema.Read.same".to_string(), "Noema.Read.same".to_string()],
        ] {
            assert_eq!(
                validate_process_capability_names(&names),
                Err("appcontainer_capability_set_invalid")
            );
        }
    }

    #[test]
    fn security_capabilities_contains_only_the_fixed_package_and_passed_root_sids() {
        let package = 1usize as _;
        let (attributes, value) = make_security_capabilities(package, &[2usize as _, 3usize as _]);
        assert_eq!(value.AppContainerSid, package);
        assert_eq!(value.CapabilityCount, 2);
        assert_eq!(value.Capabilities, attributes.as_ptr() as _);
        assert_eq!(attributes[0].Sid, 2usize as _);
        assert_eq!(attributes[1].Sid, 3usize as _);
        assert!(attributes.iter().all(|entry| entry.Attributes == 0x4));
    }
}
