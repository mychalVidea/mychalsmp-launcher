#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod drm_vblank;

#[cfg(target_os = "linux")]
fn has_nvidia_gpu() -> bool {
    ["/dev/nvidiactl", "/dev/nvidia0", "/proc/driver/nvidia/version"]
        .iter()
        .any(|path| std::path::Path::new(path).exists())
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        drm_vblank::keep_symbols_alive();
        // 🚀 1. DŮKLADNĚ ODSTRANIT VŠECHNY CPU/SOFTWARE FALLBACKY
        // Zabrání běhu WebKitGTK na CPU při zděděných proměnných z prostředí
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
        std::env::remove_var("LIBGL_ALWAYS_SOFTWARE");
        std::env::remove_var("GSK_RENDERER");
        std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        std::env::remove_var("WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS");

        // 🚀 2. AKTIVOVAT PLNÉ HARDWAROVÉ GPU SKLÁDÁNÍ (EGL)
        std::env::set_var("WEBKIT_FORCE_COMPOSITING_MODE", "1");

        // 🚀 2b. BYPASS NVIDIA DMA-BUF FENCE STALLU PŘI PŘENOSU SNÍMKŮ DO UIPROCESS
        // Na NVIDIA ovladači pod Waylandem synchronizace DMA-BUF při scrollu a WebGL prekreslování
        // zamyká UI na 60 FPS (a může způsobovat chybný scanout compositingu). FORCE_SHM udrží GPU
        // akceleraci (WebGL/Skia) v WebKitWebProcess, ale přenáší hotový framebuffer přes SHM na 240 FPS.
        if has_nvidia_gpu() && std::env::var_os("WEBKIT_DMABUF_RENDERER_FORCE_SHM").is_none() {
            std::env::set_var("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1");
        }

        // 🚀 3. NATIVNÍ WAYLAND PRO 60-240 FPS (ODSTRANĚNÍ 30 FPS ZÁMKU Z XWAYLANDU)
        // Vynucení X11 (GDK_BACKEND=x11) na sestavě s 240Hz + 60Hz monitory způsobovalo
        // v XWaylandu pád na 30 FPS a CPU pipeline stall přes glReadPixels.
        // Nativní Wayland (wayland,x11) odemyká plnou frekvenci monitoru.
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }
    }
    mychalsmp_launcher_lib::run();
}
