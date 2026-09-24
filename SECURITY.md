# Security policy

FluxCode currently has one maintained development line: 0.1.x. Security fixes are
made on `main`; there is no long-term-support promise for older builds.

Report vulnerabilities through this repository's **Security → Report a vulnerability**
private reporting flow. Do not put credentials, private source code or exploit
details into a public issue. Include affected versions, reproduction steps,
expected behavior and impact. No response-time SLA is currently offered.

FluxCode runs agents and terminal commands with full access by design. Open only
workspaces and connect only providers you trust. Credentials may be stored in the
operating system credential store; they do not belong in configuration files,
logs, screenshots or issue attachments. Model requests can contain workspace data.

The release installer is currently unsigned. Verify its checksum and source.
See [security review](docs/SECURITY-REVIEW.md) for dependency audit results and
[verification](docs/VERIFICATION.md) for the tested scope and remaining acceptance work.
