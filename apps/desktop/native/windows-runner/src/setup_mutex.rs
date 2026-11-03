//! Cross-process serialization for sandbox profile, ACL, and network setup.
//!
//! This mutex adapts the fixed Codex `setup_mutex.rs` boundary. Every future
//! profile, ACL, WFP, repair, or uninstall mutation must hold it for the
//! complete native operation. The current user serializes ordinary setup;
//! SYSTEM and administrators can also acquire it for elevated WFP setup.

use std::ffi::OsStr;
use std::marker::PhantomData;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr;
use windows_sys::Win32::Foundation::{
    HANDLE, HLOCAL, LocalFree, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject};

const SETUP_MUTEX_NAME: &str = r"Global\NoemaWindowsRunnerSetupV2";
const SETUP_MUTEX_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;OW)";
pub const DEFAULT_SETUP_MUTEX_TIMEOUT_MS: u32 = 30_000;
pub const MAX_SETUP_MUTEX_TIMEOUT_MS: u32 = 300_000;

/// Retains the mutex handle and releases ownership on the acquiring thread.
/// The raw-pointer marker deliberately makes this guard `!Send`.
#[must_use]
pub struct WindowsRunnerSetupLock {
    handle: OwnedHandle,
    abandoned: bool,
    _thread_bound: PhantomData<*mut ()>,
}

impl WindowsRunnerSetupLock {
    /// An abandoned lock means the prior owner exited during setup. The new
    /// owner must reconcile live state before it may treat the operation as
    /// complete.
    pub fn was_abandoned(&self) -> bool {
        self.abandoned
    }
}

impl Drop for WindowsRunnerSetupLock {
    fn drop(&mut self) {
        // SAFETY: this guard owns the mutex on this thread until Drop.
        unsafe { ReleaseMutex(self.handle.as_raw_handle() as HANDLE) };
    }
}

/// Wait for the machine-wide setup mutex. An abandoned lock is acquired and
/// returned as a valid guard; callers must reconcile live state before ready.
pub fn acquire_windows_runner_setup_lock(
    timeout_ms: u32,
) -> Result<WindowsRunnerSetupLock, &'static str> {
    validate_setup_mutex_timeout(timeout_ms)?;
    let mut descriptor = ptr::null_mut();
    let sddl = to_wide(SETUP_MUTEX_SDDL);
    // SAFETY: `sddl` is NUL-terminated and `descriptor` is a writable output.
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            ptr::null_mut(),
        )
    } == 0
        || descriptor.is_null()
    {
        return Err("setup_mutex_security_descriptor_failed");
    }

    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    let name = to_wide(SETUP_MUTEX_NAME);
    // SAFETY: attributes and the NUL-terminated name remain live for the call.
    let raw_handle = unsafe { CreateMutexW(&mut attributes, 0, name.as_ptr()) };
    // SAFETY: the descriptor was allocated by the SDDL conversion API.
    unsafe { LocalFree(descriptor as HLOCAL) };
    if raw_handle.is_null() {
        return Err("setup_mutex_open_failed");
    }
    // SAFETY: CreateMutexW returned a new owned kernel handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw_handle) };
    // SAFETY: `handle` is live and this bounded timeout was validated above.
    match unsafe { WaitForSingleObject(handle.as_raw_handle() as HANDLE, timeout_ms) } {
        WAIT_OBJECT_0 => Ok(WindowsRunnerSetupLock {
            handle,
            abandoned: false,
            _thread_bound: PhantomData,
        }),
        WAIT_ABANDONED => Ok(WindowsRunnerSetupLock {
            handle,
            abandoned: true,
            _thread_bound: PhantomData,
        }),
        WAIT_TIMEOUT => Err("setup_mutex_timeout"),
        _ => Err("setup_mutex_wait_failed"),
    }
}

pub fn validate_abandoned_setup_action(
    was_abandoned: bool,
    reconcile: bool,
) -> Result<(), &'static str> {
    if was_abandoned && !reconcile {
        return Err("setup_mutex_abandoned_recovery_required");
    }
    Ok(())
}

fn validate_setup_mutex_timeout(timeout_ms: u32) -> Result<(), &'static str> {
    if timeout_ms > MAX_SETUP_MUTEX_TIMEOUT_MS {
        return Err("setup_mutex_timeout_invalid");
    }
    Ok(())
}

fn to_wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_SETUP_MUTEX_TIMEOUT_MS, MAX_SETUP_MUTEX_TIMEOUT_MS, SETUP_MUTEX_SDDL,
        validate_abandoned_setup_action, validate_setup_mutex_timeout,
    };

    #[test]
    fn setup_mutex_allows_owner_user_and_keeps_machine_admin_recovery_access() {
        assert!(SETUP_MUTEX_SDDL.contains(";;;OW)"));
        assert!(SETUP_MUTEX_SDDL.contains(";;;BA)"));
        assert!(SETUP_MUTEX_SDDL.contains(";;;SY)"));
    }

    #[test]
    fn setup_mutex_wait_is_bounded() {
        assert_eq!(validate_setup_mutex_timeout(0), Ok(()));
        assert_eq!(
            validate_setup_mutex_timeout(DEFAULT_SETUP_MUTEX_TIMEOUT_MS),
            Ok(())
        );
        assert_eq!(
            validate_setup_mutex_timeout(MAX_SETUP_MUTEX_TIMEOUT_MS),
            Ok(())
        );
        assert_eq!(
            validate_setup_mutex_timeout(MAX_SETUP_MUTEX_TIMEOUT_MS + 1),
            Err("setup_mutex_timeout_invalid")
        );
    }

    #[test]
    fn abandoned_setup_lock_requires_live_reconciliation() {
        assert_eq!(validate_abandoned_setup_action(false, false), Ok(()));
        assert_eq!(validate_abandoned_setup_action(false, true), Ok(()));
        assert_eq!(
            validate_abandoned_setup_action(true, false),
            Err("setup_mutex_abandoned_recovery_required")
        );
        assert_eq!(validate_abandoned_setup_action(true, true), Ok(()));
    }
}
