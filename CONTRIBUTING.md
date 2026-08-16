# Contributing

Thanks for your interest! This project is small and pragmatic — contributions should be verifiable.

## Ways to contribute

1. **Bug reports** — open an issue with: environment (Windows version / Node version), steps to reproduce, and the relevant anchor-tree state (`verdict` files, `intent.json`).
2. **Test-driven fixes** — every behavior change must come with a regression assertion in the `test/` suite.
3. **Platform ports** — the anchor tree protocol itself is cross-platform; the current implementation is Windows-tested. A Linux/macOS port is welcome if it comes with its own real-process tests.

## Rules

- No claims without a test. The README's acceptance numbers must stay true after your change (`npm test` must pass).
- Anchors are observers, not gates — PRs that make the plugin block tool execution will not be merged.
- Keep the moat: no test secrets, no machine-specific paths in committed code.

## Development

```sh
npm install
npm test    # 37 assertions: sampling 10 + plugin-anchor 12 + plugin-adopt 7 + plugin-blind 8
```

Tests run on Windows with real processes (kill -9 adoption, double-blind pollution). Node ≥ 22.5 required.
