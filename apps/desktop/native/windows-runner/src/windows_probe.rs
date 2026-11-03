use crate::protocol::PlatformInfo;
use std::ffi::c_void;
use std::mem::size_of;
use windows_sys::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RegGetValueW};

#[repr(C)]
struct OsVersionInfoW {
    size: u32,
    major: u32,
    minor: u32,
    build: u32,
    platform_id: u32,
    service_pack: [u16; 128],
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn RtlGetVersion(info: *mut OsVersionInfoW) -> i32;
}

pub fn read_platform() -> Result<PlatformInfo, &'static str> {
    let mut version = OsVersionInfoW {
        size: size_of::<OsVersionInfoW>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform_id: 0,
        service_pack: [0; 128],
    };
    // SAFETY: `version` is initialized with the size required by RtlGetVersion.
    let status = unsafe { RtlGetVersion(&mut version) };
    if status != 0 {
        return Err("windows_version_unavailable");
    }

    // UBR is diagnostic only. Windows release/build and architecture determine
    // compatibility; an unavailable UBR registry value must not suppress them.
    let ubr = diagnostic_ubr(read_ubr);
    Ok(PlatformInfo {
        major: version.major,
        minor: version.minor,
        build: version.build,
        ubr,
        architecture: std::env::consts::ARCH.to_string(),
    })
}

fn read_ubr() -> Result<u32, &'static str> {
    let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0"
        .encode_utf16()
        .collect();
    let value: Vec<u16> = "UBR\0".encode_utf16().collect();
    let mut ubr = 0u32;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: both strings are null-terminated UTF-16; output pointers refer to initialized
    // local storage of the exact size requested, and the call only reads HKLM registry state.
    let result = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut ubr as *mut u32 as *mut c_void,
            &mut size,
        )
    };
    if result != 0 || size != size_of::<u32>() as u32 {
        return Err("windows_ubr_unavailable");
    }
    Ok(ubr)
}

fn diagnostic_ubr(read: impl FnOnce() -> Result<u32, &'static str>) -> u32 {
    read().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::diagnostic_ubr;

    #[test]
    fn unavailable_ubr_is_recorded_as_unknown_without_failing_platform_probe() {
        assert_eq!(diagnostic_ubr(|| Err("windows_ubr_unavailable")), 0);
        assert_eq!(diagnostic_ubr(|| Ok(6_093)), 6_093);
    }
}
