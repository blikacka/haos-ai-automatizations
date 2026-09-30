/**
 * Realistic Czech home seed data for the mock Home Assistant.
 */

export const HA_VERSION = '2026.9.3'
export const SUPERVISOR_VERSION = '2026.09.1'
export const OS_VERSION = '16.2'

export const AREAS = [
    { areaId: 'kotelna', name: 'Kotelna', icon: 'mdi:water-boiler' },
    { areaId: 'obyvak', name: 'Obývák', icon: 'mdi:sofa' },
    { areaId: 'kuchyn', name: 'Kuchyně', icon: 'mdi:countertop' },
    { areaId: 'chodba', name: 'Chodba', icon: 'mdi:door' },
    { areaId: 'garaz', name: 'Garáž', icon: 'mdi:garage' },
]

export const DEVICES = [
    { deviceId: 'dev_kotelna_zarovka', name: 'Shelly 1 Kotelna', manufacturer: 'Shelly', model: 'Shelly 1 Gen3', areaId: 'kotelna', integration: 'shelly' },
    { deviceId: 'dev_kotelna_cerpadlo', name: 'Shelly Plug Čerpadlo', manufacturer: 'Shelly', model: 'Shelly Plug S Gen3', areaId: 'kotelna', integration: 'shelly' },
    { deviceId: 'dev_kotelna_teplomer', name: 'Teploměr kotelna', manufacturer: 'Xiaomi', model: 'LYWSD03MMC', areaId: 'kotelna', integration: 'zha' },
    { deviceId: 'dev_obyvak_strop', name: 'Hue stropní obývák', manufacturer: 'Signify Netherlands B.V.', model: 'Hue White Ambiance', areaId: 'obyvak', integration: 'hue' },
    { deviceId: 'dev_obyvak_senzor', name: 'Senzor obývák', manufacturer: 'Aqara', model: 'WSDCGQ11LM', areaId: 'obyvak', integration: 'zha' },
    { deviceId: 'dev_kuchyn_linka', name: 'LED pásek linka', manufacturer: 'IKEA of Sweden', model: 'TRADFRI driver', areaId: 'kuchyn', integration: 'zha' },
    { deviceId: 'dev_chodba_svetlo', name: 'Shelly Dimmer Chodba', manufacturer: 'Shelly', model: 'Shelly Dimmer 2', areaId: 'chodba', integration: 'shelly' },
    { deviceId: 'dev_vchodove_dvere', name: 'Kontakt vchodové dveře', manufacturer: 'Aqara', model: 'MCCGQ11LM', areaId: 'chodba', integration: 'zha' },
    { deviceId: 'dev_chodba_pohyb', name: 'Pohybové čidlo chodba', manufacturer: 'Aqara', model: 'RTCGQ11LM', areaId: 'chodba', integration: 'zha' },
    { deviceId: 'dev_garaz_zasuvka', name: 'Zásuvka garáž', manufacturer: 'Sonoff', model: 'S26R2ZB', areaId: 'garaz', integration: 'zha' },
    { deviceId: 'dev_garaz_vrata', name: 'Ovladač garážových vrat', manufacturer: 'Shelly', model: 'Shelly Plus 1', areaId: 'garaz', integration: 'shelly' },
]

/**
 * Entities: entityId, friendly name, device, optional area override, initial state and attributes.
 */
