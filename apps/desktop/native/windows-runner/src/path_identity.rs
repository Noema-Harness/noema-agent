//! Handle-backed path preflight for the Windows command policy.
//!
//! The NT path translation and `OBJ_DONT_REPARSE` open follow the design in
//! `openai/codex` `windows-sandbox-rs/src/no_reparse_dir.rs` at
//! `67f0994b532b8740f14b5b738af7b7b2a915b1d6` (source SHA-256
//! `F93737803AA6BCA3485E873F444CFAD4184D67F7F12A694D2A85967C8B0957DE`,
//! Apache-2.0; see the repository's pinned source snapshot and license).
//! This Noema adaptation only opens and pins existing policy objects. It does
//! not create ACLs, guard files, identities, or claim filesystem enforcement.

use crate::acl;
use crate::policy::{
    AclGrant, FileIdentity, FilesystemAccessMode, PathRoot, VerifiedAclGrantEvidence,
    WindowsCommandPolicy,
};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::mem::{size_of, size_of_val};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Component, Path, Prefix};
use std::ptr;
use std::slice;
use windows_sys::Win32::Foundation::{
    ERROR_NO_MORE_FILES, GetLastError, HANDLE, INVALID_HANDLE_VALUE, NTSTATUS,
    OBJ_CASE_INSENSITIVE, OBJ_DONT_REPARSE, UNICODE_STRING,
};
use windows_sys::Win32::Security::Cryptography::{
    BCRYPT_ALG_HANDLE, BCryptCloseAlgorithmProvider, BCryptHash, BCryptOpenAlgorithmProvider,
};
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO, FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES,
    FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE, FileIdBothDirectoryInfo,
    FileIdBothDirectoryRestartInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
    QueryDosDeviceW, READ_CONTROL, WRITE_DAC,
};
use windows_sys::Win32::System::IO::{IO_STATUS_BLOCK, IO_STATUS_BLOCK_0};

const FILE_OPEN: u32 = 1;
const FILE_DIRECTORY_FILE: u32 = 1;
const FILE_NON_DIRECTORY_FILE: u32 = 0x40;
const STATUS_REPARSE_POINT_ENCOUNTERED: NTSTATUS = 0xC000_050B_u32 as i32;
const MAX_WRITE_ROOT_SCAN_ENTRIES: usize = 1_000_000;
const MAX_WRITE_ROOT_SCAN_DEPTH: usize = 256;
const DIRECTORY_SCAN_BUFFER_BYTES: usize = 64 * 1024;

#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: HANDLE,
    object_name: *const UNICODE_STRING,
    attributes: u32,
    security_descriptor: *const c_void,
    security_quality_of_service: *const c_void,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtCreateFile(
        file_handle: *mut HANDLE,
        desired_access: u32,
        object_attributes: *const ObjectAttributes,
        io_status_block: *mut IO_STATUS_BLOCK,
        allocation_size: *const i64,
        file_attributes: u32,
        share_access: u32,
        create_disposition: u32,
        create_options: u32,
        ea_buffer: *const c_void,
        ea_length: u32,
    ) -> NTSTATUS;
}

/// Handles remain owned by the caller until it leaves the admission path.
/// The no-delete sharing mode pins each checked object against rename or
/// removal while the caller performs the next fail-closed gate.
struct VerifiedPolicyPath {
    handle: OwnedHandle,
    is_directory: bool,
    #[allow(dead_code)] // Used by the journal-backed ACL reconciliation method below.
    identity: (u32, u64),
}

pub struct VerifiedPolicyPaths {
    _handles_by_path: HashMap<String, VerifiedPolicyPath>,
}

fn validate_capability_grants(
    grants: &[AclGrant],
) -> Result<HashMap<String, (String, FilesystemAccessMode)>, &'static str> {
    if grants.is_empty() || grants.len() > 37 {
        return Err("acl_grants_mismatch");
    }
    let mut grants_by_path = HashMap::new();
    let mut capability_names = HashSet::new();
    let mut identities = HashSet::new();
    for grant in grants {
        let key = grant.path.to_lowercase();
        let expected_identity = parse_identity(&grant.file_identity)?;
        let expected_capability_prefix = match grant.access {
            FilesystemAccessMode::Read => "Noema.Read.",
            FilesystemAccessMode::Write => "Noema.Write.",
        };
        if !acl::is_valid_capability_name(&grant.capability_name)
            || !grant
                .capability_name
                .starts_with(expected_capability_prefix)
            || !capability_names.insert(grant.capability_name.clone())
            || !identities.insert(expected_identity)
            || grants_by_path
                .insert(key, (grant.capability_name.clone(), grant.access))
                .is_some()
        {
            return Err("acl_grants_invalid");
        }
    }
    Ok(grants_by_path)
}

pub fn verify_policy_paths(
    policy: &WindowsCommandPolicy,
) -> Result<VerifiedPolicyPaths, &'static str> {
    let mut handles_by_path = HashMap::new();
    let mut seen_paths = HashMap::new();
    let mut seen_identities = HashSet::new();
    let filesystem_path_keys = policy
        .filesystem
        .read_roots
        .iter()
        .map(|root| root.path.to_lowercase())
        .collect::<HashSet<_>>();
    let directory_path_keys = [
        policy.workspace_root.path.to_lowercase(),
        policy.working_directory.path.to_lowercase(),
    ]
    .into_iter()
    .collect::<HashSet<_>>();
    let mut paths = Vec::with_capacity(
        policy.filesystem.read_roots.len() + policy.filesystem.write_roots.len() + 2,
    );
    paths.push(&policy.workspace_root);
    paths.extend(policy.filesystem.read_roots.iter());
    paths.extend(policy.filesystem.write_roots.iter());
    paths.push(&policy.working_directory);

    for root in paths {
        let key = root.path.to_lowercase();
        let expected = parse_identity(&root.file_identity)?;
        if let Some(previous) = seen_paths.get(&key) {
            if previous != &expected {
                return Err("path_identity_mismatch");
            }
            continue;
        }
        let (initial_handle, actual, is_directory) =
            open_path_no_reparse(Path::new(&root.path), 0, FILE_READ_ATTRIBUTES)?;
        if actual != expected {
            return Err("path_identity_mismatch");
        }
        if directory_path_keys.contains(&key) && !is_directory {
            return Err("path_identity_unverified");
        }
        let handle = if filesystem_path_keys.contains(&key) && is_directory {
            let (enumerable_handle, enumerable_identity) =
                open_directory_no_reparse(Path::new(&root.path), true)?;
            if enumerable_identity != actual {
                return Err("path_identity_mismatch");
            }
            drop(initial_handle);
            enumerable_handle
        } else {
            initial_handle
        };
        if !seen_identities.insert(actual) {
            return Err("path_identity_alias");
        }
        seen_paths.insert(key.clone(), actual);
        handles_by_path.insert(
            key,
            VerifiedPolicyPath {
                handle,
                is_directory,
                identity: actual,
            },
        );
    }
    Ok(VerifiedPolicyPaths {
        _handles_by_path: handles_by_path,
    })
}

