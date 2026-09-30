/**
 * Usage text of haos-tool (read by the Codex agent).
 */

/** Full usage text printed by `haos-tool help`. */
export const HELP_TEXT = `haos-tool – Home Assistant helper for the AI agent (runs inside the add-on, uses SUPERVISOR_TOKEN).
Output is pretty JSON on stdout (logs are plain text). Errors go to stderr with exit code 1.
Search is case and diacritics insensitive ("svetlo" matches "Světlo").

DISCOVERY
  haos-tool entities [--domain D] [--search TEXT] [--area AREA] [--limit N]
      Compact list [{entity_id, name, state, area, device, domain}], default limit 200.
      e.g. haos-tool entities --domain light --search kotelna
  haos-tool entity <entity_id>
      Full state + attributes, entity registry entry, device and area.
      e.g. haos-tool entity switch.boiler_room_light
  haos-tool areas                          Areas with entity counts.
  haos-tool devices [--search TEXT]        Devices (manufacturer, model, area, entity ids).
  haos-tool integrations                   Configured integrations (config entries).
  haos-tool services [domain]              Service names per domain, or full field definitions of one domain.
      e.g. haos-tool services light

ACTIONS
  haos-tool call <domain.service> [json-data] [--return-response]
      Call a service. Only when harmless and the user agrees (e.g. test a light).
      e.g. haos-tool call light.turn_on '{"entity_id":"light.kitchen","brightness_pct":50}'
      Blocked: homeassistant.restart/stop, hassio.* (use restart-core).

CONFIGURATION
  haos-tool check-config                   Validate the configuration. {valid, errors}. Exit 0 valid, 2 invalid.
  haos-tool reload <target>                Check config, then reload. Targets: automation, script, scene, group,
                                           template, input_boolean/input_number/..., any <domain> with reload,
                                           core (core config/customize), all (reload everything reloadable).
      e.g. haos-tool reload automation
  haos-tool restart-core                   Restart HA Core. Refused (exit 1) unless check-config is valid.
                                           Only when really required (new integration in YAML, e.g. modbus).

HISTORY AND BACKUP
  haos-tool snapshot "<message>"           Save current config state as a restorable version (before edits!).
  haos-tool history [N]                    Last N versions (default 10).
  haos-tool backup "<name>"                Supervisor partial backup of the HA config (slow, for big changes).

HARDWARE AND LOGS
  haos-tool hardware                       Supervisor hardware info + /dev/serial/by-id links.
  haos-tool usb                            Serial ports (ttyUSB/ttyACM) with by-id path, USB vendor:product,
                                           chip hints (CH340 1a86:7523 = typical Waveshare RS485) and lsusb.
  haos-tool logs [core|supervisor|host] [--lines N] [--grep TEXT]
      Tail of a log (default core, 200 lines).
      e.g. haos-tool logs core --lines 100 --grep modbus

ADD-ONS (read only)
  haos-tool addons                         Installed add-ons.
  haos-tool addon <slug>                   Details of one add-on (options hidden).

AUTOMATION DEBUGGING
  haos-tool automation-trace <automation_id|automation.entity_id> [--limit N] [--run RUN_ID]
      Latest runs (trace/list) and the full newest trace (trace/get).
      e.g. haos-tool automation-trace automation.boiler_room_light_hourly

RAW ACCESS (advanced)
  haos-tool ws '<json>'                    One core websocket command, e.g. haos-tool ws '{"type":"config/label_registry/list"}'
  haos-tool api <GET|POST> <path> [json]   Core REST, e.g. haos-tool api GET /api/config
  haos-tool supervisor <GET|POST> <path> [json]
                                           Supervisor REST, e.g. haos-tool supervisor GET /core/info
      Restarting/stopping/updating host, supervisor, core or add-ons is blocked.

haos-tool help                             This text.
`
