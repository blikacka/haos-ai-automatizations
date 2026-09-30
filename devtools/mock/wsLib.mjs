/**
 * Loads the `ws` package from the add-on app (single source of the dependency).
 */
import { createRequire } from 'node:module'

const appRequire = createRequire(new URL('../../ai_automation/app/package.json', import.meta.url))

/** @type {typeof import('ws')} */
const wsModule = appRequire('ws')

export const { WebSocket, WebSocketServer } = wsModule
