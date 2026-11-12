//! Linux WebKitGTK High-Refresh-Rate (120Hz–240Hz+) Support
//!
//! Opravuje dvě nativní bariéry v `webkit2gtk-4.1` na Linuxu (Wayland + NVIDIA):
//! 1. Shoda monitorů v `DisplayVBlankMonitorDRM::findCrtc()` porovnává přesné EDID
//!    rozměry z Waylandu (`GdkMonitor`) s hrubě zaokrouhlenými cm hodnotami z DRM
//!    (`drmModeConnector::mmWidth/mmHeight`), což na většině monitorů selže.
//!    `drmModeGetConnector` zarovná `mmWidth`/`mmHeight` podle `GdkMonitor` plug-name.
//! 2. `nvidia-drm` nepodporuje legacy `DRM_IOCTL_WAIT_VBLANK` (`EOPNOTSUPP`), což
//!    shazuje WebKitGTK na záložní 60Hz časovač (`DisplayVBlankMonitorTimer`).
//!    `drmWaitVBlank` nejprve volá reálný `libdrm` syscall (pro AMD/Intel bez zásahu);
//!    pouze při nepodporovaném ioctlu plynule časuje snímky podle přesného CRTC módu.

use std::ffi::CStr;
use std::os::raw::{c_char, c_int, c_long, c_uint, c_ulong, c_void};
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

const DRM_MODE_CONNECTED: c_int = 1;
const DRM_VBLANK_RELATIVE: u32 = 0x1;
const DRM_VBLANK_HIGH_CRTC_MASK: u32 = 0x0000_003e;
const DRM_VBLANK_HIGH_CRTC_SHIFT: u32 = 1;
const DRM_VBLANK_SECONDARY: u32 = 0x2000_0000;
const DRM_MODE_FLAG_INTERLACE: u32 = 1 << 4;
const DRM_MODE_FLAG_DBLSCAN: u32 = 1 << 5;
const FALLBACK_INTERVAL_NS: u64 = 16_666_667;
const MAX_CRTCS: usize = 16;

#[repr(C)]
pub struct DrmModeRes {
    pub count_fbs: c_int,
    pub fbs: *mut u32,
    pub count_crtcs: c_int,
    pub crtcs: *mut u32,
    pub count_connectors: c_int,
    pub connectors: *mut u32,
    pub count_encoders: c_int,
    pub encoders: *mut u32,
    pub min_width: u32,
    pub max_width: u32,
    pub min_height: u32,
    pub max_height: u32,
}

#[repr(C)]
pub struct DrmModeModeInfo {
    pub clock: u32,
    pub hdisplay: u16,
    pub hsync_start: u16,
    pub hsync_end: u16,
    pub htotal: u16,
    pub hskew: u16,
    pub vdisplay: u16,
    pub vsync_start: u16,
    pub vsync_end: u16,
    pub vtotal: u16,
    pub vscan: u16,
    pub vrefresh: u32,
    pub flags: u32,
    pub r#type: u32,
    pub name: [c_char; 32],
}

#[repr(C)]
pub struct DrmModeCrtc {
    pub crtc_id: u32,
    pub buffer_id: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub mode_valid: c_int,
    pub mode: DrmModeModeInfo,
    pub gamma_size: c_int,
}

