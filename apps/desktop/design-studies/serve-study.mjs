// node apps/desktop/design-studies/serve-study.mjs [port] [study.html]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.argv[2] || 3924);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('Invalid port');
const study = process.argv[3] || 'noema-continuity-structures.html';
if (!['noema-continuity-structures.html', 'noema-visual-language.html'].includes(study))
  throw new Error('Unknown study');
const document = new URL(`./${study}`, import.meta.url);
const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!['/', `/${study}`].includes(pathname)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = await readFile(document);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500);
    response.end('Preview unavailable');
  }
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`http://127.0.0.1:${server.address().port}/`),
);
