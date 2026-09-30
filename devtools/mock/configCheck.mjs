/**
 * Emulation of `POST /api/config/core/check_config` on a real config directory.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
    HaConfigLoader,
    asList,
    asObject,
    findYamlFiles,
} from './haYaml.mjs'

const MAIN_FILE = 'configuration.yaml'
const STANDARD_FILES = ['automations.yaml', 'scripts.yaml', 'scenes.yaml']
const PACKAGES_DIR = 'packages'

/**
 * Loads configuration.yaml plus the standard files and packages (even when not included).
 *
 * @param {string} configDir HA config dir
 * @returns {{ config: Record<string, unknown>, errors: string[] }} resolved config and load errors
 */
export function loadConfig(configDir) {
    const loader = new HaConfigLoader(configDir)
    const mainPath = join(loader.configDir, MAIN_FILE)
    const rawConfig = loader.loadFile(mainPath)
    if (rawConfig !== null && (typeof rawConfig !== 'object' || Array.isArray(rawConfig))) {
        loader.errors.push(`${MAIN_FILE} must contain a mapping at the top level`)
    }
    const standalone = STANDARD_FILES.map((name) => join(loader.configDir, name))
    const packagesDir = join(loader.configDir, PACKAGES_DIR)
    if (existsSync(packagesDir)) {
        standalone.push(...findYamlFiles(packagesDir))
    }
    for (const filePath of standalone) {
        if (existsSync(filePath) && !loader.loadedFiles.has(filePath)) {
            loader.loadFile(filePath)
        }
    }
    return { config: asObject(rawConfig), errors: [...new Set(loader.errors)] }
}

/**
 * Collects all config blocks for a domain: `automation:`, `automation extra:` and packages.
 *
 * @param {Record<string, unknown>} config resolved configuration
 * @param {string} domain integration domain
 * @returns {{ source: string, value: unknown }[]} blocks with a human readable source
 */
export function collectDomainBlocks(config, domain) {
    const keyPattern = new RegExp(`^${domain}(\\s+.+)?$`)
    const blocks = []
    const pushMatching = (section, sourcePrefix) => {
        for (const [key, value] of Object.entries(section)) {
            if (keyPattern.test(key)) {
                blocks.push({ source: `${sourcePrefix}${key}`, value })
            }
        }
    }
    pushMatching(config, '')
    const packages = asObject(asObject(config.homeassistant).packages)
    for (const [packageName, packageConfig] of Object.entries(packages)) {
        pushMatching(asObject(packageConfig), `package ${packageName} > `)
    }
    return blocks
}

/**
 * @param {Record<string, unknown>} config resolved configuration
 * @returns {Record<string, unknown>[]} all automation definitions
 */
export function listAutomations(config) {
    return collectDomainBlocks(config, 'automation')
        .flatMap((block) => asList(block.value))
        .filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
}

/**
 * @param {Record<string, unknown>} config resolved configuration
 * @returns {Record<string, Record<string, unknown>>} scripts keyed by object id
 */
export function listScripts(config) {
    return Object.assign({}, ...collectDomainBlocks(config, 'script').map((block) => asObject(block.value)))
}

/**
 * @param {Record<string, unknown>} automation automation config
 * @param {string} where location description
 * @returns {string[]} validation errors
 */
function validateAutomation(automation, where) {
    if (automation === null || typeof automation !== 'object' || Array.isArray(automation)) {
        return [`Invalid config for 'automation' at ${where}: expected a dictionary`]
    }
    if (automation.use_blueprint !== undefined) {
        return []
    }
    const errors = []
    const triggers = automation.triggers ?? automation.trigger
    const actions = automation.actions ?? automation.action
    if (triggers === undefined || triggers === null) {
        errors.push(`Invalid config for 'automation' at ${where}: required key 'triggers' not provided`)
    } else {
        asList(triggers).forEach((trigger, index) => {
            const valid = trigger !== null && typeof trigger === 'object'
                && (trigger.trigger !== undefined || trigger.platform !== undefined)
            if (!valid) {
                errors.push(`Invalid config for 'automation' at ${where}: triggers[${index}] must contain 'trigger'`)
            }
        })
    }
    if (actions === undefined || actions === null) {
        errors.push(`Invalid config for 'automation' at ${where}: required key 'actions' not provided`)
    }
    return errors
}

/**
 * @param {Record<string, unknown>} config resolved configuration
 * @returns {string[]} automation errors
 */
function validateAutomations(config) {
    return collectDomainBlocks(config, 'automation').flatMap((block) => {
        const items = asList(block.value)
        return items.flatMap((item, index) => {
            const alias = item !== null && typeof item === 'object' && item.alias ? ` '${item.alias}'` : ''
            return validateAutomation(item, `${block.source}, item ${index + 1}${alias}`)
        })
    })
}

/**
 * @param {Record<string, unknown>} config resolved configuration
 * @returns {string[]} script and scene errors
 */
function validateScriptsAndScenes(config) {
    const errors = []
    for (const block of collectDomainBlocks(config, 'script')) {
        if (block.value !== null && (typeof block.value !== 'object' || Array.isArray(block.value))) {
            errors.push(`Invalid config for 'script' at ${block.source}: expected a dictionary`)
            continue
        }
        for (const [scriptId, script] of Object.entries(asObject(block.value))) {
            const scriptConfig = asObject(script)
            if (scriptConfig.sequence === undefined && scriptConfig.use_blueprint === undefined) {
                errors.push(`Invalid config for 'script' at ${block.source} > ${scriptId}: required key 'sequence' not provided`)
            }
        }
    }
    for (const block of collectDomainBlocks(config, 'scene')) {
        asList(block.value).forEach((scene, index) => {
            if (asObject(scene).entities === undefined) {
                errors.push(`Invalid config for 'scene' at ${block.source}, item ${index + 1}: required key 'entities' not provided`)
            }
        })
    }
    return errors
}

/**
 * Validates the HA config dir like `ha core check` would (subset).
 *
 * @param {string} configDir HA config dir
 * @returns {{ result: 'valid' | 'invalid', errors: string | null }} HA check_config response
 */
export function checkConfig(configDir) {
    const { config, errors } = loadConfig(configDir)
    const allErrors = [...errors, ...validateAutomations(config), ...validateScriptsAndScenes(config)]
    if (allErrors.length === 0) {
        return { result: 'valid', errors: null }
    }
    return { result: 'invalid', errors: allErrors.join('\n') }
}
