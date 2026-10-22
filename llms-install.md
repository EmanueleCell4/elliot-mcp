# Installing Elliot (for AI agents)

Elliot is a local stdio MCP server (Node.js 20+, git). No account and no API key are needed.

## Cline

Add this to Cline's MCP settings (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "elliot": {
      "command": "npx",
      "args": ["-y", "github:EmanueleCell4/elliot-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Optional: add `"env": { "GITHUB_TOKEN": "<token>" }` to check private GitHub repos with `verify_github`.

## Other agents

- Claude Code, Cursor, Codex: run `npx -y github:EmanueleCell4/elliot-mcp init` in the repository.
- Claude Code plugin: `/plugin install elliot --marketplace EmanueleCell4/elliot-mcp`.

## Check it works

Ask the agent: "Run an Elliot claim audit of this repository." It should call `elliot_audit_start`, follow the protocol it returns, and write a report to `elliot-report/`.
