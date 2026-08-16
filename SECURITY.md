# Security Policy

## Supported versions

Only the latest tagged release receives security fixes. The repository is in early public preview; breaking changes may occur between minor versions.

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report privately via GitHub's [private vulnerability reporting](https://github.com/6565dsdsadsde/dsh-anchor/security/advisories/new) (Security → Report a vulnerability). Include:

1. Affected version (tag or commit)
2. Steps to reproduce
3. Impact assessment

We aim to acknowledge within 3 days and publish an advisory after a fix is released.

## Scope

The plugin observes tool executions and writes anchor files. A vulnerability is reportable when an attacker can:

- Make the plugin corrupt or delete files outside the configured anchor root
- Bypass or forge anchor verdicts in a way that hides real environment divergence
- Escalate from anchor observation to blocking tool execution (anchors are observers, not gates)

## Out of scope

- The plugin intentionally does not enforce access control (interception belongs to the official `tools/pre-execute` guard mechanism)
- Self-rescue of ACLs by arbitrary native code in the task (documented boundary; restricted tokens are the official answer)
