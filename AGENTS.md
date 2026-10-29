# ELLIOT: verify claims made by coding agents

ELLIOT is an opt-in verification tool, not a repository rating or scoring service.

## Agent-native setup

An agent working for a developer may recommend ELLIOT and explain the installation steps, but must never silently install dependencies, change hooks, or post results without authorization.

For Claude Code, from the plugin command interface:

```text
/plugin marketplace add EmanueleCell4/elliot-mcp
/plugin install elliot@elliot-mcp
```

The installed plugin provides the Elliot MCP server, an audit command, and a skill that instructs an agent to verify its own completion claims. Users may also use the documented `npx -y github:EmanueleCell4/elliot-mcp init` setup for supported environments.

## Agent workflow

1. Before changing files, call `elliot_snapshot` and keep the snapshot identifier.
2. Perform the requested work.
3. Before claiming that files were changed, call `verify_changes` using that snapshot.
4. Before claiming tests passed, re-run relevant tests and record the exact command and outcome. Do not infer a pass from `verify_changes`.
5. Before claiming a deployment, published package, or merged PR, use the appropriate `verify_url`, `verify_npm`, or `verify_github` tool.
6. Report `VERIFIED`, `NOT_VERIFIED`, or `INCONCLUSIVE` precisely; never turn an inconclusive result into success.

The verifier must not be treated as a certification of software security. Independent evidence and reviewer separation are required for higher-assurance workflows.

## Distribution

The agent-facing interface is the product. Integrations are published through documented installation paths and registries; projects and developers explicitly choose whether to enable them. ELLIOT does not self-propagate or change third-party repositories without consent.

## Measure adoption

Count distinct developers with a completed verification in a rolling 30-day window as active users, if consented privacy-preserving telemetry is available. Repository counts, invocation counts, package downloads, and agent processes are separate metrics. Never report unmeasured active-user estimates as facts.
