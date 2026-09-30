# AI automatizace – Home Assistant add-on

Doplněk pro Home Assistant OS, který do postranního panelu přidá **AI automatizace**: chat s OpenAI Codex
(přihlášení vlastním účtem ChatGPT pro každého uživatele HA). Codex podle běžného popisu v češtině vytváří
a upravuje konfiguraci Home Assistantu – automatizace, skripty, integrace i hardware (USB, sériová zařízení).

*Home Assistant OS add-on that lets each HA user chat with OpenAI Codex (own ChatGPT login) to create and
change the Home Assistant configuration safely.*

## Bezpečnost

- před každou změnou se automaticky uloží verze konfigurace,
- po změně se konfigurace ověří (`check_config`), při chybě ji Codex jednou automaticky opraví,
  jinak se vše vrátí do původního stavu,
- historie verzí s rozdíly souborů – obnovit lze libovolnou verzi a obnovení lze také vrátit,
- Codex se doptá, když zadání není jednoznačné.

## Instalace

1. **Nastavení → Doplňky → Obchod s doplňky → ⋮ → Repozitáře** a přidejte
   `https://github.com/blikacka/haos-ai-automatizations`
2. Nainstalujte **AI automatizace**, spusťte a zapněte **Zobrazit v postranním panelu**.
3. Otevřete panel a přihlaste se svým účtem ChatGPT (jednorázový kód, heslo se nikam nezadává).

Podrobná dokumentace: [ai_automation/DOCS.md](ai_automation/DOCS.md)

## Vývoj

- `ai_automation/` – doplněk (config, Dockerfile, aplikace v `app/`: Node 22 + TypeScript)
- `devtools/` – lokální simulace Supervisoru / Home Assistantu a falešný Codex pro testy
  (`bash devtools/dev.sh`)
- `cd ai_automation/app && npm ci && npm run build && npm test && npm run lint`
