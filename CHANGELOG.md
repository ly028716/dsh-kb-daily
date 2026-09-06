# Changelog

## 0.1.0-rc.8

### Added

- Runner control service for host-triggered status, immediate runs, and date retries.
- Mock Agent end-to-end coverage and a packed real-DSH smoke test.

### Fixed

- Reject Git revision option injection in `kb_read_diff`.
- Reject symbolic-link or junction traversal at vault/report boundaries.
