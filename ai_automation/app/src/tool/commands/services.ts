/**
 * `services` and `call` commands.
 */
import {
    ToolError,
    asRecord,
    hasFlag,
    parseJsonObject,
    requirePositional,
    type ParsedArgs,
} from '../cli.js'
import { assertServiceAllowed } from '../safety.js'
import {
    assertDomain,
    parseServiceRef,
} from '../validation.js'
import {
    jsonResult,
    type CommandResult,
    type ToolContext,
} from '../types.js'

type ServiceCatalog = Record<string, Record<string, unknown>>

/** `haos-tool services [domain]` */
export async function servicesCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const catalog = await context.client.coreWs<ServiceCatalog>({ type: 'get_services' })
    const domainArg = args.positionals[0]
    if (domainArg === undefined) {
        const domains: Record<string, string[]> = {}
        for (const domain of Object.keys(catalog).sort()) {
            domains[domain] = Object.keys(catalog[domain] ?? {}).sort()
        }
        return jsonResult({ note: 'Use "haos-tool services <domain>" for fields of each service.', domains })
    }
    const domain = assertDomain(domainArg)
    const services = asRecord(catalog[domain])
    if (services === null) {
        throw new ToolError(`Domain "${domain}" has no services (integration not loaded?)`)
    }
    return jsonResult({ domain, services })
}

/** `haos-tool call <domain.service> [json-data] [--return-response]` */
export async function callCommand(args: ParsedArgs, context: ToolContext): Promise<CommandResult> {
    const usage = 'call <domain.service> [json-data]'
    const { domain, service } = parseServiceRef(requirePositional(args, 0, usage))
    assertServiceAllowed(domain, service)
    const data = parseJsonObject(args.positionals[1], 'Service data')
    const query = hasFlag(args, 'return-response') ? '?return_response' : ''
    const result = await context.client.core<unknown>('POST', `/api/services/${domain}/${service}${query}`, data)
    return jsonResult({ called: `${domain}.${service}`, data, result })
}