/// Open only the journaled writable grant roots for ACL recovery. This avoids
/// requiring unrelated runtime-read roots, cwd, network, or environment state
/// to replay a persisted ACL batch after process restart.
pub fn verify_filesystem_root_paths(
    grants: &[AclGrant],
) -> Result<VerifiedPolicyPaths, &'static str> {
    validate_capability_grants(grants)?;
    let mut handles_by_path = HashMap::new();
    let mut seen_identities = HashSet::new();
    for grant in grants {
        let key = grant.path.to_lowercase();
        let expected = parse_identity(&grant.file_identity)?;
        let (initial_handle, actual, is_directory) =
            open_path_no_reparse(Path::new(&grant.path), 0, FILE_READ_ATTRIBUTES)?;
        if actual != expected {
            return Err("path_identity_mismatch");
        }
        let handle = if is_directory {
            let (enumerable_handle, enumerable_identity) =
                open_directory_no_reparse(Path::new(&grant.path), true)?;
            if enumerable_identity != actual {
                return Err("path_identity_mismatch");
            }
            drop(initial_handle);
            enumerable_handle
        } else {
            initial_handle
        };
        if !seen_identities.insert(actual) {
            return Err("path_identity_alias");
        }
        handles_by_path.insert(
            key,
            VerifiedPolicyPath {
                handle,
                is_directory,
                identity: actual,
            },
        );
    }
    Ok(VerifiedPolicyPaths {
        _handles_by_path: handles_by_path,
    })
}

#[allow(dead_code)] // Used only after the main process persists the ACL grant journal.
fn open_acl_root(
    root: &crate::policy::PathRoot,
    is_directory: bool,
    reconcile: bool,
) -> Result<(OwnedHandle, (u32, u64), bool), &'static str> {
    let create_options = if is_directory {
        FILE_DIRECTORY_FILE
    } else {
        FILE_NON_DIRECTORY_FILE
    };
    let desired_access = FILE_READ_ATTRIBUTES
        | READ_CONTROL
        | if reconcile { WRITE_DAC } else { 0 }
        | if is_directory {
            FILE_LIST_DIRECTORY | FILE_TRAVERSE
        } else {
            0
        };
    open_path_no_reparse(Path::new(&root.path), create_options, desired_access)
}

#[allow(dead_code)] // Used only by journal-backed ACL reconciliation/recovery.
unsafe fn visit_acl_tree(
    handle: &OwnedHandle,
    is_directory: bool,
    capability_name: &str,
    access: FilesystemAccessMode,
    depth: usize,
    object_ids: &mut Vec<(u32, u64, u8)>,
    visited: &mut HashSet<(u32, u64)>,
    reconcile: bool,
) -> Result<(), &'static str> {
    if depth > MAX_WRITE_ROOT_SCAN_DEPTH || object_ids.len() >= MAX_WRITE_ROOT_SCAN_ENTRIES + 1 {
        return Err("filesystem_root_scan_limit");
    }
    let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
    // SAFETY: handle is owned and open; `info` is a writable output structure.
    if unsafe { GetFileInformationByHandle(handle.as_raw_handle() as HANDLE, &mut info) } == 0 {
        return Err("acl_object_query_failed");
    }
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("filesystem_root_reparse_point");
    }
    let actual_directory = info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    if actual_directory != is_directory {
        return Err("filesystem_root_scan_changed");
    }
    if !is_directory && (info.nNumberOfLinks == 0 || info.nNumberOfLinks > 1) {
        return Err(if info.nNumberOfLinks > 1 {
            "filesystem_root_hardlink_detected"
        } else {
            "acl_object_query_failed"
        });
    }
    let file_index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    let identity = (info.dwVolumeSerialNumber, file_index);
    if identity.0 == 0 || identity.1 == 0 || !visited.insert(identity) {
        return Err("path_identity_alias");
    }
    object_ids.push((identity.0, identity.1, u8::from(is_directory)));

    // SAFETY: this walk opens each object without reparse traversal and has
    // requested READ_CONTROL | WRITE_DAC for this exact handle.
    if reconcile {
        // SAFETY: caller holds a verified handle opened with WRITE_DAC.
        unsafe {
            acl::apply_capability_allow_ace(
                handle.as_raw_handle() as *mut c_void,
                capability_name,
                access,
                is_directory,
            )?;
        }
    } else {
        // SAFETY: caller holds a verified handle opened with READ_CONTROL.
        unsafe {
            acl::verify_capability_allow_ace(
                handle.as_raw_handle() as *mut c_void,
                capability_name,
                access,
                is_directory,
            )?;
        }
    }
    if is_directory {
        unsafe {
            visit_acl_directory_children(
                handle,
                capability_name,
                access,
                depth,
                object_ids,
                visited,
                reconcile,
            )?;
        }
    }
    Ok(())
}

