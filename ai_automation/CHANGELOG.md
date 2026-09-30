# Changelog

## 0.1.3

- Soubory rozhraní mají v adrese otisk obsahu (`?v=…`), takže se po aktualizaci vždy načte nová verze.
- Styly jsou sloučené do jednoho souboru.

## 0.1.2

- Nové přihlášení přes prohlížeč (OAuth) pro pracovní prostory, které nepovolují kódy zařízení.
- Soubory rozhraní se po aktualizaci doplňku načtou hned (bez hodinové cache prohlížeče).

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
