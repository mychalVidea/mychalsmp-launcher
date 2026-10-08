# 📝 Plán vývoje a TODO úkoly (MYCHAL SMP Launcher)

## 📌 Prioritní úkoly (K dokončení)

### 🎮 1. Dokončit a doladit Discord Rich Presence (RPC)
- [ ] **Soubor:** `src/main/discordRpc.js`
- [ ] **Aktuální stav:** Základní nativní IPC socket klient (Linux `/run/user/1000/discord-ipc-0` a Windows Named Pipe) s Client ID `1415597133855326318` je naimplementován.
- [ ] **K dodělání:**
  - Otestovat a doladit nahrání oficiálních assetů (obrázků `mychalsmp_logo` a `minecraft`) v Discord Developer Portalu pro aplikaci `1415597133855326318`.
  - Pokud Discord nepodporuje string key bez nahraných assetů, otestovat chování při zobrazení a případně přidat tlačítka (Buttons) do Rich Presence:
    - *„🌐 Web: mychalsmp.xyz“* (`https://mychalsmp.xyz`)
    - *„🎮 Připojit se na SMP“* (`https://join.mychalsmp.xyz`)
  - Otestovat stabilitu reconnect smyčky při startu hry před zapnutím Discordu a při uspání/probuzení PC.
  - Zvážit zobrazení detailnějšího in-game stavu (např. zda je hráč v Netheru, Endu nebo Overworldu, pokud to bude server/plugin předávat přes query/socket).

---

*Zapsáno: 8. října 2026*