#[allow(dead_code)] // Used only by journal-backed ACL reconciliation/recovery.
unsafe fn visit_acl_directory_children(
    directory: &OwnedHandle,
    capability_name: &str,
    access: FilesystemAccessMode,
    depth: usize,
    object_ids: &mut Vec<(u32, u64, u8)>,
    visited: &mut HashSet<(u32, u64)>,
    reconcile: bool,
) -> Result<(), &'static str> {
    let mut buffer = vec![0_u64; DIRECTORY_SCAN_BUFFER_BYTES / size_of::<u64>()];
    let buffer_ptr = buffer.as_mut_ptr().cast::<u8>();
    let mut restart = true;
    loop {
        let info_class = if restart {
            FileIdBothDirectoryRestartInfo
        } else {
            FileIdBothDirectoryInfo
        };
        // SAFETY: buffer alignment/capacity and handle access match the API;
        // the handle remains live throughout this recursive walk.
        let listed = unsafe {
            GetFileInformationByHandleEx(
                directory.as_raw_handle() as HANDLE,
                info_class,
                buffer_ptr.cast(),
                DIRECTORY_SCAN_BUFFER_BYTES as u32,
            )
        };
        if listed == 0 {
            // SAFETY: reads the error for the immediately preceding API call.
            if unsafe { GetLastError() } == ERROR_NO_MORE_FILES {
                return Ok(());
            }
            return Err("acl_directory_enumeration_failed");
        }
        restart = false;
        let mut offset = 0_usize;
        loop {
            if offset + size_of::<FILE_ID_BOTH_DIR_INFO>() > DIRECTORY_SCAN_BUFFER_BYTES {
                return Err("acl_directory_enumeration_failed");
            }
            // SAFETY: offset is bounds-checked and aligned by validated offsets.
            let entry = unsafe { &*buffer_ptr.add(offset).cast::<FILE_ID_BOTH_DIR_INFO>() };
            let filename_bytes = entry.FileNameLength as usize;
            let filename_offset = std::mem::offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
            let entry_minimum = filename_offset
                .checked_add(filename_bytes)
                .ok_or("acl_directory_enumeration_failed")?;
            if filename_bytes == 0
                || filename_bytes % size_of::<u16>() != 0
                || offset + entry_minimum > DIRECTORY_SCAN_BUFFER_BYTES
            {
                return Err("acl_directory_enumeration_failed");
            }
            // SAFETY: filename region bounds and UTF-16 alignment were checked.
            let filename = unsafe {
                slice::from_raw_parts(
                    buffer_ptr.add(offset + filename_offset).cast::<u16>(),
                    filename_bytes / size_of::<u16>(),
                )
            };
            if filename != [b'.' as u16] && filename != [b'.' as u16, b'.' as u16] {
                if entry.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return Err("filesystem_root_reparse_point");
                }
                let is_directory = entry.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
                let child = open_child_for_acl(directory, filename, is_directory, reconcile)?;
                let mut child_info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
                // SAFETY: child is an owned live file-system handle.
                if unsafe {
                    GetFileInformationByHandle(child.as_raw_handle() as HANDLE, &mut child_info)
                } == 0
                {
                    return Err("acl_object_query_failed");
                }
                if ((child_info.nFileIndexLow as u64) | ((child_info.nFileIndexHigh as u64) << 32))
                    != entry.FileId as u64
                {
                    return Err("filesystem_root_scan_changed");
                }
                unsafe {
                    visit_acl_tree(
                        &child,
                        is_directory,
                        capability_name,
                        access,
                        depth + 1,
                        object_ids,
                        visited,
                        reconcile,
                    )?;
                }
            }
            let next_offset = entry.NextEntryOffset as usize;
            if next_offset == 0 {
                break;
            }
            if next_offset < entry_minimum
                || next_offset % size_of::<u64>() != 0
                || offset + next_offset > DIRECTORY_SCAN_BUFFER_BYTES
            {
                return Err("acl_directory_enumeration_failed");
            }
            offset += next_offset;
        }
    }
}

#[allow(dead_code)] // Used only by journal-backed ACL reconciliation.
fn open_child_for_acl(
    parent: &OwnedHandle,
    name: &[u16],
    is_directory: bool,
    reconcile: bool,
) -> Result<OwnedHandle, &'static str> {
    let mut name = name.to_vec();
    let name_length =
        u16::try_from(name.len() * size_of::<u16>()).map_err(|_| "acl_child_open_failed")?;
    let object_name = UNICODE_STRING {
        Length: name_length,
        MaximumLength: name_length,
        Buffer: name.as_mut_ptr(),
    };
    let object_attributes = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root_directory: parent.as_raw_handle() as HANDLE,
        object_name: &object_name,
        attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        security_descriptor: ptr::null(),
        security_quality_of_service: ptr::null(),
    };
    let mut io_status_block = IO_STATUS_BLOCK {
        Anonymous: IO_STATUS_BLOCK_0 { Status: 0 },
        Information: 0,
    };
    let mut handle = ptr::null_mut();
    let desired_access = FILE_READ_ATTRIBUTES
        | READ_CONTROL
        | if reconcile { WRITE_DAC } else { 0 }
        | if is_directory {
            FILE_LIST_DIRECTORY | FILE_TRAVERSE
        } else {
            0
        };
    // SAFETY: all FFI inputs remain live and the child name is a single
    // component opened relative to a verified parent with reparse blocked.
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            desired_access,
            &object_attributes,
            &mut io_status_block,
            ptr::null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_OPEN,
            if is_directory {
                FILE_DIRECTORY_FILE
            } else {
                FILE_NON_DIRECTORY_FILE
            },
            ptr::null(),
            0,
        )
    };
    if status < 0 {
        return Err(if status == STATUS_REPARSE_POINT_ENCOUNTERED {
            "filesystem_root_reparse_point"
        } else {
            "acl_child_open_failed"
        });
    }
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err("acl_child_open_failed");
    }
    // SAFETY: NtCreateFile succeeded and returned a unique owned file handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

