# Claude TedLink Plugin

Claude Code plugin that provides the `ted-link` skill for long-running circuit design tasks.

## What's Included

- **`skills/ted-link/SKILL.md`** — Claude skill definition with workflow instructions

## Prerequisites

- Claude Code installed and `claude` available in PATH
- Node.js/npm available for installing the TedLink CLI
- TedLink CLI installed globally:

```bash
npm install -g tedlink-cli
```

For users in China, use the npmmirror registry:

```bash
npm install -g tedlink-cli --registry=https://registry.npmmirror.com
```

- Environment configured for the TedLink client (`TEDLINK_TOKEN`)

The npm package installs the `tedlink` executable. This plugin does not bundle platform-specific `tedlink` or `tedlink-osx` binaries.

## Installation

### Via Marketplace

Register this repository as a Claude Code marketplace, then install the plugin:

```text
/plugin marketplace add https://github.com/ted-team/tedlink
/plugin install tedlink@ted
```

Equivalent CLI commands:

```bash
claude plugin marketplace add https://github.com/ted-team/tedlink
claude plugin install tedlink@ted
```

For users in China, the Gitee mirror is recommended:

```text
/plugin marketplace add https://gitee.com/ted-team/tedlink
/plugin install tedlink@ted
```

Equivalent CLI command:

```bash
claude plugin marketplace add https://gitee.com/ted-team/tedlink
```

For local development, you can use the repository path instead:

```bash
claude plugin marketplace add /path/to/tedlink
```

To update an existing installation:

```bash
claude plugin update tedlink@ted
```

### Manual Install

Copy this directory to your Claude plugin path:

```bash
cp -R tedlink ~/.claude/plugins/tedlink
```

Or copy the skill to a project workspace:

```bash
mkdir -p /your/project/.claude/skills
cp -R tedlink/skills/ted-link /your/project/.claude/skills/
```

## Usage in Claude

### How Claude Discovers the Skill

Claude Code discovers skills from two locations:

1. **Plugin install path** — if installed to `~/.claude/plugins/tedlink/`, the skill is available globally
2. **Project workspace** — if copied to `/your/project/.claude/skills/ted-link/`, the skill is available when working in that project directory

Claude reads `SKILL.md` automatically; no extra configuration is needed after copying the files into place.

### Triggering the Skill

To use the skill, mention `ted-link` or `/tedlink` explicitly in your prompt. Claude will then load `skills/ted-link/SKILL.md` and follow the workflow defined there.

Examples:

```
使用 ted-link skill 帮我设计一个五管运算放大器，要求交付网表、仿真波形和报告。
```

```
/tedlink 设计一个 60dB 增益的 OTA，交付网表和仿真结果。
```

```
Use the ted-link skill to design a 60dB gain OTA and deliver netlist, simulation waveforms, and a report.
```


## Plugin Manifest

See `.claude-plugin/plugin.json`.

## License

MIT
