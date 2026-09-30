/**
 * Add-on store emulation (repositories, installable add-ons, installed add-ons).
 */
import { ADDONS } from './seedData.mjs'

const INSTALL_DURATION_MS = 1500
const REPOSITORY_URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~-]+)+\/?$/
const SLUG_PATTERN = /^[a-z0-9_]{1,64}$/

/** Repositories that the mock knows how to "download" (source URL -> repository slug). */
const KNOWN_REPOSITORIES = {
    'https://github.com/zigbee2mqtt/hassio-zigbee2mqtt': '45df7312',
}

const STORE_ADDONS = [
    { name: 'MariaDB', slug: 'core_mariadb', description: 'A SQL database server', version_latest: '2.7.2', repository: 'core' },
    { name: 'Samba share', slug: 'core_samba', description: 'Expose Home Assistant folders with SMB/CIFS', version_latest: '12.5.1', repository: 'core' },
    { name: 'Zigbee2MQTT', slug: '45df7312_zigbee2mqtt', description: 'Use your Zigbee devices without the vendor bridge or gateway', version_latest: '2.6.1', repository: '45df7312' },
    { name: 'Node-RED', slug: 'a0d7b954_nodered', description: 'Flow-based programming for the Internet of Things', version_latest: '19.0.2', repository: 'a0d7b954' },
]

/** Mutable add-on store state. */
export class AddonStore {
    constructor() {
        this.repositories = [
            { slug: 'core', name: 'Official add-ons', source: 'core', url: 'https://home-assistant.io/addons', maintainer: 'Home Assistant' },
            { slug: 'local', name: 'Local add-ons', source: 'local', url: 'https://home-assistant.io/hassio', maintainer: 'you' },
            { slug: 'a0d7b954', name: 'Home Assistant Community Add-ons', source: 'https://github.com/hassio-addons/repository', url: 'https://addons.community', maintainer: 'Franck Nijhof' },
        ]
        this.addons = new Map()
        for (const addon of ADDONS) {
            this.addons.set(addon.slug, { ...addon, installed: true, update_available: false })
        }
        for (const addon of STORE_ADDONS) {
            this.addons.set(addon.slug, { ...addon, version: null, installed: false, state: 'unknown', update_available: false, icon: true, logo: true })
        }
    }

    /** @returns {Record<string, unknown>[]} add-ons visible in the store (known repositories only) */
    storeAddons() {
        const repoSlugs = new Set(this.repositories.map((repository) => repository.slug))
        return [...this.addons.values()].filter((addon) => repoSlugs.has(addon.repository))
    }

    /** @returns {Record<string, unknown>[]} installed add-ons */
    installedAddons() {
        return [...this.addons.values()].filter((addon) => addon.installed)
    }

    /**
     * @param {string} slug add-on slug
     * @returns {Record<string, unknown> | null} add-on info in Supervisor format
     */
    info(slug) {
        const addon = SLUG_PATTERN.test(slug) ? this.addons.get(slug) : undefined
        if (!addon) {
            return null
        }
        return { ...addon, options: {}, boot: 'auto', ingress: addon.slug === 'local_ai_automation', url: null, arch: ['aarch64', 'amd64'] }
    }

    /**
     * @param {string} slug add-on slug
     * @returns {Promise<string | null>} error message or null on success
     */
    async install(slug) {
        const addon = this.storeAddons().find((item) => item.slug === slug)
        if (!addon) {
            return `Add-on ${slug} does not exist in the store`
        }
        if (addon.installed) {
            return `Add-on ${slug} is already installed`
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, INSTALL_DURATION_MS))
        Object.assign(addon, { installed: true, version: addon.version_latest, state: 'stopped' })
        return null
    }

    /**
     * @param {string} slug add-on slug
     * @param {'started' | 'stopped'} state new state
     * @returns {string | null} error message or null on success
     */
    setState(slug, state) {
        const addon = this.addons.get(slug)
        if (!addon || !addon.installed) {
            return `Add-on ${slug} is not installed`
        }
        addon.state = state
        return null
    }

    /**
     * @param {unknown} url repository URL
     * @returns {string | null} error message or null on success
     */
    addRepository(url) {
        if (typeof url !== 'string' || !REPOSITORY_URL_PATTERN.test(url)) {
            return 'Invalid repository URL'
        }
        if (this.repositories.some((repository) => repository.source === url)) {
            return null
        }
        const normalizedUrl = url.replace(/\/$/, '')
        const slug = KNOWN_REPOSITORIES[normalizedUrl] ?? Buffer.from(normalizedUrl).toString('hex').slice(0, 8)
        this.repositories.push({ slug, name: url.split('/').filter(Boolean).pop(), source: url, url, maintainer: 'unknown' })
        return null
    }
}