#[allow(dead_code)] // Called after the full journal-backed ACL walk.
fn object_identity_digest(object_ids: &mut [(u32, u64, u8)]) -> Result<String, &'static str> {
    if object_ids.is_empty() || object_ids.len() > MAX_WRITE_ROOT_SCAN_ENTRIES + 1 {
        return Err("filesystem_root_scan_limit");
    }
    object_ids.sort_unstable();
    let byte_capacity = object_ids
        .len()
        .checked_mul(13)
        .ok_or("filesystem_root_scan_limit")?;
    let input_size = u32::try_from(byte_capacity).map_err(|_| "filesystem_root_scan_limit")?;
    let mut bytes = Vec::with_capacity(byte_capacity);
    for (volume, file_index, kind) in object_ids.iter() {
        bytes.extend_from_slice(&volume.to_le_bytes());
        bytes.extend_from_slice(&file_index.to_le_bytes());
        bytes.push(*kind);
    }
    let algorithm_name = [
        b'S' as u16,
        b'H' as u16,
        b'A' as u16,
        b'2' as u16,
        b'5' as u16,
        b'6' as u16,
        0,
    ];
    let mut algorithm: BCRYPT_ALG_HANDLE = ptr::null_mut();
    // SAFETY: algorithm_name is NUL-terminated; algorithm is a writable output.
    let open_status = unsafe {
        BCryptOpenAlgorithmProvider(&mut algorithm, algorithm_name.as_ptr(), ptr::null(), 0)
    };
    if open_status < 0 || algorithm.is_null() {
        return Err("acl_tree_digest_unavailable");
    }
    let mut digest = [0_u8; 32];
    // SAFETY: algorithm is a live CNG SHA-256 provider; input and output buffers
    // remain valid for the synchronous call.
    let hash_status = unsafe {
        BCryptHash(
            algorithm,
            ptr::null(),
            0,
            bytes.as_ptr(),
            input_size,
            digest.as_mut_ptr(),
            digest.len() as u32,
        )
    };
    // SAFETY: algorithm was opened above and is closed regardless of hash result.
    let close_status = unsafe { BCryptCloseAlgorithmProvider(algorithm, 0) };
    if hash_status < 0 || close_status < 0 {
        return Err("acl_tree_digest_unavailable");
    }
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut hex, "{byte:02x}").map_err(|_| "acl_tree_digest_unavailable")?;
    }
    Ok(hex)
}

impl VerifiedPolicyPaths {
    /// Every filesystem root receives a capability ACL, so inspect every
    /// read root (including write roots) immediately before ACL changes.
    pub fn scan_filesystem_roots(&self, policy: &WindowsCommandPolicy) -> Result<(), &'static str> {
        for root in &policy.filesystem.read_roots {
            let key = root.path.to_lowercase();
            let root = self
                ._handles_by_path
                .get(&key)
                .ok_or("filesystem_root_identity_unavailable")?;
            scan_write_root(&root.handle, root.is_directory)?;
        }
        Ok(())
    }

    /// Reconcile each write-root DACL from the same no-reparse object identity
    /// pinned during admission. For each root, perform hard-link scan directly
    /// before reopening the exact object for ACL access, then walk and verify
    /// every current object before moving to the next grant. The caller must
    /// persist its ACL journal before calling this method and must not create a
    /// child until the returned evidence has been durably committed.
    ///
    /// This function changes real filesystem ACLs. It is intentionally not
    /// called from the current fail-closed `execute` scaffold or from tests.
    #[allow(dead_code)] // Must stay unreachable until main persists the ACL journal.
    pub unsafe fn reconcile_filesystem_root_acls(
        &self,
        grants: &[AclGrant],
    ) -> Result<Vec<VerifiedAclGrantEvidence>, &'static str> {
        // SAFETY: this method is the only path that may mutate ACLs, and its
        // caller must persist the exact grants before reaching this boundary.
        unsafe { self.walk_filesystem_root_acls(grants, true) }
    }

    /// Read-only verification for a journal recovery pass. It scans and opens
    /// the same verified objects but requests no WRITE_DAC access and changes
    /// no ACL. The returned evidence has the exact journal schema used after a
    /// successful reconciliation.
    #[allow(dead_code)] // Used only by the journal-backed recovery integration.
    pub unsafe fn verify_filesystem_root_acls(
        &self,
        grants: &[AclGrant],
    ) -> Result<Vec<VerifiedAclGrantEvidence>, &'static str> {
        // SAFETY: this branch only queries DACLs and object identities.
        unsafe { self.walk_filesystem_root_acls(grants, false) }
    }

    #[allow(dead_code)] // Called only after a durable journal transition.
    unsafe fn walk_filesystem_root_acls(
        &self,
        grants: &[AclGrant],
        reconcile: bool,
    ) -> Result<Vec<VerifiedAclGrantEvidence>, &'static str> {
        validate_capability_grants(grants)?;

        let mut evidence = Vec::with_capacity(grants.len());
        for grant in grants {
            let key = grant.path.to_lowercase();
            let pinned = self
                ._handles_by_path
                .get(&key)
                .ok_or("filesystem_root_identity_unavailable")?;
            let expected = parse_identity(&grant.file_identity)?;
            if expected != pinned.identity || grant.is_directory != pinned.is_directory {
                return Err("path_identity_mismatch");
            }
            let capability_name = grant.capability_name.clone();

            // Scan the complete root immediately before ACL access for this
            // root. A failed later root leaves earlier changes journaled; the
            // main process must retain repair_required and deny spawn.
            scan_write_root(&pinned.handle, pinned.is_directory)?;
            let (acl_root, actual, is_directory) = open_acl_root(
                &PathRoot {
                    path: grant.path.clone(),
                    file_identity: grant.file_identity.clone(),
                },
                pinned.is_directory,
                reconcile,
            )?;
            if actual != expected
                || actual != pinned.identity
                || is_directory != pinned.is_directory
            {
                return Err("path_identity_mismatch");
            }

            let mut object_ids = Vec::new();
            let mut visited = HashSet::new();
            unsafe {
                visit_acl_tree(
                    &acl_root,
                    is_directory,
                    &capability_name,
                    grant.access,
                    0,
                    &mut object_ids,
                    &mut visited,
                    reconcile,
                )?;
            }
            if object_ids.is_empty() || object_ids.len() > MAX_WRITE_ROOT_SCAN_ENTRIES + 1 {
                return Err("filesystem_root_scan_limit");
            }
            let object_count =
                u32::try_from(object_ids.len()).map_err(|_| "filesystem_root_scan_limit")?;
            let tree_digest = object_identity_digest(&mut object_ids)?;
            evidence.push(VerifiedAclGrantEvidence {
                volume_serial_number: actual.0.to_string(),
                file_index: actual.1.to_string(),
                capability_name,
                access: grant.access,
                object_count,
                acl_verified_count: object_count,
                tree_digest,
                inheritance_verified: is_directory,
            });
        }
        Ok(evidence)
    }
}

