# AI automatizace

Doplněk **AI automatizace** přidá do postranního panelu Home Assistantu položku
s robotem. Tam si můžete česky povídat s umělou inteligencí (OpenAI Codex), která
umí vaši domácnost prozkoumat a upravit její konfiguraci – například:

- „Každou hodinu zapni žárovku v kotelně.“
- „Najdi USB převodník Waveshare Modbus RTU relé a vytvoř z něj přepínače.“
- „Pošli mi notifikaci, když se otevřou vchodové dveře a nikdo není doma.“
- „Zkontroluj, jestli v konfiguraci nejsou chyby.“

Doplněk je soběstačný: Node.js, Git, Codex CLI i všechny pomocné nástroje jsou
přímo v obrazu doplňku. Na Home Assistant OS nemusíte nic dalšího instalovat.

## Co potřebujete

- Home Assistant OS (nebo Supervised) na architektuře **amd64** nebo **aarch64**.
- Účet **ChatGPT** (Plus, Pro, Business, Edu nebo Enterprise), přes který Codex běží.
  Každý uživatel Home Assistantu se přihlašuje svým vlastním účtem.
- Přístup k internetu (komunikace s OpenAI).

## Instalace

### Varianta A – z repozitáře (doporučeno)

1. V Home Assistantu otevřete **Nastavení → Doplňky → Obchod s doplňky**.
2. Vpravo nahoře klikněte na **⋮ → Repozitáře**.
3. Vložte adresu repozitáře (např. `https://github.com/blikacka/haos-ai-automatizations`)
   a klikněte na **Přidat**.
4. Obnovte stránku, najděte doplněk **AI automatizace** a klikněte na **Instalovat**.
   První instalace trvá několik minut, protože se obraz sestavuje přímo na vašem zařízení.
5. Zapněte **Zobrazit v postranním panelu** a klikněte na **Spustit**.

### Varianta B – lokální doplněk (bez repozitáře)

1. Nainstalujte doplněk **Samba share** nebo **Advanced SSH & Web Terminal**,
   abyste měli přístup ke složce `/addons`.
2. Zkopírujte celou složku `ai_automation` (včetně podsložky `app`) do `/addons`,
   takže vznikne `/addons/ai_automation/config.yaml`.
3. V **Obchodu s doplňky** klikněte na **⋮ → Zkontrolovat aktualizace** a obnovte stránku.
4. Doplněk se objeví v sekci **Lokální doplňky**. Nainstalujte ho a spusťte.

## První přihlášení

1. Klikněte na **AI automatizace** v postranním panelu.
2. Klikněte na **Přihlásit se účtem ChatGPT**. Zobrazí se odkaz a jednorázový kód.
3. Otevřete odkaz (klidně na telefonu), přihlaste se do ChatGPT a zadejte kód.
4. Po potvrzení se stránka sama přepne do chatu. Přihlášení si doplněk pamatuje
   a každý uživatel Home Assistantu má své vlastní, oddělené od ostatních.

Odhlásit se můžete kdykoli v nabídce svého účtu v horní liště doplňku.

## Jak doplněk chrání vaši konfiguraci

- **Záloha před každou změnou** – aktuální stav konfigurace se uloží jako verze
  do historie (Git ve složce konfigurace). Před velkými změnami může AI vytvořit
  i zálohu Home Assistantu.
- **Ověření po každé změně** – po úpravě se vždy spustí kontrola konfigurace.
  Pokud selže, AI se chybu pokusí opravit; když se to nepodaří, konfigurace se
  automaticky vrátí do původního, funkčního stavu.
- **Nikdy nerozbitý Home Assistant** – restart se provede jen tehdy, když je
  konfigurace platná. Většinu změn stačí jen znovu načíst, bez restartu.
- **Doptá se, když si není jistá** – když není jasné, kterou žárovku nebo zařízení
  myslíte, AI nabídne možnosti a počká na vaši odpověď.
- **Oddělení uživatelů** – přihlašovací údaje ChatGPT každého uživatele jsou uložené
  zvlášť v soukromém úložišti doplňku a nikdy se neposílají jinam než do OpenAI.
- Doplněk je dostupný jen přes rozhraní Home Assistantu (ingress) a jen
  administrátorům.

## Historie změn a obnovení

V záložce **Historie změn** vidíte časovou osu všech verzí konfigurace: počáteční
stav, ruční změny, stav před zásahem AI, změny AI a obnovení. U každé verze
zobrazíte přesný rozdíl v souborech.

Tlačítkem **Obnovit tuto verzi** vrátíte konfiguraci do zvoleného stavu. Před
obnovením se aktuální stav uloží jako nová verze, takže i obnovení lze vrátit.
Po obnovení se konfigurace znovu ověří; pokud by obnovená verze nebyla platná,
návrat se neprovede.

Verzují se konfigurační soubory (YAML, vlastní komponenty, šablony, blueprinty…).
Záměrně se **neverzuje** interní úložiště Home Assistantu `.storage/` (mění se
neustále a nelze ho bezpečně vracet za běhu), databáze, logy, média a soubory
spravované HACS (`custom_components/hacs`, `www/community`). Pro ně slouží běžné
zálohy Home Assistantu.

**Poznámka k zálohám:** data doplňku (včetně přihlášení ke Codexu jednotlivých
uživatelů) jsou součástí záloh Home Assistantu. Se zálohami proto zacházejte jako
s citlivými daty.

## Nastavení

| Volba | Význam |
| --- | --- |
| `default_model` | Model Codexu pro nové konverzace. Prázdné = výchozí model účtu. |
| `default_reasoning` | Míra přemýšlení: `minimal`, `low`, `medium`, `high`, `xhigh`. |
| `log_level` | Podrobnost logu: `debug`, `info`, `warning`, `error`. |

Model i míru přemýšlení lze změnit také přímo v chatu pro každou konverzaci.

## Časté otázky

**Kolik to stojí?**
Doplněk je zdarma. Využití Codexu se započítává do limitů vašeho předplatného ChatGPT.

**Uvidí AI moje hesla ze `secrets.yaml`?**
AI má přístup ke složce konfigurace, aby ji mohla upravovat. Hodnoty z `secrets.yaml`
nemá důvod číst ani vypisovat a instrukce jí to zakazují, ale soubor je dostupný.
Pokud to nechcete, doplněk nepoužívejte.

**Co když se něco pokazí?**
Otevřete **Historie změn** a obnovte poslední funkční verzi. Každá změna AI je
uložena zvlášť.

**Můžu konfiguraci upravovat i ručně?**
Ano. Ruční změny se při další práci AI uloží do historie jako „Ruční změna“.

**Proč se doplněk instaluje tak dlouho?**
Obraz se sestavuje na vašem zařízení a obsahuje Codex CLI, Node.js a Git.
Na pomalejších zařízeních to může trvat i 10 minut.

**Přihlášení nefunguje / kód vypršel.**
Klikněte znovu na **Přihlásit se** a vygenerujte nový kód. Zkontrolujte, že má
Home Assistant přístup k internetu.

**Kde najdu logy?**
**Nastavení → Doplňky → AI automatizace → Log**. Pro podrobnosti nastavte
`log_level: debug`.
