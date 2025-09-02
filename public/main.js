'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const state = {
  filter: 'all',
  subId: null,
  timeouts: new Map()
};

// IndexedDB minimal helper
const DB_NAME = 'miniminder';
const DB_VERSION = 1;
let dbp;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore('tasks', { keyPath: 'id' });
      store.createIndex('completed', 'completed');
      store.createIndex('dueAt', 'dueAt');
      store.createIndex('remindAt', 'remindAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    tx.oncomplete = () => resolve(req?.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
const store = {
  async all() {
    return tx('tasks', 'readonly', s => s.getAll());
  },
  async put(task) {
    return tx('tasks', 'readwrite', s => s.put(task));
  },
  async delete(id) {
    return tx('tasks', 'readwrite', s => s.delete(id));
  }
};

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = x => String(x).padStart(2, '0');
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `today ${t}`;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `${days[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${t}`;
}

async function render() {
  const list = $('#task-list');
  const empty = $('#empty');
  list.innerHTML = '';
  const tasks = await store.all();
  const now = Date.now();

  const filtered = tasks.filter(t => {
    if (state.filter === 'today') {
      if (!t.dueAt) return false;
      const d = new Date(t.dueAt);
      const n = new Date();
      return d.toDateString() === n.toDateString();
    }
    if (state.filter === 'upcoming') {
      return t.dueAt && t.dueAt > now && !t.completed;
    }
    if (state.filter === 'done') return t.completed;
    return true;
  }).sort((a, b) => {
    const ad = a.completed ? 1 : 0;
    const bd = b.completed ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return (a.dueAt || Infinity) - (b.dueAt || Infinity);
  });

  empty.hidden = filtered.length > 0;

  for (const t of filtered) {
    const tpl = document.getElementById('task-item-tpl');
    const node = tpl.content.cloneNode(true);
    const li = node.querySelector('li');
    const title = node.querySelector('.title');
    const whenEl = node.querySelector('.when');
    const toggle = node.querySelector('.toggle');
    const del = node.querySelector('.delete');
    const snooze = node.querySelector('.snooze');

    title.textContent = t.title;
    whenEl.textContent = t.remindAt ? `remind ${fmtWhen(t.remindAt)}` : (t.dueAt ? `due ${fmtWhen(t.dueAt)}` : '');
    toggle.checked = !!t.completed;

    toggle.addEventListener('change', async () => {
      t.completed = toggle.checked;
      t.updatedAt = Date.now();
      await store.put(t);
      cancelLocalReminder(t.id);
      if (!t.completed) scheduleLocalReminder(t);
      render();
    });

    del.addEventListener('click', async () => {
      await store.delete(t.id);
      cancelLocalReminder(t.id);
      render();
    });

    snooze.addEventListener('click', async () => {
      const now = Date.now();
      const newTime = Math.max((t.remindAt || t.dueAt || now), now) + 10 * 60 * 1000;
      t.remindAt = newTime;
      t.updatedAt = Date.now();
      await store.put(t);
      schedule(t);
      render();
    });

    list.appendChild(node);
  }
}

function cancelLocalReminder(id) {
  const h = state.timeouts.get(id);
  if (h) {
    clearTimeout(h);
    state.timeouts.delete(id);
  }
}

function scheduleLocalReminder(t) {
  cancelLocalReminder(t.id);
  if (!t.remindAt || t.completed) return;
  const delta = t.remindAt - Date.now();
  // Avoid very long timeouts
  const MAX = 2_147_000_000;
  if (delta <= 0 || delta > MAX) return;
  const h = setTimeout(() => {
    notify(t.title, 'Reminder');
    state.timeouts.delete(t.id);
  }, delta);
  state.timeouts.set(t.id, h);
}

async function notify(title, body) {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/' }
    });
  } catch {
    if (Notification.permission === 'granted') new Notification(title, { body });
  }
}

async function ensureSW() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      return reg;
    } catch (err) {
      console.error('sw fail', err);
    }
  }
  return null;
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return alert('Notifications blocked');
  const reg = await ensureSW();
  if (!reg) return alert('No service worker');
  // Fetch server public key
  const res = await fetch('/api/vapid-public-key').then(r => r.json()).catch(() => ({ key: '' }));
  const pub = res?.key || '';
  if (!pub) {
    alert('Push not configured on server. Local reminders only.');
    return;
  }
  const key = urlBase64ToUint8Array(pub);
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key
  });
  const out = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub)
  }).then(r => r.json());
  state.subId = out.id;
  localStorage.setItem('miniminder_sub_id', String(state.subId));
  alert('Push enabled');
  updateNotifyButton();
}

async function disablePush() {
  const reg = await ensureSW();
  if (reg) {
    try {
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {}
  }
  state.subId = null;
  localStorage.removeItem('miniminder_sub_id');
  alert('Push disabled');
  updateNotifyButton();
}

async function updateNotifyButton() {
  const btn = $('#btn-notify');
  const reg = await ensureSW();
  const sub = await reg?.pushManager.getSubscription();
  const storedId = Number(localStorage.getItem('miniminder_sub_id') || '0');
  if (sub) {
    state.subId = storedId || null;
  } else {
    state.subId = null;
    localStorage.removeItem('miniminder_sub_id');
  }
  const hasSub = Notification.permission === 'granted' && !!sub && !!state.subId;
  if (hasSub) {
    btn.textContent = 'Disable notifications';
    btn.title = 'Disable notifications';
    btn.onclick = disablePush;
  } else {
    btn.textContent = 'Enable notifications';
    btn.title = 'Enable notifications';
    btn.onclick = enablePush;
  }
}

function urlBase64ToUint8Array(base64String) {
  // standard conversion
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// forms and UI
$('#new-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#task-title').value.trim();
  if (!title) return;
  const whenVal = $('#task-when').value;
  const dueAt = whenVal ? new Date(whenVal).getTime() : null;
  const remindAt = dueAt; // simple default
  const t = {
    id: crypto.randomUUID(),
    title,
    dueAt,
    remindAt,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await store.put(t);
  $('#task-title').value = '';
  $('#task-when').value = '';
  schedule(t);
  render();
});

$$('.filters .chip').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.filters .chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    render();
  });
});

// install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const b = $('#btn-install');
  b.hidden = false;
  b.onclick = async () => {
    b.hidden = true;
    await deferredPrompt.prompt();
    deferredPrompt = null;
  };
});

async function schedule(t) {
  // local immediate schedule
  scheduleLocalReminder(t);
  // server schedule if enabled
  const subId = state.subId || Number(localStorage.getItem('miniminder_sub_id') || '0');
  if (subId && t.remindAt && t.remindAt > Date.now()) {
    try {
      await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subscription_id: subId,
          task_id: t.id,
          title: t.title,
          body: 'Reminder',
          fire_at: t.remindAt
        })
      });
    } catch {}
  }
}

async function boot() {
  await ensureSW();
  const tasks = await store.all();
  for (const t of tasks) scheduleLocalReminder(t);
  await updateNotifyButton();
  render();
}
boot();