#[cfg(test)]
pub fn file_identity_for_directory(path: &Path) -> Result<FileIdentity, &'static str> {
    open_directory_no_reparse(path, false).map(|(_handle, identity)| serialize_identity(identity))
}

#[cfg(test)]
pub fn file_identity_for_path(path: &Path) -> Result<FileIdentity, &'static str> {
    open_path_no_reparse(path, 0, FILE_READ_ATTRIBUTES)
        .map(|(_handle, identity, _is_directory)| serialize_identity(identity))
}

fn open_directory_no_reparse(
    path: &Path,
    enumerate_children: bool,
) -> Result<(OwnedHandle, (u32, u64)), &'static str> {
    let (handle, identity, is_directory) = open_path_no_reparse(
        path,
        FILE_DIRECTORY_FILE,
        FILE_READ_ATTRIBUTES
            | FILE_TRAVERSE
            | if enumerate_children {
                FILE_LIST_DIRECTORY
            } else {
                0
            },
    )?;
    if !is_directory {
        return Err("path_identity_unverified");
    }
    Ok((handle, identity))
}

fn open_path_no_reparse(
    path: &Path,
    create_options: u32,
    desired_access: u32,
) -> Result<(OwnedHandle, (u32, u64), bool), &'static str> {
    let mut nt_path = local_path_nt_path(path)?;
    let name_length = u16::try_from((nt_path.len() - 1) * size_of::<u16>())
        .map_err(|_| "path_identity_unavailable")?;
    let maximum_length =
        u16::try_from(size_of_val(nt_path.as_slice())).map_err(|_| "path_identity_unavailable")?;
    let object_name = UNICODE_STRING {
        Length: name_length,
        MaximumLength: maximum_length,
        Buffer: nt_path.as_mut_ptr(),
    };
    let object_attributes = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root_directory: ptr::null_mut(),
        object_name: &object_name,
        attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        security_descriptor: ptr::null(),
        security_quality_of_service: ptr::null(),
    };
    let mut io_status_block = IO_STATUS_BLOCK {
        Anonymous: IO_STATUS_BLOCK_0 { Status: 0 },
        Information: 0,
    };
    let mut handle = ptr::null_mut();
    // SAFETY: the UTF-16 buffer and object/IO structures stay live for the call;
    // the FFI pointers follow the documented NtCreateFile ABI and output to locals.
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            desired_access,
            &object_attributes,
            &mut io_status_block,
            ptr::null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_OPEN,
            create_options,
            ptr::null(),
            0,
        )
    };
    if status < 0 {
        return Err(if status == STATUS_REPARSE_POINT_ENCOUNTERED {
            "path_reparse_point"
        } else {
            "path_identity_unavailable"
        });
    }
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err("path_identity_unavailable");
    }
    // SAFETY: NtCreateFile succeeded and returned a unique owned handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
    let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
    // SAFETY: `handle` is a valid file handle and `info` is a writable output structure.
    if unsafe { GetFileInformationByHandle(handle.as_raw_handle() as HANDLE, &mut info) } == 0 {
        return Err("path_identity_unavailable");
    }
    let file_index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    if info.dwVolumeSerialNumber == 0 || file_index == 0 {
        return Err("path_identity_unavailable");
    }
    Ok((
        handle,
        (info.dwVolumeSerialNumber, file_index),
        info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
    ))
}

fn scan_write_root(root: &OwnedHandle, is_directory: bool) -> Result<(), &'static str> {
    if !is_directory {
        let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
        // SAFETY: `root` is an open verified file handle and `info` is writable.
        if unsafe { GetFileInformationByHandle(root.as_raw_handle() as HANDLE, &mut info) } == 0 {
            return Err("filesystem_root_scan_unavailable");
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("filesystem_root_reparse_point");
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
            return Err("filesystem_root_scan_changed");
        }
        if info.nNumberOfLinks == 0 {
            return Err("filesystem_root_scan_unavailable");
        }
        if info.nNumberOfLinks > 1 {
            return Err("filesystem_root_hardlink_detected");
        }
        return Ok(());
    }
    let mut total_entries = 0_usize;
    scan_directory(root, 0, &mut total_entries)
}

