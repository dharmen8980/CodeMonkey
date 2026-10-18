const fs = require('fs');
const path = require('path');

// Only these public presentation assets bypass authentication. Application pages,
// APIs, transcripts, and user data remain behind the existing auth gate.
const PUBLIC_UI_ASSETS = new Map([
  ['/brand.css', ['brand.css', 'text/css']],
  ['/shell.js', ['shell.js', 'application/javascript']],
  ['/theme.js', ['theme.js', 'application/javascript']],
  ['/login.css', ['login.css', 'text/css']],
  ['/chat.css', ['chat.css', 'text/css']],
  ['/activity.css', ['activity.css', 'text/css']],
  ...['lato-regular.ttf', 'lato-bold.ttf', 'montserrat-semibold.ttf', 'montserrat-bold.ttf']
    .map(name => [`/assets/fonts/${name}`, [`assets/fonts/${name}`, 'font/ttf']]),
]);
function isPublicUiAsset(url) { return PUBLIC_UI_ASSETS.has(url); }
function handlePublicUiAsset(req, res) {
  const asset = PUBLIC_UI_ASSETS.get(req.url);
  if (!asset) { res.writeHead(404); res.end(); return; }
  const [file, type] = asset;
  const body = fs.readFileSync(path.join(__dirname, '..', file));
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type === 'font/ttf' ? 'public, max-age=86400' : 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
module.exports = { isPublicUiAsset, handlePublicUiAsset };
