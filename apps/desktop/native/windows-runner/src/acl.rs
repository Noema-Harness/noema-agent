//! Handle-based DACL grant primitive adapted from the fixed Codex Windows
//! sandbox ACL source. Callers must supply an already verified no-reparse
//! file-system handle and keep the ACL transaction journal pending on error.

use crate::policy::FilesystemAccessMode;
use std::ffi::c_void;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr;
use windows_sys::Win32::Foundation::{
    ERROR_SUCCESS, GetLastError, HANDLE, HLOCAL, LocalFree, SetLastError,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, EXPLICIT_ACCESS_W, GRANT_ACCESS, GetSecurityInfo, SE_FILE_OBJECT,
    SetEntriesInAclW, SetSecurityInfo, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL_SIZE_INFORMATION, AclSizeInformation, EqualSid, GetAce,
    GetAclInformation, IsTokenRestricted, IsValidAcl, TOKEN_QUERY,
};
use windows_sys::Win32::Security::{ACL, DACL_SECURITY_INFORMATION};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

const OBJECT_INHERIT_ACE: u32 = 0x01;
const CONTAINER_INHERIT_ACE: u32 = 0x02;
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const INHERIT_ONLY_ACE: u8 = 0x08;
const WRITE_ALLOW_MASK: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;
const READ_ALLOW_MASK: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;

fn access_allow_mask(access: FilesystemAccessMode) -> u32 {
    match access {
        FilesystemAccessMode::Read => READ_ALLOW_MASK,
        FilesystemAccessMode::Write => WRITE_ALLOW_MASK,
    }
}

/// Reject runner operations issued by an agent process that already has a
/// restricting-SID list. The main process calls this same executable with its
/// ordinary token; commands run under a restricted token and cannot re-enter
/// the trusted policy/ACL boundary by launching the binary themselves.
pub fn require_unrestricted_caller() -> Result<(), &'static str> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: GetCurrentProcess returns a pseudo-handle; `token` is writable.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0
        || token.is_null()
    {
        return Err("runner_caller_token_query_failed");
    }
    // SAFETY: OpenProcessToken succeeded and transfers one owned token handle.
    let token = unsafe { OwnedHandle::from_raw_handle(token) };
    require_unrestricted_token(token.as_raw_handle() as HANDLE)
}

fn require_unrestricted_token(token: HANDLE) -> Result<(), &'static str> {
    if token_has_restricting_sids(token)? {
        return Err("runner_caller_restricted");
    }
    Ok(())
}

fn token_has_restricting_sids(token: HANDLE) -> Result<bool, &'static str> {
    // IsTokenRestricted returns FALSE both for an unrestricted token and on
    // error, so clear and inspect last error to keep the gate fail closed.
    unsafe { SetLastError(ERROR_SUCCESS) };
    // SAFETY: caller supplies a live token handle with TOKEN_QUERY access.
    let restricted = unsafe { IsTokenRestricted(token) };
    let error = unsafe { GetLastError() };
    if restricted == 0 && error != ERROR_SUCCESS {
        return Err("runner_caller_token_query_failed");
    }
    Ok(restricted != 0)
}

