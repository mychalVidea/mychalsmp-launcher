# 📝 Plán vývoje a TODO úkoly (MYCHAL SMP Launcher)

## 📌 Prioritní úkoly (K dokončení)

### 🎮 1. Dokončit a doladit Discord Rich Presence (RPC)
- [x] **Soubor:** `src/main/discordRpc.js`
- [x] **Stav:** Hotovo a odladěno
  - Nativní zero-dependency IPC klient (App ID `1557874962956550154`) pro Linux (Native, Flatpak, Snap) i Windows.
  - Nastaveno oficiální logo `smpclient-logo2.png` a ikona majáku `beacon.jpg`.
  - Doplněna interaktivní tlačítka v Rich Presence:
    - In-game: *„🎮 Připojit se na SMP“* (`https://join.mychalsmp.xyz`) & *„🌐 Oficiální web“* (`https://mychalsmp.xyz`)
    - V launcheru: *„🌐 Web: mychalsmp.xyz“* (`https://mychalsmp.xyz`) & *„🎮 Jak se připojit“* (`https://join.mychalsmp.xyz`)
  - Auto-reconnect smyčka při zapnutí Discordu po spuštění launcheru/hry a ošetření chyb.

---

*Zapsáno: 8. října 2026*
