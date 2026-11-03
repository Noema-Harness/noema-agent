//! Noema-owned, package-SID-scoped Windows Filtering Platform policy.
//!
//! This module only mutates the machine WFP store through an explicit setup
//! operation. Readiness uses `probe_network_deny`; command admission must
//! require `NetworkFilterStatus::Ready` from a fresh probe.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr;
use windows_sys::Win32::Foundation::{ERROR_CANCELLED, HANDLE, HLOCAL, LocalFree, WAIT_OBJECT_0};
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::*;
use windows_sys::Win32::Security::Authorization::ConvertStringSidToSidW;
use windows_sys::Win32::Security::{
    EqualSid, GetTokenInformation, IsValidSid, PSID, SID, TOKEN_ELEVATION, TOKEN_QUERY,
    TokenElevation,
};
use windows_sys::Win32::System::Rpc::RPC_C_AUTHN_WINNT;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject,
};
use windows_sys::Win32::UI::Shell::{
    SEE_MASK_NO_CONSOLE, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    ShellExecuteExW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

pub const ELEVATED_WORKER_ARGUMENT: &str = "--noema-install-network-deny-v1";

/// Called only by the fixed, argument-selected one-shot elevated worker.
/// It has no request IPC and can install only the fixed Noema package policy.
pub fn run_elevated_worker() -> Result<(), &'static str> {
    if !current_process_is_elevated() {
        return Err("wfp_elevation_missing");
    }
    let package_sid = crate::appcontainer::derive_package_sid()?;
    let setup_lock = crate::setup_mutex::acquire_windows_runner_setup_lock(
        crate::setup_mutex::DEFAULT_SETUP_MUTEX_TIMEOUT_MS,
    )?;
    crate::setup_mutex::validate_abandoned_setup_action(setup_lock.was_abandoned(), true)?;
    reconcile_network_deny(&package_sid)
}

/// Ask Windows for one elevation confirmation, then independently read back
/// the exact fixed policy from the ordinary helper process.
pub fn install_with_uac(package_sid: &str) -> Result<(), &'static str> {
    if probe_network_deny(package_sid).unwrap_or(false) {
        return Ok(());
    }
    let executable = std::env::current_exe().map_err(|_| "wfp_installer_path_unavailable")?;
    let executable = wide(&executable.to_string_lossy());
    let verb = wide("runas");
    let arguments = wide(ELEVATED_WORKER_ARGUMENT);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE | SEE_MASK_NOASYNC,
        lpVerb: verb.as_ptr(),
        lpFile: executable.as_ptr(),
        lpParameters: arguments.as_ptr(),
        nShow: SW_HIDE,
        ..Default::default()
    };
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(
            if unsafe { windows_sys::Win32::Foundation::GetLastError() } == ERROR_CANCELLED {
                "wfp_elevation_cancelled"
            } else {
                "wfp_elevation_launch_failed"
            },
        );
    }
    if info.hProcess.is_null() {
        return Err("wfp_elevated_process_handle_missing");
    }
    let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
    if unsafe { WaitForSingleObject(process.as_raw_handle() as HANDLE, 120_000) } != WAIT_OBJECT_0 {
        return Err("wfp_elevated_setup_timeout");
    }
    let mut exit_code = u32::MAX;
    if unsafe { GetExitCodeProcess(process.as_raw_handle() as HANDLE, &mut exit_code) } == 0 {
        return Err("wfp_elevated_exit_unavailable");
    }
    if exit_code != 0 {
        return Err("wfp_elevated_setup_failed");
    }
    if !probe_network_deny(package_sid)? {
        return Err("wfp_post_install_verification_failed");
    }
    Ok(())
}

fn current_process_is_elevated() -> bool {
    let mut token = ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0
        || token.is_null()
    {
        return false;
    }
    let token = unsafe { OwnedHandle::from_raw_handle(token) };
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut returned = 0;
    unsafe {
        GetTokenInformation(
            token.as_raw_handle() as HANDLE,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        ) != 0
            && returned as usize == std::mem::size_of::<TOKEN_ELEVATION>()
            && elevation.TokenIsElevated != 0
    }
}

const PROVIDER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0101);
const SUBLAYER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0102);
const FILTER_KEYS: [windows_sys::core::GUID; 8] = [
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0111),
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0112),
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0121),
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0122),
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0131),
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0132),
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0141),
    windows_sys::core::GUID::from_u128(0x7d4d7a41_2f22_4d2a_8f11_0e4b6a6a0142),
];

