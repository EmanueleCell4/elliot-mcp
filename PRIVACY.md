# Privacy policy

Last updated: 22 October 2026

Elliot is an open source tool that runs entirely on your machine, inside your coding agent (Claude Code, Cursor or Codex). It has no server, no account and no telemetry. The author receives no data from you.

## What Elliot reads

- Files in the repository you ask it to check, and that repository's git metadata, read locally.
- The URLs, GitHub repositories, pull requests, commits and npm packages that your agent asks it to verify.

## What Elliot writes

- Receipts in `.elliot/` (or the folder set in `ELLIOT_DIR`) and reports in `elliot-report/`, inside your repository. They stay on your machine unless you commit or share them.

## What Elliot sends, and where

- `verify_url`: one GET request to the URL the agent passes in.
- `verify_github`: requests to `api.github.com` (or the API set in `ELLIOT_GITHUB_API`). If you set a GitHub token (the plugin's optional `github_token` setting or the `GITHUB_TOKEN` env var), it is sent only to that API.
- `verify_npm`: requests to `registry.npmjs.org` (or the registry set in `ELLIOT_NPM_REGISTRY`).

The audit itself (`/elliot-audit`, `/elliot:audit`) makes no network calls. Your agent reads your code the way it normally does, with the model and provider you already use. Their privacy terms apply to that, not this policy.

## GitHub Action

The optional GitHub Action runs in your own CI. It sends the pull request description and the code Claude reads to Anthropic's API under your API key, and posts one comment on the pull request. Elliot's author receives nothing.

## Retention

Elliot keeps nothing outside your repository. Delete `.elliot/` and `elliot-report/` to remove everything it wrote.

## Personal data

Elliot doesn't look for or collect personal data. If your repository contains some, Elliot may quote the lines it checks in the local report, the same way your agent would.

## Contact

Questions: open an issue at https://github.com/EmanueleCell4/elliot-mcp/issues
