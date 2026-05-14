import dns from 'node:dns/promises';
import net from 'node:net';
import { ValidationError } from '../middleware/error.js';

type LookupAddress = { address: string; family: number };

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\.0\.0\.0/,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

export async function validateAndSanitizeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid URL format');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError('Only http and https URLs are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new ValidationError('Private/reserved addresses are not allowed');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ValidationError('Could not resolve hostname');
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new ValidationError('Private/reserved addresses are not allowed');
    }
    if (net.isIPv6(address) && address === '::1') {
      throw new ValidationError('Private/reserved addresses are not allowed');
    }
  }

  return parsed;
}
