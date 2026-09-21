# madecoding.com

Landing pages for madecoding. Railway serves this repository as-is. `PORT` comes from the platform. `madecoding.com/install.sh` redirects to the latest GitHub release asset.

| Path | File |
|---|---|
| `/` | `public/index.html` |
| `/install` | `public/install.html` |
| `/deploy` | `public/deploy.html` |
| `/config` | `public/config.html` |
| `/terms` | `public/terms.html` |
| `/auth/otp` `POST` | `{ email, purpose }` — 向 [Aether](https://mail.uamgo.com/) 发 6 位邮箱验证码 |
| `/auth/register` `POST` | `{ email, password, confirmPassword, name, code }` |
| `/auth/login` `POST` | `{ email, password, code }` |
| `/auth/me` `GET` | `{ email }` or `{ email: null }` |
| `/orders` `POST` | logged-in GPU order → Waffo checkout URL |
| `/webhooks/waffo` `POST` | Waffo `order.completed` (raw body + `X-Waffo-Signature`) |

The header brand and the 首页 link always go to `/`. Login and register live in the top-right control on every page and use **Aether** at [mail.uamgo.com](https://mail.uamgo.com/) for the mailbox (OTP + password). Override the issuer with `AETHER_ORIGIN` (default `https://mail.uamgo.com`). `/deploy` only places an order.

Account records persist in `DATABASE_PATH` (default `data/store.json`). Attach a Railway volume there so redeploys keep users.

Checkout uses `@waffo/pancake-ts` (Merchant API Key). The live merchant is `MER_24yDgYwX9MaPwheVAyCk3d` and the store is `STO_1WjWkflwKXm3BodanakF0J`. Set **`WAFFO_PRIVATE_KEY`** on Railway to the downloaded RSA PEM (escaped `\n` is fine) or **`WAFFO_PRIVATE_KEY_BASE64`**. Do not put the private key in git. Optional: `WAFFO_PRODUCT_GROUP5` / `WAFFO_PRODUCT_GROUP6` if the products already exist; otherwise the first paid order creates one-time products via the SDK and publishes them to prod. `POST /webhooks/waffo` verifies `X-Waffo-Signature` with `verifyWebhook`. The header pay button opens checkout with `window.open(..., "noopener,noreferrer")`.

## Local check

```sh
npm start
```
