# tedlink-cli

Node.js rewrite of the TedLink CLI client.

Usage:

```bash
./src/main.js --help
```

For the v3.1 `tedlink-server` API:

```bash
export TEDLINK_BASE_URL=http://127.0.0.1:8000
export TEDLINK_AUTH_TOKEN=replace-me
export ANTHROPIC_AUTH_TOKEN=sk-ant-...
export ANTHROPIC_BASE_URL=https://api.anthropic.com
export ANTHROPIC_MODEL=claude-sonnet-4-6
./src/main.js --prompt "run simulation" --dir .
```

When TedLink is used through the skill, Claude must tell the user that `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are sent to the TedLink server, and task execution consumes the user's token through those environment variables. The CLI itself does not prompt for `[y/N]` confirmation.

List locally recorded sessions:

```bash
./src/main.js session list --output json
```

Check TedLink service authentication without printing token values:

```bash
./src/main.js auth status --output json
```

Store an existing TedLink service token:

```bash
./src/main.js auth token --token <TOKEN>
```

Log in or start registration:

```bash
./src/main.js auth login --email <EMAIL>
./src/main.js auth register --email <EMAIL>
```

Clear the stored token:

```bash
./src/main.js auth logout
```

Environment token priority is `TEDLINK_AUTH_TOKEN > TEDLINK_TOKEN`.

Equivalent explicit local all-sessions command:

```bash
./src/main.js session all --output json
```

The client uses:

- `POST /api/v3/session/create`
- `POST /api/v3/execute/chat`
- `POST /api/v3/session/recover`
- `GET /api/v3/sync/download`
