fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        // Export DRM interposition symbols into .dynsym so WebKitGTK resolves
        // our Wayland EDID dimension alignment + NVIDIA CRTC vblank pacing.
        println!("cargo:rustc-link-arg=-Wl,--export-dynamic-symbol=drmModeGetConnector");
        println!("cargo:rustc-link-arg=-Wl,--export-dynamic-symbol=drmWaitVBlank");
    }
    tauri_build::build()
}