/// Adds the capability allow ACE to the DACL attached to `handle`.
///
/// This function changes a real Windows object ACL if called. It is not wired
/// into runner admission yet. The helper must first persist the grant batch,
/// scan all write roots, and open the target with `READ_CONTROL | WRITE_DAC`;
/// after this returns, it must re-read and verify every object before clearing
/// the journal or creating a child.
///
/// # Safety
/// `handle` must be an open handle to the verified, intended file-system object
/// obtained without following a reparse point. It must remain owned by the
/// caller for the duration of this call. `capability_name` must come from the
/// trusted main-process grant journal, never directly from command input.
#[allow(dead_code)] // Kept unreachable until the ACL journal and helper path are integrated.
pub unsafe fn apply_capability_allow_ace(
    handle: *mut c_void,
    capability_name: &str,
    access: FilesystemAccessMode,
    is_directory: bool,
) -> Result<(), &'static str> {
    let sid = parse_sid(capability_name)?;
    let mut descriptor = ptr::null_mut();
    let mut old_dacl: *mut ACL = ptr::null_mut();
    // SAFETY: caller promises `handle` is a live object handle; output pointers
    // are initialized locals and the returned descriptor is freed below.
    let get_result = unsafe {
        GetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut old_dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if get_result != ERROR_SUCCESS {
        free_local(descriptor);
        free_local(sid);
        return Err("acl_read_failed");
    }
    if old_dacl.is_null() {
        free_local(descriptor);
        free_local(sid);
        return Err("acl_null_dacl_rejected");
    }
    // SAFETY: the descriptor is returned by GetSecurityInfo and remains live.
    if unsafe { IsValidAcl(old_dacl) } == 0 {
        free_local(descriptor);
        free_local(sid);
        return Err("acl_invalid");
    }
    // A protected directory cannot pass this capability to files/directories
    // created below it. Do not silently unprotect a user's DACL.
    let inheritance_protected = if is_directory {
        match unsafe { descriptor_dacl_is_protected(descriptor) } {
            Ok(value) => value,
            Err(code) => {
                free_local(descriptor);
                free_local(sid);
                return Err(code);
            }
        }
    } else {
        false
    };
    if inheritance_protected {
        free_local(descriptor);
        free_local(sid);
        return Err("acl_inheritance_protected");
    }
    // Reconciliation is idempotent: if this SID already has the complete ACE,
    // avoid adding another entry. A deny ACE for this private capability SID
    // is treated as untrusted state rather than silently rewritten.
    match unsafe { acl_has_capability_grant(old_dacl, sid, access, is_directory) } {
        Ok(true) => {
            free_local(descriptor);
            free_local(sid);
            return Ok(());
        }
        Ok(false) => {}
        Err(code) => {
            free_local(descriptor);
            free_local(sid);
            return Err(code);
        }
    }

    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: access_allow_mask(access),
        grfAccessMode: GRANT_ACCESS,
        grfInheritance: if is_directory {
            OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
        } else {
            0
        },
        Trustee: TRUSTEE_W {
            pMultipleTrustee: ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast(),
        },
    };
    let mut new_dacl: *mut ACL = ptr::null_mut();
    // SAFETY: `old_dacl` is owned by `descriptor`, and the trustee SID remains
    // live until the merge and subsequent SetSecurityInfo call complete.
    let merge_result = unsafe { SetEntriesInAclW(1, &entry, old_dacl, &mut new_dacl) };
    if merge_result != ERROR_SUCCESS || new_dacl.is_null() {
        free_local(new_dacl.cast());
        free_local(descriptor);
        free_local(sid);
        return Err("acl_merge_failed");
    }

    // SAFETY: `handle` remains valid, and `new_dacl` is the ACL returned by
    // SetEntriesInAclW. Only the DACL is replaced; owner/group/SACL are untouched.
    let set_result = unsafe {
        SetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            new_dacl,
            ptr::null_mut(),
        )
    };
    if set_result != ERROR_SUCCESS {
        free_local(new_dacl.cast());
        free_local(descriptor);
        free_local(sid);
        return Err("acl_write_failed");
    }
    free_local(new_dacl.cast());
    free_local(descriptor);
    free_local(sid);
    // The API can succeed while an unexpected descriptor state remains. Read
    // the same object handle again and require the exact capability allow ACE.
    unsafe { verify_capability_allow_ace(handle, capability_name, access, is_directory) }
}

