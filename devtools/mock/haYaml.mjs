/**
 * Home Assistant flavoured YAML loader.
 *
 * Supports the HA specific tags (!include, !include_dir_*, !secret, !env_var, !input)
 * and resolves them the same way Home Assistant does, reporting problems as errors.
 */
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs'
import {
    basename,
    dirname,
    join,
    relative,
    resolve,
    sep,
} from 'node:path'
import { parseDocument } from 'yaml'

const HA_TAG_NAMES = [
    '!include',
    '!include_dir_named',
    '!include_dir_merge_named',
    '!include_dir_list',
    '!include_dir_merge_list',
    '!secret',
    '!env_var',
    '!input',
]

const YAML_EXTENSION = '.yaml'
const SECRETS_FILE = 'secrets.yaml'

/** Unresolved HA tag value produced by the YAML parser. */
export class HaTag {
    /**
     * @param {string} tagName tag including the leading "!"
     * @param {unknown} value raw scalar value
     */
    constructor(tagName, value) {
        this.tagName = tagName
        this.value = String(value ?? '').trim()
    }
}

const customTags = HA_TAG_NAMES.map((tagName) => ({
    tag: tagName,
    resolve: (value) => new HaTag(tagName, value),
}))

/**
 * Parses one YAML file keeping HA tags as HaTag instances.
 *
 * @param {string} filePath absolute path
 * @param {string} label path shown in error messages
 * @returns {unknown} parsed JS value (null for empty files)
 * @throws {Error} on syntax errors or unknown tags
 */
export function parseHaYaml(filePath, label) {
    const text = readFileSync(filePath, 'utf8')
    const doc = parseDocument(text, {
        customTags,
        uniqueKeys: false,
        prettyErrors: true,
    })
    const tagProblems = doc.warnings.filter((warning) => warning.code === 'TAG_RESOLVE_FAILED')
    const problems = [...doc.errors, ...tagProblems]
    if (problems.length > 0) {
        throw new Error(`Error loading ${label}: ${problems[0].message.trim()}`)
    }
    return doc.toJS({ maxAliasCount: 1000 }) ?? null
}

/** Loads a config directory and resolves HA tags, collecting errors instead of throwing. */
export class HaConfigLoader {
    /**
     * @param {string} configDir HA configuration directory
     */
    constructor(configDir) {
        this.configDir = resolve(configDir)
        this.errors = []
        this.loadedFiles = new Set()
        this.secrets = null
    }

    /**
     * Loads and fully resolves one YAML file.
     *
     * @param {string} filePath absolute path
     * @returns {unknown} resolved value or null on error
     */
    loadFile(filePath) {
        const absolutePath = resolve(filePath)
        const label = this.label(absolutePath)
        this.loadedFiles.add(absolutePath)
        if (!this.isInside(absolutePath)) {
            this.errors.push(`Refusing to load ${label}: path is outside of the configuration directory`)
            return null
        }
        if (!existsSync(absolutePath)) {
            this.errors.push(`Unable to read file ${label}: file not found`)
            return null
        }
        try {
            const parsed = parseHaYaml(absolutePath, label)
            return this.resolveValue(parsed, dirname(absolutePath))
        } catch (error) {
            this.errors.push(error instanceof Error ? error.message : String(error))
            return null
        }
    }

