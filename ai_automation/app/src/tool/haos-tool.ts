#!/usr/bin/env node
/**
 * haos-tool entry point: `node dist/tool/haos-tool.js <command> [...]`.
 */
import { COMMANDS } from './commands/index.js'
import { createToolContext } from './context.js'
import { runCli } from './runner.js'

process.exitCode = await runCli(process.argv.slice(2), {
    commands: COMMANDS,
    createContext: createToolContext,
    io: {
        stdout: (text) => process.stdout.write(`${text}\n`),
        stderr: (text) => process.stderr.write(`${text}\n`),
    },
})
