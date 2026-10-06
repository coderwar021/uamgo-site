/**
 * Cloudflare published ranges (IPv4 + IPv6). Used so cf-connecting-ip is
 * trusted only when the connecting hop is Cloudflare.
 * Source: https://www.cloudflare.com/ips/ (snapshot 2025-10).
 */
export const CLOUDFLARE_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]

export const CLOUDFLARE_V6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/32',
  '2c0f:f248::/32',
]

/**
 * @param ip dotted IPv4
 * @returns 32-bit int or undefined
 */
function ipv4ToInt(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return undefined
  const nums = parts.map((part) => Number(part))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]
}

/**
 * @param cidr a.b.c.d/n
 * @param ip dotted IPv4
 */
function inV4(cidr, ip) {
  const [net, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  const base = ipv4ToInt(net)
  const value = ipv4ToInt(ip)
  if (base === undefined || value === undefined) return false
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0
  return (base & mask) === (value & mask)
}

/**
 * Expand IPv6 to 8 groups of 16-bit ints.
 * @param ip IPv6 text
 * @returns 8 ints or undefined
 */
function parseV6(ip) {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu)
  if (mapped) return undefined
  const halves = ip.split('::')
  if (halves.length > 2) return undefined
  const fill = (side) => (side.length === 0 ? [] : side.split(':'))
  let groups
  if (halves.length === 1) groups = fill(halves[0])
  else {
    const left = fill(halves[0])
    const right = fill(halves[1])
    const missing = 8 - left.length - right.length
    if (missing < 0) return undefined
    groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  }
  if (groups.length !== 8) return undefined
  const nums = groups.map((g) => Number.parseInt(g, 16))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return undefined
  return nums
}

/**
 * @param cidr v6/n
 * @param ip IPv6 text
 */
function inV6(cidr, ip) {
  const [net, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  const base = parseV6(net)
  const value = parseV6(ip)
  if (base === undefined || value === undefined) return false
  let left = bits
  for (let i = 0; i < 8; i += 1) {
    const take = Math.min(16, left)
    if (take === 0) return true
    const mask = take === 16 ? 0xffff : (~((1 << (16 - take)) - 1)) & 0xffff
    if ((base[i] & mask) !== (value[i] & mask)) return false
    left -= take
  }
  return true
}

/**
 * @param ip client or hop address, may be :ffff: dotted
 * @returns whether the address is in Cloudflare's published ranges
 */
export function isCloudflareIp(ip) {
  const raw = String(ip ?? '').trim().replace(/^::ffff:/iu, '')
  if (raw.length === 0) return false
  if (raw.includes('.')) return CLOUDFLARE_V4.some((cidr) => inV4(cidr, raw))
  return CLOUDFLARE_V6.some((cidr) => inV6(cidr, raw))
}
