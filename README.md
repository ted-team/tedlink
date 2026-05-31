# Claude TedLink Plugin

Claude Code plugin that provides the `ted-link` skill for long-running circuit design tasks.

## What's Included

- **`skills/ted-link/SKILL.md`** — Claude skill definition with workflow instructions
- **`skills/ted-link/bin/tedlink`** — TedLink CLI client (Linux x64)
- **`skills/ted-link/bin/tedlink-osx`** — TedLink CLI client (macOS)

## Prerequisites

- Claude Code installed and `claude` available in PATH
- Environment configured for the TedLink client (`TEDLINK_TOKEN`)

## Installation

### Via Marketplace

Install through your Claude Code marketplace if this plugin is registered.

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

UNLICENSED
