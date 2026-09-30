# Changelog

## 0.1.1

- Historie verzí nesleduje `.storage/`, `.ha_run.lock` a soubory spravované HACS; již sledované se automaticky vyřadí.
- Automatický návrat nefunkční změny je v historii správně pojmenován.
- Po úspěšné automatické opravě se zobrazí potvrzení ověření.
- Instrukce pro Codex: detekce rozložení konfigurace a řešení konfliktů s existujícím systémem.
- Správné zobrazení jmen uživatelů s diakritikou.

## 0.1.0

- První verze doplňku.
- Chat s OpenAI Codex v postranním panelu Home Assistantu (ingress).
- Přihlášení vlastním účtem ChatGPT pro každého uživatele HA (device-code).
- Automatická záloha před změnou, ověření konfigurace po změně a automatický návrat při chybě.
- Historie verzí konfigurace s náhledem rozdílů a obnovením (i obnovení lze vrátit).
- Nástroj `haos-tool` pro Codex: entity, služby, kontrola konfigurace, reload, USB a sériový hardware, logy.
