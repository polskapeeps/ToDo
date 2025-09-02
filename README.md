# miniminder

Minimal, phone-friendly todo and reminder PWA. Offline-first. Optional push reminders via Web Push.
No accounts by default. Local IndexedDB storage. Server only handles push scheduling.

## Quick start

1. Install Node 18+
2. `npm install`
3. Generate VAPID keys for push (optional, only if you want background reminders):
   ```sh
   npm run vapid
   # This writes a .env with VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
   ```
4. Start
   ```sh
   npm start
   # opens on http://localhost:8080
   ```

## Notes

- Local reminders fire while the app is open or recently active. For background delivery use push with VAPID keys.
- iOS and Android support web push only for installed PWAs and with user permission.
- Data stays on-device unless you add your own sync.

## Deploy

Any Node host works. The server serves static files from ./public and exposes /api for push.
Use a reverse proxy for TLS.

### Serverless (Netlify)

For a lightweight deployment, a Netlify Function is provided in `netlify/functions/api.js`.
It handles `/api/subscribe` and `/api/schedule` and can be used instead of the Node server.

1. Deploy the static site from the `public/` directory.
2. Include the provided `netlify.toml` so requests to `/api/*` are routed to the function.
3. Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` environment variables in your Netlify project.

The client uses relative `/api` URLs, so when the function and static site share a domain,
the app automatically points to the serverless endpoint.

## Structure

- `public/` client app, PWA assets
- `server.js` Express static server + push API
- `db.js` SQLite helpers for subscriptions and schedules
- `scripts/gen-vapid.js` creates .env with VAPID keys

## License

MIT