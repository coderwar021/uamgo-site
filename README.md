# madecoding.com

Landing pages for madecoding. Railway serves this repository as-is. `PORT` comes from the platform. `madecoding.com/install.sh` redirects to the latest GitHub release asset.

| Path | File |
|---|---|
| `/` | `public/index.html` |
| `/install` | `public/install.html` |
| `/deploy` | `public/deploy.html` |
| `/config` | `public/config.html` |
| `/terms` | `public/terms.html` |
| `/auth/register` `POST` | JSON `{ email, password }` — 密码至少 8 位，写入 `data/store.json` 并设置 `session` cookie |
| `/auth/login` `POST` | same |
| `/auth/me` `GET` | `{ email }` or `{ email: null }` |
| `/auth/logout` `POST` | clears cookie |

The header brand and the 首页 link always go to `/`. Login and register live in the top-right control on every page. `/deploy` only places an order.

Account records persist in `DATABASE_PATH` (default `data/store.json`). Attach a Railway volume there so redeploys keep users.

Checkout stays on this host until Waffo is configured. Set `WAFFO_STORE_SLUG` and `WAFFO_PRODUCT_ID` (or `WAFFO_PRODUCT_GROUP5` / `WAFFO_PRODUCT_GROUP6`). Optional: `WAFFO_ENVIRONMENT` (`test` or `prod`, default `prod`), `WAFFO_CURRENCY` (default `CNY`). Without those variables, pay does not open a dead URL.

## Local check

```sh
npm start
```
