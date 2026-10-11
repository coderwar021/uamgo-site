# madecoding.com

Landing pages for madecoding. Railway serves this repository as-is. `PORT` comes from the platform. `madecoding.com/install.sh` redirects to the latest GitHub release asset.

| Path | File |
|---|---|
| `/` | `public/index.html` |
| `/install` | `public/install.html` |
| `/deploy` | `public/deploy.html` |
| `/config` | `public/config.html` |
| `/terms` | `public/terms.html` |
| `/auth/register` `POST` | `{ email, password }` → session cookies |
| `/auth/login` `POST` | `{ email, password }` → session cookies |
| `/auth/me` `GET` | `{ email }` or `{ email: null }` |
| `/orders` `POST` | logged-in GPU order → Waffo checkout URL |
| `/webhooks/waffo` `POST` | Waffo `order.completed` (raw body + `X-Waffo-Signature`) |

The header brand and the 首页 link always go to `/`. The top-right 登录 button opens email-and-password register or login. Passwords are scrypt-hashed in the encrypted account store. `/deploy` only places an order.

## Railway environment (no code defaults for secrets)

Set these on Railway.

- `PUBLIC_ORIGIN=https://madecoding.com`
- `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_BASE64`
- `STORE_KEY` — 32-byte hex (64 hex characters). Production (including Railway) refuses to start without it. `STORE_KEY_PREVIOUS` decrypts the last generation; writes always use the current key as `enc.v2.<id>.`.
- `RENTAL_SITE_KEY` — HMAC secret the site uses to sign `/orders` (and `RENTAL_SITE_KEY_NEXT` while rotating)
- `RENTAL_ORIGIN` — default `https://gateway.madecoding.com`

Account records persist in `DATABASE_PATH`; without it they go to `store.json` on the attached Railway volume (`RAILWAY_VOLUME_MOUNT_PATH`), else `data/store.json`. Production mounts a volume at `/app/data`; on Railway the server refuses to start when the store is outside the volume, and treats the deployment as production (STORE_KEY required) even without `NODE_ENV`. With `STORE_KEY` the file is AES-256-GCM (`enc.v2.<keyId>.`) mode `0600`.

Checkout uses `@waffo/pancake-ts` (Merchant API Key). The live merchant is `MER_24yDgYwX9MaPwheVAyCk3d` and the store is `STO_1WjWkflwKXm3BodanakF0J`. Set **`WAFFO_PRIVATE_KEY`** on Railway to the downloaded RSA PEM (escaped `\n` is fine) or **`WAFFO_PRIVATE_KEY_BASE64`**. Do not put the private key in git. Optional: `WAFFO_PRODUCT_GROUP5` / `WAFFO_PRODUCT_GROUP6` if the products already exist; otherwise the first paid order creates one-time products via the SDK and publishes them to prod. `POST /webhooks/waffo` verifies `X-Waffo-Signature` with `verifyWebhook`, then forwards the same body to the GPU gateway so it can open the server. The header pay button opens checkout with `window.open(..., "noopener,noreferrer")`.

## Local check

```sh
npm start
```
