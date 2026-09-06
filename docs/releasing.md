# Releasing

This runbook prepares the `@ly028716/dsh-kb-daily` `0.1.0-rc.8` release candidate. GitHub Release creation and npm publication are separate operations. Do not publish to npm unless you have explicit maintainer authorization and the required registry credentials.

```sh
pnpm install --frozen-lockfile
pnpm run verify
pnpm run release:check -- v0.1.0-rc.8
pnpm pack --pack-destination artifacts
git tag -a v0.1.0-rc.8 -m "release: dsh-kb-daily 0.1.0-rc.8"
git push origin main v0.1.0-rc.8
# After reviewing the GitHub Release asset and only with npm publish authority:
npm publish artifacts/ly028716-dsh-kb-daily-0.1.0-rc.8.tgz --access public --provenance
```

Never republish a version. To correct a bad npm release, publish a higher corrective version and deprecate the bad npm version only after maintainer approval.