fn scan_directory(
    directory: &OwnedHandle,
    depth: usize,
    total_entries: &mut usize,
) -> Result<(), &'static str> {
    if depth > MAX_WRITE_ROOT_SCAN_DEPTH {
        return Err("filesystem_root_scan_limit");
    }
    let mut buffer = vec![0_u64; DIRECTORY_SCAN_BUFFER_BYTES / size_of::<u64>()];
    let buffer_ptr = buffer.as_mut_ptr().cast::<u8>();
    let mut restart = true;

    loop {
        let info_class = if restart {
            FileIdBothDirectoryRestartInfo
        } else {
            FileIdBothDirectoryInfo
        };
        // SAFETY: the buffer is DWORDLONG-aligned, initialized, writable, and its
        // byte length matches the size passed to the Windows API. The opened
        // handle refers to a directory and requests FILE_LIST_DIRECTORY access.
        let listed = unsafe {
            GetFileInformationByHandleEx(
                directory.as_raw_handle() as HANDLE,
                info_class,
                buffer_ptr.cast(),
                DIRECTORY_SCAN_BUFFER_BYTES as u32,
            )
        };
        if listed == 0 {
            // SAFETY: GetLastError reads the error for the immediately preceding
            // failed Win32 call on this thread.
            if unsafe { GetLastError() } == ERROR_NO_MORE_FILES {
                return Ok(());
            }
            return Err("filesystem_root_scan_unavailable");
        }
        restart = false;

        let mut offset = 0_usize;
        loop {
            if offset + size_of::<FILE_ID_BOTH_DIR_INFO>() > DIRECTORY_SCAN_BUFFER_BYTES {
                return Err("filesystem_root_scan_unavailable");
            }
            // SAFETY: offset is bounds-checked and aligned because every next
            // entry offset is validated to be a multiple of eight below.
            let entry = unsafe { &*buffer_ptr.add(offset).cast::<FILE_ID_BOTH_DIR_INFO>() };
            let filename_bytes = entry.FileNameLength as usize;
            let filename_offset = std::mem::offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
            let entry_minimum = filename_offset
                .checked_add(filename_bytes)
                .ok_or("filesystem_root_scan_unavailable")?;
            if filename_bytes == 0
                || filename_bytes % size_of::<u16>() != 0
                || offset + entry_minimum > DIRECTORY_SCAN_BUFFER_BYTES
            {
                return Err("filesystem_root_scan_unavailable");
            }
            // SAFETY: the variable-size filename region is in the returned
            // buffer according to its byte length and is UTF-16 aligned.
            let filename = unsafe {
                slice::from_raw_parts(
                    buffer_ptr.add(offset + filename_offset).cast::<u16>(),
                    filename_bytes / size_of::<u16>(),
                )
            };
            if filename != [b'.' as u16] && filename != [b'.' as u16, b'.' as u16] {
                *total_entries = total_entries
                    .checked_add(1)
                    .ok_or("filesystem_root_scan_limit")?;
                if *total_entries > MAX_WRITE_ROOT_SCAN_ENTRIES {
                    return Err("filesystem_root_scan_limit");
                }
                if entry.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return Err("filesystem_root_reparse_point");
                }
                let is_directory = entry.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
                let child = open_child_no_reparse(directory, filename, is_directory)?;
                let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
                // SAFETY: the child handle is valid and `info` is writable.
                if unsafe { GetFileInformationByHandle(child.as_raw_handle() as HANDLE, &mut info) }
                    == 0
                {
                    return Err("filesystem_root_scan_unavailable");
                }
                if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return Err("filesystem_root_reparse_point");
                }
                if (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != is_directory {
                    return Err("filesystem_root_scan_changed");
                }
                if !is_directory {
                    if info.nNumberOfLinks == 0 {
                        return Err("filesystem_root_scan_unavailable");
                    }
                    if info.nNumberOfLinks > 1 {
                        return Err("filesystem_root_hardlink_detected");
                    }
                } else {
                    scan_directory(&child, depth + 1, total_entries)?;
                }
            }

            let next_offset = entry.NextEntryOffset as usize;
            if next_offset == 0 {
                break;
            }
            if next_offset < entry_minimum
                || next_offset % size_of::<u64>() != 0
                || offset + next_offset > DIRECTORY_SCAN_BUFFER_BYTES
            {
                return Err("filesystem_root_scan_unavailable");
            }
            offset += next_offset;
        }
    }
}

fn open_child_no_reparse(
    parent: &OwnedHandle,
    name: &[u16],
    is_directory: bool,
) -> Result<OwnedHandle, &'static str> {
    let mut name = name.to_vec();
    let name_length = u16::try_from(name.len() * size_of::<u16>())
        .map_err(|_| "filesystem_root_scan_unavailable")?;
    let object_name = UNICODE_STRING {
        Length: name_length,
        MaximumLength: name_length,
        Buffer: name.as_mut_ptr(),
    };
    let object_attributes = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root_directory: parent.as_raw_handle() as HANDLE,
        object_name: &object_name,
        attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        security_descriptor: ptr::null(),
        security_quality_of_service: ptr::null(),
    };
    let mut io_status_block = IO_STATUS_BLOCK {
        Anonymous: IO_STATUS_BLOCK_0 { Status: 0 },
        Information: 0,
    };
    let mut handle = ptr::null_mut();
    // SAFETY: all FFI inputs remain live for the call; the child name is a
    // single UTF-16 component relative to a verified parent directory handle.
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            FILE_READ_ATTRIBUTES
                | if is_directory {
                    FILE_LIST_DIRECTORY | FILE_TRAVERSE
                } else {
                    0
                },
            &object_attributes,
            &mut io_status_block,
            ptr::null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_OPEN,
            if is_directory {
                FILE_DIRECTORY_FILE
            } else {
                FILE_NON_DIRECTORY_FILE
            },
            ptr::null(),
            0,
        )
    };
    if status < 0 {
        return Err(if status == STATUS_REPARSE_POINT_ENCOUNTERED {
            "filesystem_root_reparse_point"
        } else {
            "filesystem_root_scan_unavailable"
        });
    }
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err("filesystem_root_scan_unavailable");
    }
    // SAFETY: NtCreateFile succeeded and returned a unique owned handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn parse_identity(identity: &FileIdentity) -> Result<(u32, u64), &'static str> {
    let volume = identity
        .volume_serial_number
        .parse::<u32>()
        .map_err(|_| "path_identity_unverified")?;
    let file_index = identity
        .file_index
        .parse::<u64>()
        .map_err(|_| "path_identity_unverified")?;
    if volume == 0 || file_index == 0 {
        return Err("path_identity_unverified");
    }
    Ok((volume, file_index))
}

#[cfg(test)]
fn serialize_identity((volume, file_index): (u32, u64)) -> FileIdentity {
    FileIdentity {
        volume_serial_number: volume.to_string(),
        file_index: file_index.to_string(),
    }
}

