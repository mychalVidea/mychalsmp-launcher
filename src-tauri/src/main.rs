#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // 🛡️ Ochrana proti zběsilému blikání (flickeringu) WebKitGTK na Linuxu (NVIDIA + Wayland)
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    mychalsmp_launcher_lib::run();
}
