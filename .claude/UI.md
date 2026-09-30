# UI specification (Czech language, for non-programmers)

Stack: vanilla TypeScript modules in `app/src/web/` bundled by esbuild (entry `main.ts`), `app/public/index.html` + `styles.css`.
No framework. Small component modules (<300 lines each). All API URLs relative (`api/...`), WS url derived from
`location` (`new URL('api/events', location.href)` with ws/wss). Contract: `src/shared/api.ts`.
Security: never inject untrusted strings via innerHTML. Markdown for assistant messages via own small safe renderer
(escape first, then headings, bold, italics, inline code, fenced code blocks with copy button, lists, links only http/https
with rel=noopener target=_blank).

## Look & feel
- Clean, friendly, feels native to Home Assistant (HA blue `#03a9f4` accent, rounded cards 12px, soft shadows,
  Roboto/system font). Light + dark via `prefers-color-scheme`. Responsive: on < 800px width chat list becomes
  a slide-over drawer with hamburger button.
- Robot mascot/logo (inline SVG) in header: "AI automatizace".

## Screens
1. **Loading** – centered spinner.
2. **Login** (account.status loggedOut): friendly card: robot illustration, "Připojte svůj účet ChatGPT",
   explanation (1–2 sentences, each HA user has own login, the password is never entered here), primary button
   "Přihlásit se přes ChatGPT". After click (pendingLogin): step list 1) "Otevřete přihlašovací stránku" button
   (opens verificationUrl in new tab) 2) "Zadejte tento kód" – big monospace code with copy button 3) waiting
   indicator "Čekám na potvrzení…" + cancel link. On `account.updated` loggedIn -> go to app. Show errors kindly.
3. **App** – layout:
   - Left sidebar: "+ Nový chat" button, search box, chat list grouped (Dnes, Včera, Starší) with title, relative time,
     status dot (running = animated). Per-item menu: Přejmenovat, Smazat (inline confirm). Bottom: tab switch
     "Chaty" / "Historie změn", account (email, Odhlásit).
   - Top bar of chat: editable title, model picker (select with displayName; description as tooltip) and
     "Uvažování" picker (efforts of selected model; Czech labels: minimal=Minimální, low=Nízké, medium=Střední,
     high=Vysoké, xhigh=Maximální; unknown -> raw id). Selection persisted via PUT /api/settings.
   - Empty chat state: greeting "Co mám pro vás udělat?" + 4 example prompt cards (click fills composer):
     "Každou hodinu zapni žárovku v kotelně", "Najdi USB převodník Waveshare Modbus RTU relé a vytvoř z něj přepínače",
     "Pošli mi notifikaci, když se otevřou vchodové dveře a nikdo není doma", "Zkontroluj, jestli v konfiguraci nejsou chyby".
     Plus reassurance line: "Před každou změnou se automaticky vytvoří záloha a vše se ověří."
   - Messages: user bubbles right; assistant left with robot avatar, markdown, streaming caret.
     Activities grouped between messages into a collapsible "Průběh práce (N kroků)" block showing icon + title +
     status spinner/check/cross; expand item to see detail in monospace (command + output).
     fileChange: card "Upravené soubory" listing files with badge (nový/upravený/smazaný), expandable colored unified diff.
     verification: green card "✓ Konfigurace ověřena a uložena jako verze abc1234" (link -> opens history detail),
     red/orange card for failed/restored ("Změna nebyla funkční, konfigurace byla vrácena do původního stavu").
     question: card with header, question text, option buttons (single click selects & submits if single question),
     optional free text "Jiná odpověď" when allowOther; after answering shows chosen answers read-only.
     error: red inline card.
   - Composer: autosizing textarea, Enter = send, Shift+Enter = newline, send button; while running shows
     "Zastavit" button and status text ("Codex pracuje…", "Ověřuji konfiguraci…", "Čeká ve frontě…").
     Codex asks questions in plain text too – user just replies in composer.
4. **Historie změn** (history view in main area): vertical timeline of versions (newest first, "Načíst další"
   pagination): kind badge (Počáteční stav / Ruční změna / Před AI / Změna AI / Obnovení), title, time, user,
   files changed count, "Aktuální" badge on current. Click -> detail panel with per-file colored diffs and button
   "Obnovit tuto verzi" -> confirm dialog (custom modal, explains that current state is saved first so it can be
   undone) -> result toast (success / check failed & reverted / needs restart with button "Restartovat Home Assistant").
   Restore entries show "Obnoveno z verze xyz" with link.
Toasts: bottom-right, auto-hide. Reconnecting WS with backoff, banner "Spojení ztraceno, obnovuji…".
State management: a tiny store (`store.ts`) with subscribe/setState; views re-render their own subtree.
