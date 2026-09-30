/**
 * `hardware` and `usb` commands.
 */
import type { ParsedArgs } from '../cli.js'
import {
    describeSerialDevices,
    listSerialById,
    runLsusb,
} from '../serialDevices.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

const SERIAL_TIP = 'In HA configuration always prefer the stable /dev/serial/by-id/... path over /dev/ttyUSB0 (numbering may change after reboot).'

/** `haos-tool hardware` – supervisor hardware info plus serial by-id listing. */
export async function hardwareCommand(_args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const [hardware, serialById] = await Promise.all([
        context.client.supervisor<unknown>('GET', '/hardware/info').catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
        })),
        listSerialById(),
    ])
    return jsonResult({ serialById, hardware, tip: SERIAL_TIP })
}

/** `haos-tool usb` – serial devices with by-id links, sysfs vendor/product and lsusb. */
export async function usbCommand(): Promise<CommandResult> {
    const [serialDevices, lsusb] = await Promise.all([describeSerialDevices(), runLsusb()])
    return jsonResult({
        serialDevices,
        lsusb: lsusb ?? 'lsusb not available',
        note: serialDevices.length === 0
            ? 'No /dev/ttyUSB* or /dev/ttyACM* found. Check the add-on has access to the device (uart/usb) and the converter is plugged in.'
            : SERIAL_TIP,
    })
}
