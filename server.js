import express from 'express';
import path from 'node:path';
import cors from 'cors';
import dotenv from 'dotenv';
import webpush from 'web-push';
import schedule from 'node-schedule';
import { fileURLToPath } from 'node:url';
import { Subscriptions, Schedules } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());

const PUBLIC_DIR = path.join(process.cwd(), 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// API
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

app.get('/api/vapid-public-key', (_req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint || !sub.keys) {
    return res.status(400).json({ error: 'invalid subscription' });
  }
  const id = Subscriptions.upsert(sub);
  res.json({ id });
});

app.post('/api/schedule', async (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(400).json({ error: 'push not configured' });
  }
  const { subscription_id, task_id, title, body, fire_at } = req.body || {};
  if (!subscription_id || !task_id || !title || !fire_at) {
    return res.status(400).json({ error: 'missing fields' });
  }
  const when = Number(fire_at);
  if (!Number.isFinite(when) || when < Date.now() + 1000) {
    return res.status(400).json({ error: 'fire_at must be in the future' });
  }
  const id = Schedules.insert({ subscription_id, task_id, title, body, fire_at: when });
  const sub = Subscriptions.getById(subscription_id);
  scheduleNotification({ scheduleId: id, sub, title, body, fire_at: when });
  res.json({ id });
});

function scheduleNotification({ scheduleId, sub, title, body, fire_at }) {
  const date = new Date(fire_at);
  schedule.scheduleJob(`schedule_${scheduleId}`, date, async () => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        },
        JSON.stringify({ title, body })
      );
      Schedules.markSent(scheduleId);
    } catch (err) {
      console.error('push error', err?.message);
    }
  });
}

// Re-arm pending schedules on boot
for (const row of Schedules.pending()) {
  const sub = Subscriptions.getById(row.subscription_id);
  if (!sub) continue;
  if (row.fire_at <= Date.now()) continue;
  scheduleNotification({
    scheduleId: row.id,
    sub,
    title: row.title,
    body: row.body,
    fire_at: row.fire_at
  });
}

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`miniminder server on http://${HOST}:${PORT}`);
});