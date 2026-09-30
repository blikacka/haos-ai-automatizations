/**
 * Copies text to the clipboard, falling back to a hidden textarea when the async API is unavailable
 * (e.g. insecure context inside an iframe).
 */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch {
        // fall through to the legacy approach
    }
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let copied = false
    try {
        copied = document.execCommand('copy')
    } catch {
        copied = false
    }
    area.remove()
    return copied
}