    /**
     * @param {unknown} value parsed value possibly containing HaTag instances
     * @param {string} baseDir directory of the file the value came from
     * @returns {unknown} resolved value
     */
    resolveValue(value, baseDir) {
        if (value instanceof HaTag) {
            return this.resolveTag(value, baseDir)
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.resolveValue(item, baseDir))
        }
        if (value !== null && typeof value === 'object') {
            const resolved = {}
            for (const [key, item] of Object.entries(value)) {
                resolved[key] = this.resolveValue(item, baseDir)
            }
            return resolved
        }
        return value
    }

    /**
     * @param {HaTag} tag tag to resolve
     * @param {string} baseDir directory of the including file
     * @returns {unknown} resolved value
     */
    resolveTag(tag, baseDir) {
        switch (tag.tagName) {
        case '!include':
            return this.loadFile(join(baseDir, tag.value))
        case '!include_dir_named':
            return this.includeDir(tag, baseDir, (files) => Object.fromEntries(
                files.map((file) => [basename(file, YAML_EXTENSION), this.loadFile(file)]),
            ))
        case '!include_dir_merge_named':
            return this.includeDir(tag, baseDir, (files) => Object.assign(
                {},
                ...files.map((file) => asObject(this.loadFile(file))),
            ))
        case '!include_dir_list':
            return this.includeDir(tag, baseDir, (files) => files.map((file) => this.loadFile(file)))
        case '!include_dir_merge_list':
            return this.includeDir(tag, baseDir, (files) => files.flatMap((file) => asList(this.loadFile(file))))
        case '!secret':
            return this.resolveSecret(tag.value)
        case '!env_var':
            return this.resolveEnvVar(tag.value)
        default:
            return tag.value
        }
    }

    /**
     * @param {HaTag} tag include tag
     * @param {string} baseDir directory of the including file
     * @param {(files: string[]) => unknown} combine builds the result from the file list
     * @returns {unknown} combined value
     */
    includeDir(tag, baseDir, combine) {
        const dirPath = resolve(baseDir, tag.value)
        if (!this.isInside(dirPath)) {
            this.errors.push(`${tag.tagName} ${tag.value}: path is outside of the configuration directory`)
            return null
        }
        if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
            this.errors.push(`${tag.tagName} ${tag.value}: directory ${this.label(dirPath)} not found`)
            return null
        }
        return combine(findYamlFiles(dirPath))
    }

    /**
     * @param {string} key secret name
     * @returns {unknown} secret value or null when missing
     */
    resolveSecret(key) {
        if (this.secrets === null) {
            const secretsPath = join(this.configDir, SECRETS_FILE)
            this.secrets = existsSync(secretsPath) ? asObject(safeParse(secretsPath, SECRETS_FILE, this.errors)) : {}
        }
        if (!Object.hasOwn(this.secrets, key)) {
            this.errors.push(`Secret ${key} not defined`)
            return null
        }
        return this.secrets[key]
    }

    /**
     * @param {string} expression "NAME" or "NAME default"
     * @returns {string | null} environment value
     */
    resolveEnvVar(expression) {
        const [name, ...defaultParts] = expression.split(/\s+/)
        if (process.env[name] !== undefined) {
            return process.env[name]
        }
        if (defaultParts.length > 0) {
            return defaultParts.join(' ')
        }
        this.errors.push(`Environment variable ${name} not defined`)
        return null
    }

    /**
     * @param {string} targetPath absolute path
     * @returns {boolean} true when the path lies inside the config directory
     */
    isInside(targetPath) {
        return targetPath === this.configDir || targetPath.startsWith(this.configDir + sep)
    }

    /**
     * @param {string} absolutePath absolute path
     * @returns {string} path relative to the config dir
     */
    label(absolutePath) {
        return relative(this.configDir, absolutePath) || '.'
    }
}

/**
 * Recursively lists *.yaml files (sorted, hidden entries skipped) like HA does.
 *
 * @param {string} dirPath directory
 * @returns {string[]} absolute file paths
 */
export function findYamlFiles(dirPath) {
    const entries = readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name))
    return entries.flatMap((entry) => {
        const fullPath = join(dirPath, entry.name)
        if (entry.isDirectory()) {
            return findYamlFiles(fullPath)
        }
        return entry.name.endsWith(YAML_EXTENSION) ? [fullPath] : []
    })
}

/**
 * @param {string} filePath absolute path
 * @param {string} label label for errors
 * @param {string[]} errors error sink
 * @returns {unknown} parsed value or null
 */
function safeParse(filePath, label, errors) {
    try {
        return parseHaYaml(filePath, label)
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
        return null
    }
}

/**
 * @param {unknown} value any value
 * @returns {Record<string, unknown>} value when it is a plain object, otherwise {}
 */
export function asObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * @param {unknown} value any value
 * @returns {unknown[]} list form (null -> [], single item -> [item])
 */
export function asList(value) {
    if (value === null || value === undefined) {
        return []
    }
    return Array.isArray(value) ? value : [value]
}
