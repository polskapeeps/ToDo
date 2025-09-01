import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
const envPath = path.join(process.cwd(), '.env');
let existing = '';
if (fs.existsSync(envPath)) existing = fs.readFileSync(envPath, 'utf8');

const lines = existing.split(/\r?\n/).filter(Boolean);
const map = Object.fromEntries(lines.map(l => {
  const i = l.indexOf('=');
  if (i < 0) return [l, ''];
  return [l.slice(0, i), l.slice(i+1)];
}));

map.VAPID_PUBLIC_KEY = keys.publicKey;
map.VAPID_PRIVATE_KEY = keys.privateKey;

const out = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('\n');
fs.writeFileSync(envPath, out || `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`, 'utf8');

console.log('Wrote .env with VAPID keys');