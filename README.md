# madecoding.com

Landing pages for madecoding. Railway serves this repository as-is. `PORT` comes from the platform. `madecoding.com/install.sh` redirects to the latest GitHub release asset.

| Path | File |
|---|---|
| `/` | `public/index.html` |
| `/install` | `public/install.html` |
| `/deploy` | `public/deploy.html` |
| `/config` | `public/config.html` |
| `/terms` | `public/terms.html` |

The header brand and the 首页 link always go to `/`. Each service is its own document so a hash on `/` cannot trap the browser on the same path.

## Local check

```sh
npm start
```
