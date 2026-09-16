/**
 * CryptoDirect Utility Functions
 * Random ID generation and helper functions
 */

/**
 * Generate a secure random product ID
 * - Length between 12 and 20 characters
 * - Includes lowercase letters, uppercase letters, and numbers
 *
 * @returns {string} Secure random ID
 */
function generateSecureId(minLength = 12, maxLength = 20) {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const allChars = lowercase + uppercase + numbers;

    const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;

    let id = '';
    id += lowercase[Math.floor(Math.random() * lowercase.length)];
    id += uppercase[Math.floor(Math.random() * uppercase.length)];
    id += numbers[Math.floor(Math.random() * numbers.length)];

    for (let i = id.length; i < length; i++) {
        id += allChars[Math.floor(Math.random() * allChars.length)];
    }

    return id.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Escape HTML characters to prevent XSS
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Get URL parameter value
 */
function getUrlParam(param) {
    const params = new URLSearchParams(window.location.search);
    return params.get(param);
}

/**
 * Format price to USD currency
 */
function formatPrice(price) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(price);
}

/**
 * Shorten a wallet address / tx hash for display
 */
function shortAddress(address, head = 6, tail = 4) {
    if (!address) return '';
    if (address.length <= head + tail + 3) return address;
    return address.substring(0, head) + '...' + address.substring(address.length - tail);
}

/**
 * Validate USDT TRC20 address
 */
function isValidTrc20Address(address) {
    if (typeof address !== 'string') return false;
    return address.startsWith('T') && address.length === 34 && /^[1-9A-HJ-NP-Z]+$/.test(address);
}

/**
 * Sort products by creation date (newest first)
 */
function sortProductsByDate(productsData) {
    const productsArray = Object.entries(productsData).map(([id, product]) => ({
        id,
        ...product
    }));

    return productsArray.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at || 0);
        const dateB = new Date(b.createdAt || b.created_at || 0);
        return dateB - dateA;
    });
}

/**
 * Log payment attempt (for debugging/analytics)
 */
function logPayment(paymentData) {
    const log = {
        timestamp: new Date().toISOString(),
        ...paymentData
    };
    console.log('Payment logged:', log);
}
