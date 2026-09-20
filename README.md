# uamgo.com

The public site. It carries the terms of use, the installer, and the release
artifacts; the product itself runs on the user's own machine.

Railway serves this directory alone. Point the service's root directory at
`site/` so the platform stops discovering the workspace packages in the rest of
the repository as separate projects.

## Layout

| Path | Served as | Contents |
|---|---|---|
| `public/index.html` | `/` | Landing page with the install command |
| `public/terms.html` | `/terms` | Terms of use |
| `public/cli/install.sh` | `/cli/install.sh` | POSIX installer, the `curl … \| bash` target |
| `public/cli/install.ps1` | `/cli/install.ps1` | Windows PowerShell installer |

`install.sh` reads `/cli/<channel>` for the version, then downloads
`/cli/uamgo-<version>-<os>-<arch>`.

## Release artifacts

Neither path above is a file here. A binary is nearly 200 MB per platform, too
large for the repository, and this filesystem does not survive a redeploy, so
the server answers both from the newest GitHub release of the private
repository and streams the bytes through. Callers see only uamgo.com; the token
stays in this process. A file staged under `public/cli/` still wins, which is
how a local check pins one artifact.

## Deployment

Two settings, both easy to miss:

- **Root directory `site`.** Pointed at the repository root, the platform
  discovers all 321 workspace packages as separate projects.
- **`UAMGO_RELEASE_TOKEN`.** A token with read access to the private
  repository's releases. Without it the release routes answer 502 and the
  installer cannot resolve a version.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port; the platform sets this |
| `UAMGO_RELEASE_TOKEN` | none | Token used to read releases; `GITHUB_TOKEN` also works |
| `UAMGO_RELEASE_REPO` | `coderwar021/uamgo` | Repository the releases are read from |

## Local check

```sh
cd site && npm start
```
