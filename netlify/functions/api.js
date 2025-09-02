import webpush from 'web-push';
import schedule from 'node-schedule';
import { Subscriptions, Schedules } from '../../db.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export async function handler(event) {
  const { httpMethod, path } = event;
  const payload = event.body ? JSON.parse(event.body) : null;

  if (path.endsWith('/subscribe') && httpMethod === 'POST') {
    const sub = payload;
    if (!sub || !sub.endpoint || !sub.keys) {
      return jsonResponse(400, { error: 'invalid subscription' });
    }
    const id = Subscriptions.upsert(sub);
    return jsonResponse(200, { id });
  }

  if (path.endsWith('/schedule') && httpMethod === 'POST') {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return jsonResponse(400, { error: 'push not configured' });
    }
    const { subscription_id, task_id, title, body, fire_at } = payload || {};
    if (!subscription_id || !task_id || !title || !fire_at) {
      return jsonResponse(400, { error: 'missing fields' });
    }
    const when = Number(fire_at);
    if (!Number.isFinite(when) || when < Date.now() + 1000) {
      return jsonResponse(400, { error: 'fire_at must be in the future' });
    }
    const id = Schedules.insert({ subscription_id, task_id, title, body, fire_at: when });
    const sub = Subscriptions.getById(subscription_id);
    scheduleNotification({ scheduleId: id, sub, title, body, fire_at: when });
    return jsonResponse(200, { id });
  }

  return { statusCode: 404, body: 'Not found' };
}

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

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
