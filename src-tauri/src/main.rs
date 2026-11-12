#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // 🚀 Běh přes XWayland s vypnutým DMA-BUF eliminuje blikání WebKitGTK a zachovává plynulou hardwarovou akceleraci na NVIDIA GPU
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    mychalsmp_launcher_lib::run();
}
