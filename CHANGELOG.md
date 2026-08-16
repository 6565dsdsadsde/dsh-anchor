# Changelog

All notable changes to dsh-anchor are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-16

### Added

- EXPERIMENTS.md — experiment ledger: anchor tree protocol, Lucas sampling, 37-assertion suite, P4 handshake fix, Linux run, implementation lessons (EXP-1~EXP-6).
- Platform status in README (Windows 37/37, Linux 37/37, macOS unverified).
- Plugin suite banner.

### Fixed

- P4 double-blind injection race on CI: time-window replaced by filesystem handshake (polluter writes per-step acknowledgements; driver reconciles only after the acknowledgement appears).
- Word hygiene across public files.

## [0.1.0] - 2026-08-15

### Added

- AnchorCore — session anchor protocol (intent+pre commitment, post-action reconciliation, tree recovery, adoption).
- Lucas high-entropy locking + minimum gap 7 sampling.
- Four test suites (P1~P4, 37 assertions).
