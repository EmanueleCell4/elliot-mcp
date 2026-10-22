# Reproducible value example

Run `npm ci` and then `npm run demo` from the repository root. The example creates a disposable Git repository with a privacy promise in its README and a login handler that sends the email to analytics. It starts Elliot through the real MCP stdio transport, submits the claim and exact source evidence, and expects Elliot to verify the citations and record a `FALSE` finding. The temporary project is removed when the run ends.

This demonstrates a documentation-to-code check. It does not make a claim about a deployed service or a production environment.
