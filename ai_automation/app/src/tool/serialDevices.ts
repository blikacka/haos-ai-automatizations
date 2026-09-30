/**
 * Discovery of serial (USB) devices from /dev and sysfs, used by `hardware` and `usb`.
 */
import { execFile } from 'node:child_process'
import {
    readFile,
    readdir,
    readlink,
    realpath,
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** USB identity read from sysfs. */
export interface UsbIdentity {
    vendorId: string | null
    productId: string | null
    manufacturer: string | null
    product: string | null
    serial: string | null
}

/** Serial port with its stable by-id links and USB identity. */
export interface SerialDevice {
    device: string
    byId: string[]
    usb: UsbIdentity | null
    hint: string | null
}

/** Symlink in /dev/serial/by-id and its resolved target. */
export interface SerialLink {
    link: string
    target: string
}

/** One line of `lsusb`. */
export interface LsusbEntry {
    bus: string
    device: string
    id: string
    description: string
}

/** Filesystem locations (overridable for tests). */
export interface SerialPaths {
    devDir: string
    byIdDir: string
    sysClassTty: string
}

export const DEFAULT_SERIAL_PATHS: SerialPaths = {
    devDir: '/dev',
    byIdDir: '/dev/serial/by-id',
    sysClassTty: '/sys/class/tty',
}

const USB_HINTS: Readonly<Record<string, string>> = {
    '1a86:7523': 'QinHeng CH340/CH341 USB-serial – typical for Waveshare and generic USB-RS485 converters (Modbus RTU).',
    '1a86:55d3': 'QinHeng CH343 USB-serial – used by newer Waveshare USB-RS485 converters.',
    '1a86:55d4': 'QinHeng CH9102 USB-serial – used by some USB-RS485 converters and Zigbee dongles (e.g. Sonoff ZBDongle-E).',
    '0403:6001': 'FTDI FT232R USB-serial – common in industrial USB-RS485 converters.',
    '0403:6015': 'FTDI FT-X (FT231X/FT230X) USB-serial.',
    '0403:6010': 'FTDI FT2232 dual USB-serial.',
    '10c4:ea60': 'Silicon Labs CP210x USB-serial – USB-RS485 converters, also Zigbee sticks (Sonoff ZBDongle-P, SkyConnect).',
    '067b:2303': 'Prolific PL2303 USB-serial.',
    '1cf1:0030': 'dresden elektronik ConBee II – Zigbee coordinator (not RS485).',
    '0658:0200': 'Sigma Designs Z-Wave stick (e.g. Aeotec Z-Stick) – not RS485.',
}
const TTY_NAME_PATTERN = /^tty(USB|ACM)\d+$/
const SYSFS_MAX_DEPTH = 6
const LSUSB_TIMEOUT_MS = 5_000

/** Returns a human hint for a USB vendor:product pair. */
export function usbHint(vendorId: string | null, productId: string | null): string | null {
    if (vendorId === null || productId === null) {
        return null
    }
    return USB_HINTS[`${vendorId.toLowerCase()}:${productId.toLowerCase()}`] ?? null
}

/** Lists /dev/serial/by-id symlinks with their absolute targets. */
export async function listSerialById(paths: SerialPaths = DEFAULT_SERIAL_PATHS): Promise<SerialLink[]> {
    const names = await readdir(paths.byIdDir).catch((): string[] => [])
    const links = await Promise.all(names.sort().map(async (name): Promise<SerialLink | null> => {
        const link = path.join(paths.byIdDir, name)
        const target = await readlink(link).catch(() => null)
        return target === null ? null : { link, target: path.resolve(paths.byIdDir, target) }
    }))
    return links.filter((item): item is SerialLink => item !== null)
}

/** Lists ttyUSB* and ttyACM* device names. */
export async function listTtyNames(paths: SerialPaths = DEFAULT_SERIAL_PATHS): Promise<string[]> {
    const names = await readdir(paths.devDir).catch((): string[] => [])
    return names.filter((name) => TTY_NAME_PATTERN.test(name)).sort()
}

async function readSysfsValue(directory: string, name: string): Promise<string | null> {
    const content = await readFile(path.join(directory, name), 'utf8').catch(() => null)
    return content === null ? null : content.trim()
}

/** Reads USB vendor/product info for a tty by walking up from its sysfs device directory. */
export async function readUsbIdentity(ttyName: string, paths: SerialPaths = DEFAULT_SERIAL_PATHS): Promise<UsbIdentity | null> {
    if (!TTY_NAME_PATTERN.test(ttyName)) {
        return null
    }
    let directory = await realpath(path.join(paths.sysClassTty, ttyName, 'device')).catch(() => null)
    for (let depth = 0; directory !== null && depth < SYSFS_MAX_DEPTH; depth += 1) {
        const vendorId = await readSysfsValue(directory, 'idVendor')
        if (vendorId !== null) {
            const [productId, manufacturer, product, serial] = await Promise.all(
                ['idProduct', 'manufacturer', 'product', 'serial'].map((name) => readSysfsValue(directory ?? '', name)),
            )
            return { vendorId, productId: productId ?? null, manufacturer: manufacturer ?? null, product: product ?? null, serial: serial ?? null }
        }
        const parent = path.dirname(directory)
        directory = parent === directory ? null : parent
    }
    return null
}

/** Combines /dev listing, by-id links and sysfs identity into serial device descriptions. */
export async function describeSerialDevices(paths: SerialPaths = DEFAULT_SERIAL_PATHS): Promise<SerialDevice[]> {
    const [links, ttyNames] = await Promise.all([listSerialById(paths), listTtyNames(paths)])
    return Promise.all(ttyNames.map(async (name): Promise<SerialDevice> => {
        const device = path.join(paths.devDir, name)
        const usb = await readUsbIdentity(name, paths)
        return {
            device,
            byId: links.filter((item) => path.basename(item.target) === name).map((item) => item.link),
            usb,
            hint: usb === null ? null : usbHint(usb.vendorId, usb.productId),
        }
    }))
}

/** Parses `lsusb` output lines. */
export function parseLsusb(output: string): LsusbEntry[] {
    const pattern = /^Bus (\d+) Device (\d+): ID ([0-9a-fA-F]{4}:[0-9a-fA-F]{4})\s*(.*)$/
    return output.split('\n').flatMap((line): LsusbEntry[] => {
        const match = pattern.exec(line.trim())
        return match === null
            ? []
            : [{ bus: match[1] ?? '', device: match[2] ?? '', id: (match[3] ?? '').toLowerCase(), description: match[4] ?? '' }]
    })
}

/** Runs `lsusb` (no shell); returns null when unavailable. */
export async function runLsusb(): Promise<LsusbEntry[] | null> {
    try {
        const { stdout } = await execFileAsync('lsusb', [], { timeout: LSUSB_TIMEOUT_MS })
        return parseLsusb(stdout).map((entry) => {
            const [vendorId, productId] = entry.id.split(':')
            const hint = usbHint(vendorId ?? null, productId ?? null)
            return hint === null ? entry : { ...entry, hint }
        })
    } catch {
        return null
    }
}