/// Verify the capability allow ACE on an already verified handle without
/// changing the object. Directory verification also requires inheritable ACE
/// flags and an unprotected DACL.
///
/// # Safety
/// `handle` must be a live handle to the intended verified file-system object.
pub unsafe fn verify_capability_allow_ace(
    handle: *mut c_void,
    capability_name: &str,
    access: FilesystemAccessMode,
    is_directory: bool,
) -> Result<(), &'static str> {
    let sid = parse_sid(capability_name)?;
    let mut descriptor = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    // SAFETY: caller promises a live handle; outputs are local and descriptor is freed below.
    let query = unsafe {
        GetSecurityInfo(
            handle,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if query != ERROR_SUCCESS {
        free_local(descriptor);
        free_local(sid);
        return Err("acl_read_failed");
    }
    let result = if dacl.is_null() {
        Err("acl_null_dacl_rejected")
    } else if unsafe { IsValidAcl(dacl) } == 0 {
        Err("acl_invalid")
    } else {
        let protected = if is_directory {
            unsafe { descriptor_dacl_is_protected(descriptor) }
        } else {
            Ok(false)
        };
        match protected {
            Err(code) => Err(code),
            Ok(true) => Err("acl_inheritance_protected"),
            Ok(false) => match unsafe { acl_has_capability_grant(dacl, sid, access, is_directory) }
            {
                Ok(true) => Ok(()),
                Ok(false) => Err("acl_grant_missing"),
                Err(code) => Err(code),
            },
        }
    };
    free_local(descriptor);
    free_local(sid);
    result
}

fn parse_sid(value: &str) -> Result<*mut c_void, &'static str> {
    if !is_valid_capability_name(value) {
        return Err("acl_sid_invalid");
    }
    let resolved_sid = crate::appcontainer::derive_capability_name(value)?;
    let mut wide = resolved_sid.encode_utf16().collect::<Vec<_>>();
    wide.push(0);
    let mut sid = ptr::null_mut();
    // SAFETY: `wide` is NUL-terminated and `sid` is a writable output pointer.
    if unsafe { ConvertStringSidToSidW(wide.as_ptr(), &mut sid) } == 0 || sid.is_null() {
        free_local(sid);
        return Err("acl_sid_invalid");
    }
    Ok(sid)
}

pub fn is_valid_capability_name(value: &str) -> bool {
    crate::appcontainer::is_capability_name(value)
}

unsafe fn descriptor_dacl_is_protected(descriptor: *mut c_void) -> Result<bool, &'static str> {
    let mut control = 0_u16;
    let mut revision = 0_u32;
    // SAFETY: descriptor is owned by the caller and remains live for this call.
    if unsafe {
        windows_sys::Win32::Security::GetSecurityDescriptorControl(
            descriptor,
            &mut control,
            &mut revision,
        )
    } == 0
    {
        return Err("acl_descriptor_query_failed");
    }
    Ok(control & windows_sys::Win32::Security::SE_DACL_PROTECTED != 0)
}