const FILTER_LAYERS: [windows_sys::core::GUID; 8] = [
    FWPM_LAYER_ALE_AUTH_CONNECT_V4,
    FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
    FWPM_LAYER_ALE_AUTH_LISTEN_V4,
    FWPM_LAYER_ALE_AUTH_LISTEN_V6,
    FWPM_LAYER_ALE_RESOURCE_ASSIGNMENT_V4,
    FWPM_LAYER_ALE_RESOURCE_ASSIGNMENT_V6,
];

// HRESULT values from the Windows SDK WFP definitions. Only these exact
// missing-object results are repairable; access and service errors fail closed.
const FWP_E_FILTER_NOT_FOUND: u32 = 0x8032_0003;
const FWP_E_PROVIDER_NOT_FOUND: u32 = 0x8032_0005;
const FWP_E_SUBLAYER_NOT_FOUND: u32 = 0x8032_0007;

pub fn reconcile_network_deny(package_sid: &str) -> Result<(), &'static str> {
    let sid = LocalSid::from_string(package_sid)?;
    let engine = Engine::open()?;
    let inspection = inspect_policy(engine.raw(), sid.as_raw())?;
    if inspection.is_ready() {
        return Ok(());
    }
    inspection.validate_repairable()?;

    // Persistent WFP objects are added atomically. No partial rule set is
    // accepted; an incomplete but correctly owned set is repaired by adding
    // only missing objects, and any failed add aborts the complete transaction.
    transactional_apply(
        || {
            if unsafe { FwpmTransactionBegin0(engine.raw(), 0) } == 0 {
                Ok(())
            } else {
                Err("wfp_transaction_begin_failed")
            }
        },
        || add_policy(engine.raw(), sid.as_raw(), &inspection),
        || {
            if unsafe { FwpmTransactionCommit0(engine.raw()) } == 0 {
                Ok(())
            } else {
                Err("wfp_transaction_commit_failed")
            }
        },
        || {
            if unsafe { FwpmTransactionAbort0(engine.raw()) } == 0 {
                Ok(())
            } else {
                Err("wfp_transaction_abort_failed")
            }
        },
    )?;

    if inspect_policy(engine.raw(), sid.as_raw())?.is_ready() {
        Ok(())
    } else {
        Err("wfp_post_install_verification_failed")
    }
}

pub fn probe_network_deny(package_sid: &str) -> Result<bool, &'static str> {
    let sid = LocalSid::from_string(package_sid)?;
    let engine = Engine::open()?;
    probe_with_engine(engine.raw(), sid.as_raw())
}

fn add_policy(
    engine: HANDLE,
    package_sid: PSID,
    inspection: &PolicyInspection,
) -> Result<(), &'static str> {
    if inspection.provider == ObjectState::Missing {
        let provider_name = wide("Noema Workspace Runner");
        let provider_description = wide("Noema AppContainer network deny policy");
        let provider = FWPM_PROVIDER0 {
            providerKey: PROVIDER_KEY,
            displayData: FWPM_DISPLAY_DATA0 {
                name: provider_name.as_ptr() as _,
                description: provider_description.as_ptr() as _,
            },
            flags: FWPM_PROVIDER_FLAG_PERSISTENT,
            ..Default::default()
        };
        if unsafe { FwpmProviderAdd0(engine, &provider, ptr::null_mut()) } != 0 {
            return Err("wfp_provider_add_failed");
        }
    }

    let mut provider_key = PROVIDER_KEY;
    if inspection.sublayer == ObjectState::Missing {
        let sublayer_name = wide("Noema AppContainer network deny");
        let sublayer_description = wide("Blocks network access for the Noema command AppContainer");
        let sublayer = FWPM_SUBLAYER0 {
            subLayerKey: SUBLAYER_KEY,
            displayData: FWPM_DISPLAY_DATA0 {
                name: sublayer_name.as_ptr() as _,
                description: sublayer_description.as_ptr() as _,
            },
            flags: FWPM_SUBLAYER_FLAG_PERSISTENT,
            providerKey: &mut provider_key,
            weight: 0x7fff,
            ..Default::default()
        };
        if unsafe { FwpmSubLayerAdd0(engine, &sublayer, ptr::null_mut()) } != 0 {
            return Err("wfp_sublayer_add_failed");
        }
    }

    let mut provider_key = PROVIDER_KEY;
    for (index, (filter_key, layer_key)) in FILTER_KEYS.iter().zip(FILTER_LAYERS).enumerate() {
        if inspection.filters[index] == ObjectState::Exact {
            continue;
        }
        let name = wide(&format!("Noema AppContainer network deny {index}"));
        let description = wide("Blocks this AppContainer package at the ALE network layer");
        let mut condition = FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_ALE_PACKAGE_ID,
            matchType: FWP_MATCH_EQUAL,
            conditionValue: FWP_CONDITION_VALUE0 {
                r#type: FWP_SID,
                Anonymous: FWP_CONDITION_VALUE0_0 {
                    sid: package_sid.cast::<SID>(),
                },
            },
        };
        let filter = FWPM_FILTER0 {
            filterKey: *filter_key,
            displayData: FWPM_DISPLAY_DATA0 {
                name: name.as_ptr() as _,
                description: description.as_ptr() as _,
            },
            flags: FWPM_FILTER_FLAG_PERSISTENT,
            providerKey: &mut provider_key,
            layerKey: layer_key,
            subLayerKey: SUBLAYER_KEY,
            numFilterConditions: 1,
            filterCondition: &mut condition,
            action: FWPM_ACTION0 {
                r#type: FWP_ACTION_BLOCK,
                ..Default::default()
            },
            ..Default::default()
        };
        if unsafe { FwpmFilterAdd0(engine, &filter, ptr::null_mut(), ptr::null_mut()) } != 0 {
            return Err("wfp_filter_add_failed");
        }
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ObjectState {
    Missing,
    Exact,
    Mismatch,
}

