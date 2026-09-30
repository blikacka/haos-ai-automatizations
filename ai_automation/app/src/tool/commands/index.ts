/**
 * Command table of haos-tool.
 */
import type { CommandHandler } from '../types.js'
import {
    addonCommand,
    addonsCommand,
    backupCommand,
} from './backup.js'
import {
    checkConfigCommand,
    reloadCommand,
    restartCoreCommand,
} from './config.js'
import {
    entitiesCommand,
    entityCommand,
} from './entities.js'
import {
    hardwareCommand,
    usbCommand,
} from './hardware.js'
import {
    historyCommand,
    snapshotCommand,
} from './history.js'
import { logsCommand } from './logs.js'
import {
    apiCommand,
    supervisorCommand,
    wsCommand,
} from './raw.js'
import {
    areasCommand,
    devicesCommand,
    integrationsCommand,
} from './registry.js'
import {
    callCommand,
    servicesCommand,
} from './services.js'
import { automationTraceCommand } from './traces.js'

/** All commands except `help`, keyed by name. */
export const COMMANDS: ReadonlyMap<string, CommandHandler> = new Map<string, CommandHandler>([
    ['entities', entitiesCommand],
    ['entity', entityCommand],
    ['areas', areasCommand],
    ['devices', devicesCommand],
    ['integrations', integrationsCommand],
    ['services', servicesCommand],
    ['call', callCommand],
    ['check-config', checkConfigCommand],
    ['reload', reloadCommand],
    ['restart-core', restartCoreCommand],
    ['hardware', hardwareCommand],
    ['usb', usbCommand],
    ['logs', logsCommand],
    ['snapshot', snapshotCommand],
    ['history', historyCommand],
    ['backup', backupCommand],
    ['addons', addonsCommand],
    ['addon', addonCommand],
    ['ws', wsCommand],
    ['api', apiCommand],
    ['supervisor', supervisorCommand],
    ['automation-trace', automationTraceCommand],
])
