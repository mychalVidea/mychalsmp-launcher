#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // 🚀 1. DŮKLADNĚ ODSTRANIT VŠECHNY CPU/SOFTWARE FALLBACKY
        // Zabrání běhu WebKitGTK na CPU při zděděných proměnných z prostředí
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
        std::env::remove_var("LIBGL_ALWAYS_SOFTWARE");
        std::env::remove_var("GSK_RENDERER");

        // 🚀 2. AKTIVOVAT PLNÉ HARDWAROVÉ GPU SKLÁDÁNÍ
        std::env::set_var("WEBKIT_FORCE_COMPOSITING_MODE", "1");

        // 🚀 3. ELIMINOVAT DMA-BUF BLIKÁNÍ NA NVIDIA
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

        // 🚀 4. NATIVNÍ WAYLAND PRO 60-240 FPS (ODSTRANĚNÍ 30 FPS ZÁMKU Z XWAYLANDU)
        // Vynucení X11 (GDK_BACKEND=x11) na sestavě s 240Hz + 60Hz monitory způsobovalo
        // v XWaylandu pád na 30 FPS a CPU pipeline stall přes glReadPixels.
        // Nativní Wayland (wayland,x11) odemyká plnou frekvenci monitoru.
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }
    }
    mychalsmp_launcher_lib::run();
}