struct PolicyInspection {
    provider: ObjectState,
    sublayer: ObjectState,
    filters: [ObjectState; 8],
}

impl PolicyInspection {
    fn is_ready(&self) -> bool {
        self.provider == ObjectState::Exact
            && self.sublayer == ObjectState::Exact
            && self
                .filters
                .iter()
                .all(|state| *state == ObjectState::Exact)
    }

    fn validate_repairable(&self) -> Result<(), &'static str> {
        let any_filter = self
            .filters
            .iter()
            .any(|state| *state != ObjectState::Missing);
        if self.provider == ObjectState::Mismatch
            || self.sublayer == ObjectState::Mismatch
            || self.filters.contains(&ObjectState::Mismatch)
            || (self.provider == ObjectState::Missing
                && (self.sublayer != ObjectState::Missing || any_filter))
            || (self.sublayer == ObjectState::Missing && any_filter)
        {
            return Err("wfp_existing_policy_conflict");
        }
        Ok(())
    }
}

fn inspect_policy(engine: HANDLE, expected_sid: PSID) -> Result<PolicyInspection, &'static str> {
    let mut provider = ptr::null_mut();
    let provider_status = unsafe { FwpmProviderGetByKey0(engine, &PROVIDER_KEY, &mut provider) };
    let provider_state = if provider_status == FWP_E_PROVIDER_NOT_FOUND {
        free_wfp(provider);
        ObjectState::Missing
    } else if provider_status != 0 {
        free_wfp(provider);
        return Err("wfp_provider_probe_failed");
    } else if provider.is_null() {
        return Err("wfp_provider_probe_invalid");
    } else {
        let valid = unsafe {
            guid_equal(&(*provider).providerKey, &PROVIDER_KEY)
                && (*provider).flags == FWPM_PROVIDER_FLAG_PERSISTENT
                && (*provider).serviceName.is_null()
        };
        free_wfp(provider);
        if valid {
            ObjectState::Exact
        } else {
            ObjectState::Mismatch
        }
    };

    let mut sublayer = ptr::null_mut();
    let sublayer_status = unsafe { FwpmSubLayerGetByKey0(engine, &SUBLAYER_KEY, &mut sublayer) };
    let sublayer_state = if sublayer_status == FWP_E_SUBLAYER_NOT_FOUND {
        free_wfp(sublayer);
        ObjectState::Missing
    } else if sublayer_status != 0 {
        free_wfp(sublayer);
        return Err("wfp_sublayer_probe_failed");
    } else if sublayer.is_null() {
        return Err("wfp_sublayer_probe_invalid");
    } else {
        let valid = unsafe {
            let value = &*sublayer;
            guid_equal(&value.subLayerKey, &SUBLAYER_KEY)
                && value.flags == FWPM_SUBLAYER_FLAG_PERSISTENT
                && value.weight == 0x7fff
                && !value.providerKey.is_null()
                && guid_equal(&*value.providerKey, &PROVIDER_KEY)
        };
        free_wfp(sublayer);
        if valid {
            ObjectState::Exact
        } else {
            ObjectState::Mismatch
        }
    };

    let mut filters = [ObjectState::Missing; 8];
    for (index, (key, layer)) in FILTER_KEYS.iter().zip(FILTER_LAYERS).enumerate() {
        let mut filter = ptr::null_mut();
        let status = unsafe { FwpmFilterGetByKey0(engine, key, &mut filter) };
        if status == FWP_E_FILTER_NOT_FOUND {
            free_wfp(filter);
            continue;
        }
        if status != 0 {
            free_wfp(filter);
            return Err("wfp_filter_probe_failed");
        }
        if filter.is_null() {
            return Err("wfp_filter_probe_invalid");
        }
        let valid = unsafe { exact_filter(&*filter, key, &layer, expected_sid) };
        free_wfp(filter);
        filters[index] = if valid {
            ObjectState::Exact
        } else {
            ObjectState::Mismatch
        };
    }
    Ok(PolicyInspection {
        provider: provider_state,
        sublayer: sublayer_state,
        filters,
    })
}