unsafe fn acl_has_capability_grant(
    dacl: *mut ACL,
    sid: *mut c_void,
    access: FilesystemAccessMode,
    is_directory: bool,
) -> Result<bool, &'static str> {
    let mut found = false;
    let mut info = ACL_SIZE_INFORMATION {
        AceCount: 0,
        AclBytesInUse: 0,
        AclBytesFree: 0,
    };
    // SAFETY: `dacl` was returned within a live security descriptor.
    if unsafe {
        GetAclInformation(
            dacl,
            (&mut info as *mut ACL_SIZE_INFORMATION).cast(),
            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    } == 0
    {
        return Err("acl_query_failed");
    }
    for index in 0..info.AceCount {
        let mut ace = ptr::null_mut();
        // SAFETY: index is bounded by the ACL's reported AceCount.
        if unsafe { GetAce(dacl, index, &mut ace) } == 0 || ace.is_null() {
            return Err("acl_query_failed");
        }
        // SAFETY: GetAce returns a pointer to a valid ACE header in this DACL.
        let header = unsafe { &*ace.cast::<ACE_HEADER>() };
        if header.AceType != ACCESS_ALLOWED_ACE_TYPE && header.AceType != ACCESS_DENIED_ACE_TYPE {
            continue;
        }
        let sid_address = (ace as usize
            + std::mem::size_of::<ACE_HEADER>()
            + std::mem::size_of::<u32>()) as *mut c_void;
        // SAFETY: both pointers identify SIDs in a valid ACE and in LocalAlloc memory.
        if unsafe { EqualSid(sid_address, sid) } == 0 {
            continue;
        }
        if header.AceType == ACCESS_DENIED_ACE_TYPE {
            let inherited_by_child = is_directory
                && header.AceFlags & (OBJECT_INHERIT_ACE as u8 | CONTAINER_INHERIT_ACE as u8) != 0;
            if header.AceFlags & INHERIT_ONLY_ACE == 0 || inherited_by_child {
                return Err("acl_capability_deny_ace");
            }
            continue;
        }
        if header.AceFlags & INHERIT_ONLY_ACE != 0 {
            continue;
        }
        // SAFETY: the ACE type was checked above.
        let allow = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
        let has_inheritance = header.AceFlags
            & (OBJECT_INHERIT_ACE as u8 | CONTAINER_INHERIT_ACE as u8)
            == (OBJECT_INHERIT_ACE as u8 | CONTAINER_INHERIT_ACE as u8);
        // Capability SIDs are unique to one root and access mode. Require the
        // exact mask so extra standard/generic rights cannot silently widen a
        // read grant or exceed the write grant's intended surface.
        let mode_matches = allow.Mask == access_allow_mask(access);
        if !mode_matches {
            return Err("acl_capability_mask_unexpected");
        }
        if !is_directory || has_inheritance {
            found = true;
        }
    }
    Ok(found)
}

