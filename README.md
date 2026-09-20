# uamgo.com

The landing page and the terms of use. Two static pages and a small server,
nothing else: the product is installed from npm, so the site distributes
nothing.

Railway serves this repository as-is. There is no root directory to set and no
environment to configure; `PORT` comes from the platform.

| Path | Served as |
|---|---|
| `public/index.html` | `/` |
| `public/terms.html` | `/terms` |

## Local check

```sh
npm start
```