fn probe_with_engine(engine: HANDLE, expected_sid: PSID) -> Result<bool, &'static str> {
    Ok(inspect_policy(engine, expected_sid)?.is_ready())
}

fn transactional_apply(
    begin: impl FnOnce() -> Result<(), &'static str>,
    apply: impl FnOnce() -> Result<(), &'static str>,
    commit: impl FnOnce() -> Result<(), &'static str>,
    abort: impl FnOnce() -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    begin()?;
    if let Err(operation_error) = apply() {
        return match abort() {
            Ok(()) => Err(operation_error),
            Err(abort_error) => Err(abort_error),
        };
    }
    if let Err(commit_error) = commit() {
        return match abort() {
            Ok(()) => Err(commit_error),
            Err(abort_error) => Err(abort_error),
        };
    }
    Ok(())
}

unsafe fn exact_filter(
    filter: &FWPM_FILTER0,
    expected_key: &windows_sys::core::GUID,
    expected_layer: &windows_sys::core::GUID,
    expected_sid: PSID,
) -> bool {
    if !guid_equal(&filter.filterKey, expected_key)
        || filter.flags != FWPM_FILTER_FLAG_PERSISTENT
        || !guid_equal(&filter.layerKey, expected_layer)
        || !guid_equal(&filter.subLayerKey, &SUBLAYER_KEY)
        || filter.providerKey.is_null()
        || unsafe { !guid_equal(&*filter.providerKey, &PROVIDER_KEY) }
        || filter.numFilterConditions != 1
        || filter.filterCondition.is_null()
        || filter.action.r#type != FWP_ACTION_BLOCK
    {
        return false;
    }
    // SAFETY: filterCondition is non-null and the API returned one condition.
    let condition = unsafe { &*filter.filterCondition };
    if !guid_equal(&condition.fieldKey, &FWPM_CONDITION_ALE_PACKAGE_ID)
        || condition.matchType != FWP_MATCH_EQUAL
        || condition.conditionValue.r#type != FWP_SID
    {
        return false;
    }
    // SAFETY: the discriminator was checked above, so the SID union member is active.
    let actual_sid = unsafe { condition.conditionValue.Anonymous.sid };
    !actual_sid.is_null()
        && unsafe {
            IsValidSid(actual_sid.cast()) != 0 && EqualSid(actual_sid.cast(), expected_sid) != 0
        }
}

fn guid_equal(left: &windows_sys::core::GUID, right: &windows_sys::core::GUID) -> bool {
    left.data1 == right.data1
        && left.data2 == right.data2
        && left.data3 == right.data3
        && left.data4 == right.data4
}

// FwpmEngineOpen0 returns an RPC engine context, not a kernel HANDLE; close it
// only with FwpmEngineClose0 rather than std::OwnedHandle/CloseHandle.
struct Engine(HANDLE);

impl Engine {
    fn open() -> Result<Self, &'static str> {
        let mut raw = ptr::null_mut();
        let status = unsafe {
            FwpmEngineOpen0(
                ptr::null(),
                RPC_C_AUTHN_WINNT,
                ptr::null(),
                ptr::null(),
                &mut raw,
            )
        };
        if status != 0 || raw.is_null() {
            return Err("wfp_engine_open_failed");
        }
        Ok(Self(raw))
    }

    fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        unsafe { FwpmEngineClose0(self.raw()) };
    }
}

struct LocalSid(PSID);

impl LocalSid {
    fn from_string(value: &str) -> Result<Self, &'static str> {
        if !crate::appcontainer::is_appcontainer_package_sid(value) {
            return Err("appcontainer_package_sid_invalid");
        }
        let value = wide(value);
        let mut sid = ptr::null_mut();
        if unsafe { ConvertStringSidToSidW(value.as_ptr(), &mut sid) } == 0
            || sid.is_null()
            || unsafe { IsValidSid(sid) } == 0
        {
            free_local(sid.cast());
            return Err("wfp_package_sid_invalid");
        }
        Ok(Self(sid))
    }

    fn as_raw(&self) -> PSID {
        self.0
    }
}

