const COUNTRY_PREFIX_RE = /^\[([A-Z]{2})\]\s*/i;

const CANADA_CHANNEL_PATTERNS = [
  /\bCanada\b/i,
  /\bCA$/i,
  /^TSN(?:\b|\d|\+)/i,
  /^RDS(?:\b|\d|\s|\+)/i,
  /^Sportsnet(?:\b|\s|\+)/i,
  /^SN\s+(?:World|NOW)\b/i,
  /^CBC(?:\b|\s)/i,
  /^CTV(?:\b|\d|\s)/i,
  /^Citytv\b/i,
  /^Global(?:\s+TV)?\b/i,
  /^TLN\b/i,
  /^OneSoccer\b/i,
  /^CHEK\b/i,
  /^CHCH\b/i,
  /^Crave\b/i,
  /^FOX Sports Racing\b/i,
  /^NBA TV Canada\b/i,
  /^NHL Network Canada\b/i,
];

export function stripCountryPrefix(value) {
  return String(value || '').replace(COUNTRY_PREFIX_RE, '').trim();
}

export function inferChannelCountryCode(value) {
  const original = String(value || '').trim();
  const explicitPrefix = original.match(COUNTRY_PREFIX_RE)?.[1]?.toUpperCase();
  if (explicitPrefix === 'US' || explicitPrefix === 'CA') return explicitPrefix;
  const name = stripCountryPrefix(original);
  return CANADA_CHANNEL_PATTERNS.some((pattern) => pattern.test(name)) ? 'CA' : 'US';
}

export function enrichChannelCountry(channel) {
  const source = channel && typeof channel === 'object' ? channel : { name: channel };
  const name = stripCountryPrefix(source.name || source.displayName || '');
  const countryCode = source.countryCode === 'US' || source.countryCode === 'CA'
    ? source.countryCode
    : inferChannelCountryCode(source.name || source.displayName || '');
  return { ...source, name, countryCode, displayName: name ? `[${countryCode}] ${name}` : '' };
}

export function displayChannelName(channel) {
  return enrichChannelCountry(channel).displayName;
}
