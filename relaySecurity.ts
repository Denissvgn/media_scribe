const MAX_RELAY_URL_LENGTH = 2048;

const BLOCKED_RELAY_HOSTNAMES = new Set([
  "100.100.100.200",
  "metadata.google.internal"
]);

const normalizeHostname = (hostname: string) => {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return unbracketed.toLowerCase().replace(/\.+$/, "");
};

const parseIpv4 = (hostname: string): number[] | null => {
  const octets = hostname.split(".");
  if (octets.length !== 4) return null;

  const parsed = octets.map(octet => Number(octet));
  return parsed.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? parsed
    : null;
};

const parseIpv6 = (hostname: string): number[] | null => {
  const halves = hostname.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string) => {
    if (!half) return [];
    const groups = half.split(":");
    if (groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
    return groups.map(group => Number.parseInt(group, 16));
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || "");
  if (!left || !right) return null;

  if (halves.length === 1) return left.length === 8 ? left : null;
  const omittedGroups = 8 - left.length - right.length;
  if (omittedGroups < 1) return null;
  return [...left, ...Array(omittedGroups).fill(0), ...right];
};

export const parseRelayTarget = (value: unknown): URL | null => {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > MAX_RELAY_URL_LENGTH
    || /[\0-\x1F\x7F]/.test(value)
  ) {
    return null;
  }

  try {
    const target = new URL(value);
    if ((target.protocol !== "http:" && target.protocol !== "https:")
      || !target.hostname
      || target.username
      || target.password
    ) {
      return null;
    }
    return target;
  } catch (_) {
    return null;
  }
};

export const isBlockedRelayDestination = (target: URL): boolean => {
  const hostname = normalizeHostname(target.hostname);
  if (BLOCKED_RELAY_HOSTNAMES.has(hostname)) return true;

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return ipv4[0] === 169 && ipv4[1] === 254;

  const ipv6 = parseIpv6(hostname);
  if (!ipv6) return false;

  // IPv6 link-local is fe80::/10 (fe80:: through febf::).
  if ((ipv6[0] & 0xffc0) === 0xfe80) return true;

  // AWS exposes IMDS over this IPv6 unique-local address when enabled.
  const isAwsMetadata = ipv6[0] === 0xfd00
    && ipv6[1] === 0x0ec2
    && ipv6.slice(2, 7).every(group => group === 0)
    && ipv6[7] === 0x0254;
  if (isAwsMetadata) return true;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) must follow the IPv4 policy too.
  const isIpv4Mapped = ipv6.slice(0, 5).every(group => group === 0) && ipv6[5] === 0xffff;
  if (!isIpv4Mapped) return false;
  const mappedIpv4 = [ipv6[6] >> 8, ipv6[6] & 0xff, ipv6[7] >> 8, ipv6[7] & 0xff];
  return mappedIpv4[0] === 169 && mappedIpv4[1] === 254;
};

export const isRelayRedirectStatus = (status: number) => status >= 300 && status < 400;