export const ENTITIES = [
    { entityId: 'light.kotelna_zarovka', name: 'Žárovka kotelna', deviceId: 'dev_kotelna_zarovka', areaId: 'kotelna', state: 'off', attributes: { supported_color_modes: ['onoff'], color_mode: null } },
    { entityId: 'light.obyvak_strop', name: 'Stropní světlo obývák', deviceId: 'dev_obyvak_strop', state: 'on', attributes: { supported_color_modes: ['color_temp'], color_mode: 'color_temp', brightness: 180, color_temp_kelvin: 3000 } },
    { entityId: 'light.kuchyn_linka', name: 'Světlo nad linkou', deviceId: 'dev_kuchyn_linka', state: 'off', attributes: { supported_color_modes: ['brightness'], color_mode: null } },
    { entityId: 'light.chodba', name: 'Světlo chodba', deviceId: 'dev_chodba_svetlo', state: 'off', attributes: { supported_color_modes: ['brightness'], color_mode: null } },
    { entityId: 'switch.kotelna_cerpadlo', name: 'Oběhové čerpadlo', deviceId: 'dev_kotelna_cerpadlo', state: 'on', attributes: { icon: 'mdi:pump' } },
    { entityId: 'switch.garaz_zasuvka', name: 'Zásuvka garáž', deviceId: 'dev_garaz_zasuvka', state: 'off', attributes: {} },
    { entityId: 'cover.garaz_vrata', name: 'Garážová vrata', deviceId: 'dev_garaz_vrata', state: 'closed', attributes: { device_class: 'garage' } },
    { entityId: 'binary_sensor.vchodove_dvere', name: 'Vchodové dveře', deviceId: 'dev_vchodove_dvere', state: 'off', attributes: { device_class: 'door' } },
    { entityId: 'binary_sensor.chodba_pohyb', name: 'Pohyb chodba', deviceId: 'dev_chodba_pohyb', state: 'off', attributes: { device_class: 'motion' } },
    { entityId: 'sensor.kotelna_teplota', name: 'Teplota kotelna', deviceId: 'dev_kotelna_teplomer', state: '21.4', attributes: { device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' } },
    { entityId: 'sensor.obyvak_teplota', name: 'Teplota obývák', deviceId: 'dev_obyvak_senzor', state: '22.8', attributes: { device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' } },
    { entityId: 'sensor.obyvak_vlhkost', name: 'Vlhkost obývák', deviceId: 'dev_obyvak_senzor', state: '46', attributes: { device_class: 'humidity', unit_of_measurement: '%', state_class: 'measurement' } },
    { entityId: 'person.jakub', name: 'Jakub', deviceId: null, state: 'home', attributes: { user_id: 'dev-user-1', device_trackers: [] } },
    { entityId: 'sun.sun', name: 'Slunce', deviceId: null, state: 'below_horizon', attributes: { elevation: -12.5, rising: false } },
    { entityId: 'zone.home', name: 'Domov', deviceId: null, state: '1', attributes: { latitude: 49.8175, longitude: 15.473, radius: 100, icon: 'mdi:home' } },
    { entityId: 'weather.forecast_domov', name: 'Předpověď Domov', deviceId: null, state: 'cloudy', attributes: { temperature: 14.2, humidity: 78, temperature_unit: '°C' } },
]

/** Fake USB serial adapter (CH340) used for Modbus RTU testing. */
export const USB_SERIAL_DEVICE = {
    name: 'ttyUSB0',
    sysfs: '/sys/devices/platform/scb/fd500000.pcie/pci0000:00/0000:00:00.0/0000:01:00.0/usb1/1-1/1-1.3/1-1.3:1.0/ttyUSB0/tty/ttyUSB0',
    dev_path: '/dev/ttyUSB0',
    subsystem: 'tty',
    by_id: '/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0',
    attributes: {
        DEVNAME: '/dev/ttyUSB0',
        ID_BUS: 'usb',
        ID_VENDOR: '1a86',
        ID_VENDOR_ID: '1a86',
        ID_MODEL: 'USB_Serial',
        ID_MODEL_ID: '7523',
        ID_MODEL_FROM_DATABASE: 'CH340 serial converter',
        ID_VENDOR_FROM_DATABASE: 'QinHeng Electronics',
        ID_USB_DRIVER: 'ch341',
        ID_SERIAL: '1a86_USB_Serial',
        SUBSYSTEM: 'tty',
    },
    children: [],
}

export const ADDONS = [
    { name: 'AI automatizace', slug: 'local_ai_automation', description: 'Chat s AI, který upravuje konfiguraci Home Assistantu', version: '0.1.0', version_latest: '0.1.0', state: 'started', repository: 'local', icon: true, logo: true },
    { name: 'File editor', slug: 'core_configurator', description: 'Simple browser-based file editor for Home Assistant', version: '5.8.0', version_latest: '5.8.0', state: 'started', repository: 'core', icon: true, logo: true },
    { name: 'Mosquitto broker', slug: 'core_mosquitto', description: 'An Open Source MQTT broker', version: '6.5.1', version_latest: '6.5.1', state: 'started', repository: 'core', icon: true, logo: true },
    { name: 'Terminal & SSH', slug: 'core_ssh', description: 'Allow logging in remotely to Home Assistant using SSH', version: '9.16.0', version_latest: '9.16.0', state: 'stopped', repository: 'core', icon: true, logo: true },
]

export const SEED_LOG_LINES = [
    'INFO (MainThread) [homeassistant.bootstrap] Home Assistant initialized in 12.34s',
    'INFO (MainThread) [homeassistant.core] Starting Home Assistant',
    'WARNING (MainThread) [homeassistant.components.zha] Device 0x4a21 (Kontakt vchodové dveře) battery low: 12 %',
    'ERROR (MainThread) [homeassistant.components.shelly] Error fetching Shelly Plus 1 data: Timeout',
]