#[repr(C)]
pub struct DrmModeConnector {
    pub connector_id: u32,
    pub encoder_id: u32,
    pub connector_type: u32,
    pub connector_type_id: u32,
    pub connection: c_int,
    pub mm_width: u32,
    pub mm_height: u32,
    pub subpixel: c_int,
    pub count_modes: c_int,
    pub modes: *mut DrmModeModeInfo,
    pub count_props: c_int,
    pub props: *mut u32,
    pub prop_values: *mut u64,
    pub count_encoders: c_int,
    pub encoders: *mut u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct DrmVBlankReq {
    pub r#type: u32,
    pub sequence: c_uint,
    pub signal: c_ulong,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct DrmVBlankReply {
    pub r#type: u32,
    pub sequence: c_uint,
    pub tval_sec: c_long,
    pub tval_usec: c_long,
}

#[repr(C)]
pub union DrmVBlank {
    pub request: DrmVBlankReq,
    pub reply: DrmVBlankReply,
}

struct CrtcTiming {
    next_ns: AtomicU64,
    interval_ns: AtomicU64,
    seq: AtomicU64,
    calls: AtomicU64,
}

impl CrtcTiming {
    const fn new() -> Self {
        Self {
            next_ns: AtomicU64::new(0),
            interval_ns: AtomicU64::new(0),
            seq: AtomicU64::new(0),
            calls: AtomicU64::new(0),
        }
    }
}

static CRTC_STATE: [CrtcTiming; MAX_CRTCS] = [
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
    CrtcTiming::new(),
];

fn libdrm_handle() -> *mut c_void {
    static HANDLE: OnceLock<usize> = OnceLock::new();
    *HANDLE.get_or_init(|| unsafe {
        let name = b"libdrm.so.2\0".as_ptr() as *const c_char;
        let mut h = libc::dlopen(name, libc::RTLD_LAZY | libc::RTLD_NOLOAD);
        if h.is_null() {
            h = libc::dlopen(name, libc::RTLD_LAZY | libc::RTLD_LOCAL);
        }
        h as usize
    }) as *mut c_void
}

unsafe fn dlsym_libdrm(sym: &[u8]) -> *mut c_void {
    let h = libdrm_handle();
    if h.is_null() {
        return ptr::null_mut();
    }
    libc::dlsym(h, sym.as_ptr() as *const c_char)
}

unsafe fn query_crtc_interval_ns(fd: c_int, idx: usize) -> u64 {
    type GetResFn = unsafe extern "C" fn(c_int) -> *mut DrmModeRes;
    type FreeResFn = unsafe extern "C" fn(*mut DrmModeRes);
    type GetCrtcFn = unsafe extern "C" fn(c_int, u32) -> *mut DrmModeCrtc;
    type FreeCrtcFn = unsafe extern "C" fn(*mut DrmModeCrtc);

    let p_get_res = dlsym_libdrm(b"drmModeGetResources\0");
    let p_free_res = dlsym_libdrm(b"drmModeFreeResources\0");
    let p_get_crtc = dlsym_libdrm(b"drmModeGetCrtc\0");
    let p_free_crtc = dlsym_libdrm(b"drmModeFreeCrtc\0");
    if p_get_res.is_null() || p_free_res.is_null() || p_get_crtc.is_null() || p_free_crtc.is_null() {
        return FALLBACK_INTERVAL_NS;
    }

    let get_res: GetResFn = std::mem::transmute(p_get_res);
    let free_res: FreeResFn = std::mem::transmute(p_free_res);
    let get_crtc: GetCrtcFn = std::mem::transmute(p_get_crtc);
    let free_crtc: FreeCrtcFn = std::mem::transmute(p_free_crtc);

    let res = get_res(fd);
    if res.is_null() {
        return FALLBACK_INTERVAL_NS;
    }

    let mut ns = FALLBACK_INTERVAL_NS;
    let count = (*res).count_crtcs.max(0) as usize;
    if idx < count && !(*res).crtcs.is_null() {
        let crtc_id = *(*res).crtcs.add(idx);
        let crtc = get_crtc(fd, crtc_id);
        if !crtc.is_null() {
            let m = &(*crtc).mode;
            if (*crtc).mode_valid != 0 && m.clock > 0 && m.htotal > 0 && m.vtotal > 0 {
                let mut hz = (m.clock as f64) * 1000.0 / ((m.htotal as f64) * (m.vtotal as f64));
                if (m.flags & DRM_MODE_FLAG_INTERLACE) != 0 {
                    hz *= 2.0;
                }
                if (m.flags & DRM_MODE_FLAG_DBLSCAN) != 0 {
                    hz /= 2.0;
                }
                if m.vscan > 1 {
                    hz /= m.vscan as f64;
                }
                if (24.0..=1000.0).contains(&hz) {
                    ns = (1_000_000_000.0 / hz).round() as u64;
                }
            }
            free_crtc(crtc);
        }
    }
    free_res(res);
    ns
}

unsafe fn align_connector_dimensions_from_gdk(conn: *mut DrmModeConnector) {
    let glib = libc::dlopen(
        b"libglib-2.0.so.0\0".as_ptr() as *const c_char,
        libc::RTLD_LAZY | libc::RTLD_NOLOAD,
    );
    let gdk = libc::dlopen(
        b"libgdk-3.so.0\0".as_ptr() as *const c_char,
        libc::RTLD_LAZY | libc::RTLD_NOLOAD,
    );
    if glib.is_null() || gdk.is_null() {
        return;
    }

    type IsOwnerFn = unsafe extern "C" fn(*mut c_void) -> c_int;
    type GFreeFn = unsafe extern "C" fn(*mut c_void);
    type DispDefaultFn = unsafe extern "C" fn() -> *mut c_void;
    type DispScreenFn = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
    type NMonFn = unsafe extern "C" fn(*mut c_void) -> c_int;
    type GetMonFn = unsafe extern "C" fn(*mut c_void, c_int) -> *mut c_void;
    type PlugNameFn = unsafe extern "C" fn(*mut c_void, c_int) -> *mut c_char;
    type GetMmFn = unsafe extern "C" fn(*mut c_void) -> c_int;
    type ConnTypeNameFn = unsafe extern "C" fn(u32) -> *const c_char;

    let p_is_owner = libc::dlsym(glib, b"g_main_context_is_owner\0".as_ptr() as *const c_char);
    let p_g_free = libc::dlsym(glib, b"g_free\0".as_ptr() as *const c_char);
    let p_disp_default = libc::dlsym(gdk, b"gdk_display_get_default\0".as_ptr() as *const c_char);
    let p_disp_screen = libc::dlsym(gdk, b"gdk_display_get_default_screen\0".as_ptr() as *const c_char);
    let p_n_mon = libc::dlsym(gdk, b"gdk_display_get_n_monitors\0".as_ptr() as *const c_char);
    let p_get_mon = libc::dlsym(gdk, b"gdk_display_get_monitor\0".as_ptr() as *const c_char);
    let p_plug_name = libc::dlsym(gdk, b"gdk_screen_get_monitor_plug_name\0".as_ptr() as *const c_char);
    let p_width_mm = libc::dlsym(gdk, b"gdk_monitor_get_width_mm\0".as_ptr() as *const c_char);
    let p_height_mm = libc::dlsym(gdk, b"gdk_monitor_get_height_mm\0".as_ptr() as *const c_char);
    let p_type_name = dlsym_libdrm(b"drmModeGetConnectorTypeName\0");

    if p_is_owner.is_null()
        || p_g_free.is_null()
        || p_disp_default.is_null()
        || p_disp_screen.is_null()
        || p_n_mon.is_null()
        || p_get_mon.is_null()
        || p_plug_name.is_null()
        || p_width_mm.is_null()
        || p_height_mm.is_null()
        || p_type_name.is_null()
    {
        return;
    }

    let is_owner: IsOwnerFn = std::mem::transmute(p_is_owner);
    if is_owner(ptr::null_mut()) == 0 {
        return;
    }

    let disp_default: DispDefaultFn = std::mem::transmute(p_disp_default);
    let display = disp_default();
    if display.is_null() {
        return;
    }

    let disp_screen: DispScreenFn = std::mem::transmute(p_disp_screen);
    let screen = disp_screen(display);
    if screen.is_null() {
        return;
    }

    let type_name_fn: ConnTypeNameFn = std::mem::transmute(p_type_name);
    let raw_type = type_name_fn((*conn).connector_type);
    if raw_type.is_null() {
        return;
    }
    let expected_name = format!(
        "{}-{}",
        CStr::from_ptr(raw_type).to_string_lossy(),
        (*conn).connector_type_id
    );

    let g_free: GFreeFn = std::mem::transmute(p_g_free);
    let n_mon: NMonFn = std::mem::transmute(p_n_mon);
    let get_mon: GetMonFn = std::mem::transmute(p_get_mon);
    let plug_name_fn: PlugNameFn = std::mem::transmute(p_plug_name);
    let width_mm_fn: GetMmFn = std::mem::transmute(p_width_mm);
    let height_mm_fn: GetMmFn = std::mem::transmute(p_height_mm);

    let count = n_mon(display).max(0);
    let mut fuzzy_match: Option<(u32, u32)> = None;
    let mut fuzzy_count = 0usize;

    for i in 0..count {
        let mon = get_mon(display, i);
        if mon.is_null() {
            continue;
        }
        let mw = width_mm_fn(mon);
        let mh = height_mm_fn(mon);
        if mw <= 0 || mh <= 0 {
            continue;
        }

        let plug_ptr = plug_name_fn(screen, i);
        let matched = if !plug_ptr.is_null() {
            let name = CStr::from_ptr(plug_ptr).to_string_lossy().into_owned();
            g_free(plug_ptr as *mut c_void);
            name == expected_name
        } else {
            false
        };

        if matched {
            (*conn).mm_width = mw as u32;
            (*conn).mm_height = mh as u32;
            return;
        }

        let dw = (mw - (*conn).mm_width as c_int).abs();
        let dh = (mh - (*conn).mm_height as c_int).abs();
        if dw <= 15 && dh <= 15 {
            fuzzy_match = Some((mw as u32, mh as u32));
            fuzzy_count += 1;
        }
    }

    if fuzzy_count == 1 {
        if let Some((mw, mh)) = fuzzy_match {
            (*conn).mm_width = mw;
            (*conn).mm_height = mh;
        }
    }
}

fn crtc_index_from_type(req_type: u32) -> usize {
    if (req_type & DRM_VBLANK_HIGH_CRTC_MASK) != 0 {
        return ((req_type & DRM_VBLANK_HIGH_CRTC_MASK) >> DRM_VBLANK_HIGH_CRTC_SHIFT) as usize;
    }
    if (req_type & DRM_VBLANK_SECONDARY) != 0 {
        return 1;
    }
    0
}

#[no_mangle]
pub unsafe extern "C" fn drmModeGetConnector(
    fd: c_int,
    connector_id: u32,
) -> *mut DrmModeConnector {
    type RealFn = unsafe extern "C" fn(c_int, u32) -> *mut DrmModeConnector;
    let p = dlsym_libdrm(b"drmModeGetConnector\0");
    if p.is_null() {
        return ptr::null_mut();
    }
    let real_fn: RealFn = std::mem::transmute(p);
    let conn = real_fn(fd, connector_id);
    if !conn.is_null()
        && (*conn).connection == DRM_MODE_CONNECTED
        && (*conn).encoder_id != 0
        && (*conn).count_modes > 0
    {
        align_connector_dimensions_from_gdk(conn);
    }
    conn
}

#[no_mangle]
pub unsafe extern "C" fn drmWaitVBlank(fd: c_int, vblank: *mut DrmVBlank) -> c_int {
    type RealFn = unsafe extern "C" fn(c_int, *mut DrmVBlank) -> c_int;
    let p = dlsym_libdrm(b"drmWaitVBlank\0");
    if !p.is_null() {
        let real_fn: RealFn = std::mem::transmute(p);
        let ret = real_fn(fd, vblank);
        if ret == 0 {
            return 0;
        }
        let err = *libc::__errno_location();
        if err != libc::EOPNOTSUPP
            && err != libc::ENOTTY
            && err != libc::EINVAL
            && err != libc::ENOSYS
        {
            return ret;
        }
    }

    if vblank.is_null() {
        *libc::__errno_location() = libc::EINVAL;
        return -1;
    }

    let req_type = (*vblank).request.r#type;
    let req_seq = (*vblank).request.sequence;
    let idx = crtc_index_from_type(req_type).min(MAX_CRTCS - 1);
    let state = &CRTC_STATE[idx];

    let call_num = state.calls.fetch_add(1, Ordering::Relaxed);
    let mut interval_ns = state.interval_ns.load(Ordering::Relaxed);
    if interval_ns == 0 || req_seq == 0 || call_num % 240 == 0 {
        interval_ns = query_crtc_interval_ns(fd, idx);
        state.interval_ns.store(interval_ns, Ordering::Relaxed);
    }

    let mut now = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now);
    let now_ns = (now.tv_sec as u64)
        .saturating_mul(1_000_000_000)
        .saturating_add(now.tv_nsec as u64);

    if req_seq == 0 {
        let cur_seq = state.seq.load(Ordering::Relaxed) as c_uint;
        (*vblank).reply = DrmVBlankReply {
            r#type: req_type,
            sequence: cur_seq,
            tval_sec: now.tv_sec as c_long,
            tval_usec: (now.tv_nsec / 1000) as c_long,
        };
        *libc::__errno_location() = 0;
        return 0;
    }

    let wait_frames = if (req_type & DRM_VBLANK_RELATIVE) != 0 {
        (req_seq.max(1)) as u64
    } else {
        1
    };

    let prev_next = state.next_ns.load(Ordering::Relaxed);
    let target_ns = if prev_next == 0 || prev_next.saturating_add(interval_ns.saturating_mul(4)) < now_ns {
        now_ns.saturating_add(interval_ns.saturating_mul(wait_frames))
    } else {
        prev_next.saturating_add(interval_ns.saturating_mul(wait_frames))
    };
    state.next_ns.store(target_ns, Ordering::Relaxed);

    let target = libc::timespec {
        tv_sec: (target_ns / 1_000_000_000) as _,
        tv_nsec: (target_ns % 1_000_000_000) as _,
    };

    loop {
        let rc = libc::clock_nanosleep(
            libc::CLOCK_MONOTONIC,
            libc::TIMER_ABSTIME,
            &target,
            ptr::null_mut(),
        );
        if rc != libc::EINTR {
            break;
        }
    }

    let new_seq = state.seq.fetch_add(wait_frames, Ordering::Relaxed) + wait_frames;
    (*vblank).reply = DrmVBlankReply {
        r#type: req_type,
        sequence: new_seq as c_uint,
        tval_sec: target.tv_sec as c_long,
        tval_usec: (target.tv_nsec / 1000) as c_long,
    };
    *libc::__errno_location() = 0;
    0
}

pub fn keep_symbols_alive() {
    std::hint::black_box(drmModeGetConnector as *const ());
    std::hint::black_box(drmWaitVBlank as *const ());
}
