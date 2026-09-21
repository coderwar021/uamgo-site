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

Checkout uses Waffo Pancake **API Key** auth, not Store Slug. Set `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY` (RSA PEM from the dashboard; `WAFFO_API_KEY` is an alias), and `WAFFO_PRODUCT_ID` (`PROD_…`, or `WAFFO_PRODUCT_GROUP5` / `WAFFO_PRODUCT_GROUP6`). The key is bound to test or prod when you create it — do not send `X-Environment` or `X-Store-Slug`. Optional: `WAFFO_CURRENCY` (default `CNY`), `WAFFO_TAX_CATEGORY` (default `digital_goods`) for the hourly `priceSnapshot`. Without those variables, pay does not open a dead URL.

## Local check

```sh
npm start
```