impl Drop for LocalSid {
    fn drop(&mut self) {
        free_local(self.0.cast());
    }
}

fn free_wfp<T>(value: *mut T) {
    if !value.is_null() {
        let mut value = value.cast::<std::ffi::c_void>();
        unsafe { FwpmFreeMemory0(&mut value) };
    }
}

fn free_local(value: *mut std::ffi::c_void) {
    if !value.is_null() {
        unsafe { LocalFree(value as HLOCAL) };
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        FILTER_KEYS, FILTER_LAYERS, ObjectState, PROVIDER_KEY, PolicyInspection, SUBLAYER_KEY,
        guid_equal, transactional_apply,
    };

    #[test]
    fn network_deny_uses_eight_unique_stable_keys_and_all_four_ale_layer_families() {
        let keys = std::iter::once(PROVIDER_KEY)
            .chain(std::iter::once(SUBLAYER_KEY))
            .chain(FILTER_KEYS)
            .map(|key| (key.data1, key.data2, key.data3, key.data4))
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(keys.len(), 10);
        assert_eq!(FILTER_LAYERS.len(), 8);
        let layers = FILTER_LAYERS
            .iter()
            .map(|key| (key.data1, key.data2, key.data3, key.data4))
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(layers.len(), 8);
        assert!(guid_equal(
            &FILTER_LAYERS[0],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_AUTH_CONNECT_V4
        ));
        assert!(guid_equal(
            &FILTER_LAYERS[1],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_AUTH_CONNECT_V6
        ));
        assert!(guid_equal(
            &FILTER_LAYERS[2],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4
        ));
        assert!(guid_equal(
            &FILTER_LAYERS[3],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6
        ));
        assert!(guid_equal(
            &FILTER_LAYERS[4],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_AUTH_LISTEN_V4
        ));
        assert!(guid_equal(
            &FILTER_LAYERS[5],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_AUTH_LISTEN_V6
        ));
        assert!(guid_equal(
            &FILTER_LAYERS[6],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_RESOURCE_ASSIGNMENT_V4
        ));
        assert!(guid_equal(
            &FILTER_LAYERS[7],
            &windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWPM_LAYER_ALE_RESOURCE_ASSIGNMENT_V6
        ));
    }

    #[test]
    fn wfp_repair_accepts_only_missing_rules_inside_the_owned_policy() {
        let mut inspection = PolicyInspection {
            provider: ObjectState::Exact,
            sublayer: ObjectState::Exact,
            filters: [ObjectState::Exact; 8],
        };
        assert!(inspection.is_ready());
        inspection.filters[3] = ObjectState::Missing;
        assert!(!inspection.is_ready());
        assert!(inspection.validate_repairable().is_ok());

        inspection.filters[3] = ObjectState::Mismatch;
        assert_eq!(
            inspection.validate_repairable(),
            Err("wfp_existing_policy_conflict")
        );
        inspection.filters[3] = ObjectState::Exact;
        inspection.provider = ObjectState::Missing;
        assert_eq!(
            inspection.validate_repairable(),
            Err("wfp_existing_policy_conflict")
        );
    }

    #[test]
    fn wfp_transaction_failures_abort_and_never_commit_partial_adds() {
        for (begin_ok, apply_ok, commit_ok, expected, calls) in [
            (false, true, true, Err("begin"), vec!["begin"]),
            (
                true,
                false,
                true,
                Err("add"),
                vec!["begin", "apply", "abort"],
            ),
            (
                true,
                true,
                false,
                Err("commit"),
                vec!["begin", "apply", "commit", "abort"],
            ),
            (true, true, true, Ok(()), vec!["begin", "apply", "commit"]),
        ] {
            let actual_calls = std::cell::RefCell::new(Vec::new());
            let result = transactional_apply(
                || {
                    actual_calls.borrow_mut().push("begin");
                    if begin_ok { Ok(()) } else { Err("begin") }
                },
                || {
                    actual_calls.borrow_mut().push("apply");
                    if apply_ok { Ok(()) } else { Err("add") }
                },
                || {
                    actual_calls.borrow_mut().push("commit");
                    if commit_ok { Ok(()) } else { Err("commit") }
                },
                || {
                    actual_calls.borrow_mut().push("abort");
                    Ok(())
                },
            );
            assert_eq!(result, expected);
            assert_eq!(*actual_calls.borrow(), calls);
        }
    }
}