fn local_path_nt_path(path: &Path) -> Result<Vec<u16>, &'static str> {
    validate_local_policy_path(path)?;
    let source: Vec<u16> = path.as_os_str().encode_wide().collect();
    let source_offset = if matches!(
        path.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::VerbatimDisk(_))
    ) {
        4
    } else {
        0
    };
    let drive = [source[source_offset], b':' as u16, 0];
    let mut target = vec![0_u16; 32_768];
    // SAFETY: `drive` is a NUL-terminated drive designator and `target` is a
    // writable buffer whose capacity is passed to QueryDosDeviceW.
    let length =
        unsafe { QueryDosDeviceW(drive.as_ptr(), target.as_mut_ptr(), target.len() as u32) };
    if length == 0 {
        return Err("path_identity_unavailable");
    }
    let terminator = target
        .iter()
        .position(|unit| *unit == 0)
        .ok_or("path_identity_unavailable")?;
    target.truncate(terminator);
    if !is_disk_volume(&target) {
        return Err("path_identity_unavailable");
    }
    for unit in source.into_iter().skip(source_offset + 2) {
        target.push(if unit == b'/' as u16 {
            b'\\' as u16
        } else {
            unit
        });
    }
    target.push(0);
    Ok(target)
}

fn validate_local_policy_path(path: &Path) -> Result<(), &'static str> {
    if !path.is_absolute() {
        return Err("path_identity_unverified");
    }
    let mut components = path.components();
    match components.next() {
        Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) => {}
        _ => return Err("path_identity_unverified"),
    }
    for component in components {
        match component {
            Component::RootDir => {}
            Component::Normal(name) if !name.to_string_lossy().contains(':') => {}
            Component::Normal(_)
            | Component::ParentDir
            | Component::CurDir
            | Component::Prefix(_) => {
                return Err("path_identity_unverified");
            }
        }
    }
    Ok(())
}

fn is_disk_volume(target: &[u16]) -> bool {
    let prefix = br"\Device\HarddiskVolume";
    target.len() > prefix.len()
        && target.iter().zip(prefix).all(|(&unit, expected)| {
            u8::try_from(unit).is_ok_and(|unit| unit.eq_ignore_ascii_case(expected))
        })
        && target[prefix.len()..]
            .iter()
            .all(|unit| (u16::from(b'0')..=u16::from(b'9')).contains(unit))
}

#[cfg(test)]
mod tests {
    use super::{
        is_disk_volume, local_path_nt_path, object_identity_digest, open_directory_no_reparse,
        open_path_no_reparse, scan_write_root, validate_capability_grants,
    };
    use crate::policy::{AclGrant, FileIdentity, FilesystemAccessMode, PathRoot};
    use std::collections::HashSet;
    use std::fs;
    use std::process::Command;

    #[test]
    fn acl_grant_batch_must_exactly_bind_unique_sids_to_policy_write_roots() {
        let roots = vec![
            PathRoot {
                path: r"C:\work\repo".to_string(),
                file_identity: FileIdentity {
                    volume_serial_number: "55".to_string(),
                    file_index: "101".to_string(),
                },
            },
            PathRoot {
                path: r"D:\shared\notes.txt".to_string(),
                file_identity: FileIdentity {
                    volume_serial_number: "77".to_string(),
                    file_index: "202".to_string(),
                },
            },
        ];
        let grants = vec![
            AclGrant {
                path: r"D:\shared\notes.txt".to_string(),
                file_identity: roots[1].file_identity.clone(),
                capability_name:
                    "Noema.Read.2222222222222222222222222222222222222222222222222222222222222222"
                        .to_string(),
                access: FilesystemAccessMode::Read,
                is_directory: false,
            },
            AclGrant {
                path: r"C:\work\repo".to_string(),
                file_identity: roots[0].file_identity.clone(),
                capability_name:
                    "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                        .to_string(),
                access: FilesystemAccessMode::Write,
                is_directory: true,
            },
        ];
        let mapped = validate_capability_grants(&grants).expect("unique grants accepted");
        assert_eq!(mapped.len(), 2);
        assert_eq!(
            mapped.get(&r"c:\work\repo".to_string()),
            Some(&(
                "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                    .to_string(),
                FilesystemAccessMode::Write
            ))
        );

        let mut duplicate_sid = grants.clone();
        duplicate_sid[1].capability_name = duplicate_sid[0].capability_name.clone();
        assert_eq!(
            validate_capability_grants(&duplicate_sid).err(),
            Some("acl_grants_invalid")
        );
        let mut duplicate_identity = grants.clone();
        duplicate_identity[1].file_identity = duplicate_identity[0].file_identity.clone();
        assert_eq!(
            validate_capability_grants(&duplicate_identity).err(),
            Some("acl_grants_invalid")
        );
        assert_eq!(validate_capability_grants(&grants[..1]).unwrap().len(), 1);
    }

    #[test]
    fn tree_digest_is_sha256_deterministic_and_identity_sensitive() {
        let original = vec![(55, 101, 1), (55, 102, 0), (77, 202, 0)];
        let mut reordered = vec![(77, 202, 0), (55, 102, 0), (55, 101, 1)];
        let mut original = original;
        let digest = object_identity_digest(&mut original).expect("CNG SHA-256 available");
        assert_eq!(digest.len(), 64);
        assert!(
            digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        );
        assert_eq!(object_identity_digest(&mut reordered).unwrap(), digest);
        reordered[0].1 += 1;
        assert_ne!(object_identity_digest(&mut reordered).unwrap(), digest);
        let unique = original
            .iter()
            .map(|identity| (identity.0, identity.1))
            .collect::<HashSet<_>>();
        assert_eq!(unique.len(), original.len());
    }