fn free_local(pointer: *mut c_void) {
    if !pointer.is_null() {
        // SAFETY: each pointer passed here was allocated by a Windows API that
        // documents LocalFree as its matching deallocator.
        unsafe { LocalFree(pointer as HLOCAL) };
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CONTAINER_INHERIT_ACE, OBJECT_INHERIT_ACE, WRITE_ALLOW_MASK, access_allow_mask,
        acl_has_capability_grant, parse_sid, require_unrestricted_token,
        token_has_restricting_sids,
    };
    use crate::policy::FilesystemAccessMode;
    use std::ffi::c_void;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::ptr;
    use windows_sys::Win32::Foundation::{HANDLE, HLOCAL, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSidToSidW, DENY_ACCESS, EXPLICIT_ACCESS_W, GRANT_ACCESS, SetEntriesInAclW,
        TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACL, ACL_SIZE_INFORMATION, AclSizeInformation, CreateRestrictedToken,
        DISABLE_MAX_PRIVILEGE, EqualSid, GetAce, GetAclInformation, InitializeAcl, IsValidAcl,
        SID_AND_ATTRIBUTES, TOKEN_DUPLICATE, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe fn merged_acl(
        sid: *mut c_void,
        access: FilesystemAccessMode,
        is_directory: bool,
    ) -> *mut ACL {
        let mut old_storage = [0_u64; 128];
        let old_acl = old_storage.as_mut_ptr().cast::<ACL>();
        // SAFETY: aligned local storage is large enough for an empty ACL.
        assert_ne!(
            unsafe { InitializeAcl(old_acl, std::mem::size_of_val(&old_storage) as u32, 2) },
            0
        );
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: access_allow_mask(access),
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: if is_directory {
                OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
            } else {
                0
            },
            Trustee: TRUSTEE_W {
                pMultipleTrustee: ptr::null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: sid.cast(),
            },
        };
        let mut new_acl = ptr::null_mut();
        // SAFETY: `old_acl` is initialized, `sid` remains live, and output is local.
        assert_eq!(
            unsafe { SetEntriesInAclW(1, &entry, old_acl, &mut new_acl) },
            0
        );
        assert!(!new_acl.is_null());
        // `old_acl` points to local test storage; the merged ACL is LocalFree-owned.
        new_acl
    }

    unsafe fn assert_grant(sid: *mut c_void, is_directory: bool) {
        let acl = unsafe { merged_acl(sid, FilesystemAccessMode::Write, is_directory) };
        // SAFETY: `acl` is returned by SetEntriesInAclW and remains live.
        assert_ne!(unsafe { IsValidAcl(acl) }, 0);
        let mut info = ACL_SIZE_INFORMATION {
            AceCount: 0,
            AclBytesInUse: 0,
            AclBytesFree: 0,
        };
        // SAFETY: `info` is writable and the information class requests its type.
        assert_ne!(
            unsafe {
                GetAclInformation(
                    acl,
                    (&mut info as *mut ACL_SIZE_INFORMATION).cast(),
                    std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                    AclSizeInformation,
                )
            },
            0
        );
        assert_eq!(info.AceCount, 1);
        let mut ace = ptr::null_mut();
        // SAFETY: index zero is within the single-ACE ACL.
        assert_ne!(unsafe { GetAce(acl, 0, &mut ace) }, 0);
        let allowed = ace.cast::<ACCESS_ALLOWED_ACE>();
        // SAFETY: the test constructed the ACL with one allow entry.
        assert_eq!(unsafe { (*allowed).Mask }, WRITE_ALLOW_MASK);
        let expected_flags = if is_directory {
            OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
        } else {
            0
        };
        // SAFETY: `ace` points to an ACE returned by GetAce.
        assert_eq!(
            unsafe { (*ace.cast::<windows_sys::Win32::Security::ACE_HEADER>()).AceFlags as u32 },
            expected_flags
        );
        // SAFETY: SidStart is the first SID DWORD in ACCESS_ALLOWED_ACE.
        assert_ne!(
            unsafe { EqualSid(ptr::addr_of!((*allowed).SidStart) as *mut c_void, sid) },
            0
        );
        // SAFETY: `acl` was allocated by SetEntriesInAclW.
        unsafe { LocalFree(acl as HLOCAL) };
    }

    #[test]
    fn in_memory_file_grant_uses_write_mask_without_inheritance() {
        let sid = parse_sid(
            "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
        )
        .unwrap();
        unsafe { assert_grant(sid, false) };
        unsafe { LocalFree(sid as HLOCAL) };
    }

    #[test]
    fn in_memory_directory_grant_inherits_to_files_and_subdirectories() {
        let sid = parse_sid(
            "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
        )
        .unwrap();
        unsafe { assert_grant(sid, true) };
        unsafe { LocalFree(sid as HLOCAL) };
    }

    #[test]
    fn capability_name_parser_rejects_non_capability_and_noncanonical_sids() {
        for value in [
            "S-1-1-0",
            "S-1-5-32-544",
            "S-1-5-21-010-200-300-400",
            "S-1-5-21-100-200-300-4294967296",
        ] {
            assert_eq!(parse_sid(value).err(), Some("acl_sid_invalid"));
        }
    }

    #[test]
    fn existing_in_memory_grant_is_idempotent_and_requires_directory_inheritance() {
        let sid = parse_sid(
            "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
        )
        .unwrap();
        let directory_acl = unsafe { merged_acl(sid, FilesystemAccessMode::Write, true) };
        assert_eq!(
            unsafe {
                acl_has_capability_grant(directory_acl, sid, FilesystemAccessMode::Write, true)
            },
            Ok(true)
        );
        let file_acl = unsafe { merged_acl(sid, FilesystemAccessMode::Write, false) };
        assert_eq!(
            unsafe { acl_has_capability_grant(file_acl, sid, FilesystemAccessMode::Write, true) },
            Ok(false)
        );
        unsafe {
            LocalFree(directory_acl as HLOCAL);
            LocalFree(file_acl as HLOCAL);
            LocalFree(sid as HLOCAL);
        }
    }

    #[test]
    fn read_capability_acl_does_not_grant_write_and_rejects_write_access() {
        let sid = parse_sid(
            "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
        )
        .unwrap();
        let read_acl = unsafe { merged_acl(sid, FilesystemAccessMode::Read, true) };
        assert_eq!(
            unsafe { acl_has_capability_grant(read_acl, sid, FilesystemAccessMode::Read, true) },
            Ok(true)
        );
        assert_eq!(
            unsafe { acl_has_capability_grant(read_acl, sid, FilesystemAccessMode::Write, true) },
            Err("acl_capability_mask_unexpected")
        );
        unsafe {
            LocalFree(read_acl as HLOCAL);
            LocalFree(sid as HLOCAL);
        }
    }

    #[test]
    fn matching_in_memory_deny_ace_blocks_reconciliation() {
        let sid = parse_sid(
            "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
        )
        .unwrap();
        let mut old_storage = [0_u64; 128];
        let old_acl = old_storage.as_mut_ptr().cast::<ACL>();
        assert_ne!(
            unsafe { InitializeAcl(old_acl, std::mem::size_of_val(&old_storage) as u32, 2) },
            0
        );
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: WRITE_ALLOW_MASK,
            grfAccessMode: DENY_ACCESS,
            grfInheritance: OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: ptr::null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: sid.cast(),
            },
        };
        let mut deny_acl = ptr::null_mut();
        assert_eq!(
            unsafe { SetEntriesInAclW(1, &entry, old_acl, &mut deny_acl) },
            0
        );
        assert_eq!(
            unsafe { acl_has_capability_grant(deny_acl, sid, FilesystemAccessMode::Write, true) },
            Err("acl_capability_deny_ace")
        );
        unsafe {
            LocalFree(deny_acl as HLOCAL);
            LocalFree(sid as HLOCAL);
        }
    }

    #[test]
    fn restricted_agent_token_cannot_pass_the_native_helper_gate() {
        let mut base_token: HANDLE = ptr::null_mut();
        // SAFETY: the process pseudo-handle is valid and the output token is writable.
        assert_ne!(
            unsafe {
                OpenProcessToken(
                    GetCurrentProcess(),
                    TOKEN_DUPLICATE | TOKEN_QUERY,
                    &mut base_token,
                )
            },
            0
        );
        // SAFETY: OpenProcessToken succeeded and returned an owned token handle.
        let base_token = unsafe { OwnedHandle::from_raw_handle(base_token) };

        let sid_string = [
            b'S' as u16,
            b'-' as u16,
            b'1' as u16,
            b'-' as u16,
            b'1' as u16,
            b'-' as u16,
            b'0' as u16,
            0,
        ];
        let mut sid: *mut c_void = ptr::null_mut();
        // SAFETY: SID text is NUL-terminated and `sid` is an output pointer.
        assert_ne!(
            unsafe { ConvertStringSidToSidW(sid_string.as_ptr(), &mut sid) },
            0
        );
        assert!(!sid.is_null());
        let restricted_sid = SID_AND_ATTRIBUTES {
            Sid: sid,
            Attributes: 0,
        };
        let mut restricted_token: HANDLE = ptr::null_mut();
        // SAFETY: the existing token is queryable/duplicable and all pointers
        // remain live; this creates only an in-memory token, no account/process.
        assert_ne!(
            unsafe {
                CreateRestrictedToken(
                    base_token.as_raw_handle() as HANDLE,
                    DISABLE_MAX_PRIVILEGE,
                    0,
                    ptr::null(),
                    0,
                    ptr::null(),
                    1,
                    &restricted_sid,
                    &mut restricted_token,
                )
            },
            0
        );
        // SAFETY: CreateRestrictedToken succeeded and returned an owned token handle.
        let restricted_token = unsafe { OwnedHandle::from_raw_handle(restricted_token) };
        assert_eq!(
            token_has_restricting_sids(restricted_token.as_raw_handle() as HANDLE),
            Ok(true)
        );
        assert_eq!(
            require_unrestricted_token(restricted_token.as_raw_handle() as HANDLE),
            Err("runner_caller_restricted")
        );
        // SAFETY: the SID was allocated by ConvertStringSidToSidW.
        unsafe { LocalFree(sid as HLOCAL) };
    }
}
