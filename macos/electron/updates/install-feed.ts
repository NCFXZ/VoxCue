import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { SignedMacUpdate } from './manifest';

const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
/** Only the already authenticated archive is offered to Sparkle, over an ephemeral loopback feed. */
export async function installFeed(file: string, update: SignedMacUpdate) {
  const token = '/' + randomBytes(32).toString('hex');
  let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' || request.headers.host !== new URL(origin).host) {
      response.writeHead(404).end();
      return;
    }
    if (request.url === token + '/appcast.xml') {
      const feed = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>VoxCue</title><item><title>${xml(update.version)}</title><sparkle:version>${xml(update.version)}</sparkle:version><sparkle:minimumSystemVersion>${xml(update.minimumSystemVersion)}</sparkle:minimumSystemVersion><enclosure url="${origin}${token}/update.zip" length="${update.size}" type="application/octet-stream" sparkle:edSignature="${xml(update.edSignature)}"/></item></channel></rss>`;
      response
        .writeHead(200, {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(feed),
        })
        .end(feed);
    } else if (request.url === token + '/update.zip') {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': update.size,
      });
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } else response.writeHead(404).end();
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Local update feed unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin + token + '/appcast.xml',
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