    #[test]
    fn disk_mapping_rejects_non_volume_devices_and_subpaths() {
        for accepted in [
            r"\Device\HarddiskVolume0",
            r"\Device\HarddiskVolume1",
            r"\device\harddiskvolume123",
        ] {
            assert!(is_disk_volume(&accepted.encode_utf16().collect::<Vec<_>>()));
        }
        for rejected in [
            r"\Device\NamedPipe",
            r"\Device\HarddiskVolume",
            r"\Device\HarddiskVolume1\directory",
            r"\Device\HarddiskVolume1suffix",
            r"\Device\HarddiskVolumeShadowCopy1",
            r"\??\C:\directory",
        ] {
            assert!(!is_disk_volume(
                &rejected.encode_utf16().collect::<Vec<_>>()
            ));
        }
    }

    #[test]
    fn nt_path_translation_resolves_only_the_drive_alias() {
        let path = std::env::temp_dir();
        let translated = local_path_nt_path(&path).expect("local temp path maps to disk");
        let translated = String::from_utf16(&translated[..translated.len() - 1]).unwrap();
        assert!(translated.starts_with(r"\Device\HarddiskVolume"));
    }

    #[test]
    fn missing_directory_is_not_created_by_preflight() {
        let parent = std::env::temp_dir().join(format!(
            "noema-missing-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ));
        fs::create_dir(&parent).expect("create test parent");
        let missing = parent.join("not-created");
        assert_eq!(
            open_directory_no_reparse(&missing, false).err(),
            Some("path_identity_unavailable")
        );
        assert!(!missing.exists());
        fs::remove_dir_all(parent).expect("remove isolated test parent");
    }

    #[test]
    fn write_root_scan_accepts_regular_files_without_external_links() {
        let root = std::env::temp_dir().join(format!(
            "noema-write-root-scan-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ));
        fs::create_dir(&root).expect("create scan root");
        fs::create_dir(root.join("nested")).expect("create nested directory");
        fs::write(root.join("nested").join("source.txt"), b"content")
            .expect("create single-link file");
        let (handle, _) = open_directory_no_reparse(&root, true).expect("open scan root");
        assert_eq!(scan_write_root(&handle, true), Ok(()));
        drop(handle);
        fs::remove_dir_all(root).expect("remove scan root");
    }

    #[test]
    fn write_root_scan_rejects_any_file_with_multiple_links() {
        let root = std::env::temp_dir().join(format!(
            "noema-write-root-hardlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ));
        fs::create_dir(&root).expect("create scan root");
        let source = root.join("source.txt");
        fs::write(&source, b"content").expect("create source file");
        fs::hard_link(&source, root.join("alias.txt")).expect("create hard link");
        let (handle, _) = open_directory_no_reparse(&root, true).expect("open scan root");
        assert_eq!(
            scan_write_root(&handle, true),
            Err("filesystem_root_hardlink_detected")
        );
        drop(handle);
        fs::remove_dir_all(root).expect("remove scan root");
    }

    #[test]
    fn write_root_scan_rejects_nested_junctions() {
        let parent = std::env::temp_dir().join(format!(
            "noema-write-root-reparse-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ));
        let root = parent.join("workspace");
        let target = parent.join("outside");
        fs::create_dir_all(&root).expect("create scan root");
        fs::create_dir(&target).expect("create junction target");
        let alias = root.join("outside-alias");
        let output = Command::new("cmd.exe")
            .args(["/c", "mklink", "/J"])
            .arg(&alias)
            .arg(&target)
            .output()
            .expect("mklink starts");
        assert!(output.status.success(), "mklink /J creates test junction");
        let (handle, _) = open_directory_no_reparse(&root, true).expect("open scan root");
        assert_eq!(
            scan_write_root(&handle, true),
            Err("filesystem_root_reparse_point")
        );
        drop(handle);
        fs::remove_dir(&alias).expect("remove test junction");
        fs::remove_dir_all(parent).expect("remove junction fixture");
    }

    #[test]
    fn file_write_root_checks_link_count_without_enumerating_parent() {
        let root = std::env::temp_dir().join(format!(
            "noema-write-file-root-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ));
        fs::create_dir(&root).expect("create fixture parent");
        let file = root.join("granted.txt");
        fs::write(&file, b"content").expect("create single-link file");
        let (handle, _, is_directory) = open_path_no_reparse(&file, 0, super::FILE_READ_ATTRIBUTES)
            .expect("open verified file root");
        assert!(!is_directory);
        assert_eq!(scan_write_root(&handle, false), Ok(()));
        drop(handle);
        fs::remove_dir_all(root).expect("remove single-file fixture");
    }

    #[test]
    fn file_write_root_rejects_external_hard_link() {
        let root = std::env::temp_dir().join(format!(
            "noema-write-file-hardlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ));
        fs::create_dir(&root).expect("create fixture parent");
        let file = root.join("granted.txt");
        fs::write(&file, b"content").expect("create source file");
        fs::hard_link(&file, root.join("outside-alias.txt")).expect("create hard link");
        let (handle, _, is_directory) = open_path_no_reparse(&file, 0, super::FILE_READ_ATTRIBUTES)
            .expect("open verified file root");
        assert!(!is_directory);
        assert_eq!(
            scan_write_root(&handle, false),
            Err("filesystem_root_hardlink_detected")
        );
        drop(handle);
        fs::remove_dir_all(root).expect("remove hard-link fixture");
    }

    #[test]
    fn no_reparse_open_rejects_final_and_ancestor_junctions() {
        let root = std::env::temp_dir().join(format!("noema-path-identity-{}", std::process::id()));
        let target = root.join("target");
        let alias = root.join("alias");
        fs::create_dir_all(&target).expect("test target directory");
        let output = Command::new("cmd.exe")
            .args(["/c", "mklink", "/J"])
            .arg(&alias)
            .arg(&target)
            .output()
            .expect("mklink starts");
        assert!(output.status.success(), "mklink /J creates test junction");
        assert!(open_directory_no_reparse(&alias, false).is_err());
        assert!(open_directory_no_reparse(&alias.join("child"), false).is_err());
        fs::remove_dir(&alias).expect("remove test junction");
        fs::remove_dir_all(&root).expect("remove isolated test tree");
    }
}
