// Accept a hostname already extracted by sourceHost, never a page URL or a
// caller-supplied favicon endpoint. Reject IPs and known local/reserved names.
export function sourceFaviconURL(value: string): string | null {
  const host = value.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) ||
    /^\d+$/.test(labels.at(-1)!) ||
    /\.(?:localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid|example|onion)$/.test(host) ||
    host === 'home.arpa' ||
    host.endsWith('.home.arpa')
  )
    return null;
  return `https://a.favicon.im/${host}?throw-error-on-404=true`;
}
