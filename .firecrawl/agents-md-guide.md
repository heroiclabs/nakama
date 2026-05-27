# AGENTS.md and SKILL.md: The Complete Guide to Configuring AI Coding Agents

AGENTS.md reduced runtime by 28.6% and token usage by 16.6% across 124 PRs in a controlled study. This guide covers the AGENTS.md specification, SKILL.md for portable agent skills, what to include, real templates, and how both compare to CLAUDE.md and .cursorrules.

March 9, 2026·1 min read

## What AGENTS.md Does

Every AI coding agent starts a task by scanning your repository. It reads file trees, package manifests, READMEs. But READMEs are written for humans. They explain what a project does, not how an agent should work on it.

AGENTS.md fills that gap. It is a markdown file, placed at the root of your repository, that contains the context coding agents need to work effectively: build commands with exact flags, test procedures, code style rules that differ from defaults, architectural constraints, and boundaries (files the agent should never touch).

The format is plain markdown. No required fields. No YAML frontmatter. No special syntax. Write headings and bullet points. The agent parses the text and adjusts its behavior accordingly.

60,000+

GitHub repositories with AGENTS.md

20+

Compatible coding agents

32 KiB

Default size cap (Codex)

The specification is stewarded by the Agentic AI Foundation under the Linux Foundation. It emerged in mid-2025 to solve a real problem: developers were maintaining separate instruction files for each tool (`.cursorrules`, `CLAUDE.md`, `.github/copilot-instructions.md`). AGENTS.md is the cross-tool standard. One file, every agent.

#### Directory Hierarchy

In monorepos, AGENTS.md files can exist at multiple directory levels. The agent reads the nearest file to the file being edited. The closest AGENTS.md takes precedence, so each subproject can ship tailored instructions. OpenAI's own Codex repository uses 88 AGENTS.md files across its directory tree.

## The Research: 28.6% Faster, 16.6% Fewer Tokens

A [study from Princeton researchers](https://arxiv.org/abs/2601.20404) measured the impact of AGENTS.md on real-world coding tasks. They ran OpenAI Codex (gpt-5.2-codex) across 10 repositories and 124 merged pull requests, executing each task twice in isolated Docker environments: once with the repository's AGENTS.md file present, once without.

28.6%

Median runtime reduction

16.6%

Median token reduction

98.6s → 70.3s

Median wall-clock time

2,925 → 2,440

Median output tokens

The mechanism is straightforward. Without AGENTS.md, the agent spends time exploring: reading directory structures, inferring build systems, guessing test commands. With AGENTS.md, that context is provided upfront. The agent skips exploratory steps and works directly toward the solution.

#### Caveats

The study tested only OpenAI Codex on small PRs (under 100 lines changed, 5 or fewer files). A [follow-up study](https://arxiv.org/abs/2602.11988) by different researchers found that LLM-generated AGENTS.md files slightly reduced task success while increasing cost by 23%. Human-written files performed better, improving success by about 4%. The takeaway: a well-written AGENTS.md helps. An auto-generated one full of redundant information can hurt.

## What to Include in AGENTS.md

An analysis of 2,500+ repositories by [GitHub's engineering team](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) identified six categories that consistently improve agent performance. Effective files prioritize copy-pasteable commands over vague tool names, real code snippets over descriptive prose, and explicit boundaries over implicit assumptions.

### Build & Test Commands

Exact commands with flags. 'uv run pytest tests/unit/ -v', not 'run the tests'. Include environment setup, migration scripts, and dev server startup.

### Code Style Rules

Only rules that differ from language defaults. 'Named exports only, no default exports.' 'All async handlers.' Things the agent would get wrong without guidance.

### Project Structure

Map directories to responsibilities. '/src/api/ contains route handlers (thin, delegate to services). /src/services/ contains business logic.' Name technologies with versions.

### Testing Instructions

Test runner, how to run a single test, what to mock and what not to. 'No mocking the database. Use the test database. Factory Boy for test data.'

### Git Workflow

Branch naming conventions, commit message format, PR requirements. 'Squash merge only. Conventional commits: feat:, fix:, chore:, docs:.'

### Boundaries

What the agent should never touch. 'Never modify files in /generated/. Never commit .env files. The /legacy/ module uses sync code; do not convert to async.'

#### A practical AGENTS.md (35 lines)

```
# Invoice API

FastAPI, Python 3.12, PostgreSQL, SQLAlchemy 2.0, Alembic.

## Commands

- `uv run dev`: Dev server (port 8000)
- `uv run pytest tests/ -v`: Full test suite
- `uv run pytest tests/unit/test_handlers.py -v`: Single test file
- `uv run ruff check --fix .`: Lint and auto-fix
- `alembic upgrade head`: Run migrations

## Architecture

- /app/api/v1/       Route handlers (thin, delegate to services)
- /app/services/     Business logic
- /app/models/       SQLAlchemy models
- /app/schemas/      Pydantic v2 request/response schemas
- /app/repositories/ Data access layer (no raw SQL)

## Code Style

- Type hints on all function signatures
- Async handlers by default
- Pydantic v2 models for all request/response shapes
- Named exports from __init__.py, no star imports

## Rules

- Handlers must not contain business logic. Delegate to services.
- All endpoints return { data, error, meta } shape.
- Redis is for caching only, not primary storage.
- Never modify /app/legacy/. It uses sync code intentionally.

## Testing

- pytest-asyncio for async tests
- Factory Boy for test data, never fixtures
- No mocking the database. Use test database.
```

Start with 20 to 30 lines covering the information agents most often get wrong. Add sections based on real agent mistakes, not hypothetical ones.

## What NOT to Include

The follow-up research found that auto-generated AGENTS.md files that duplicated existing README content actually reduced task success. Redundancy is the enemy. Every line should contain information the agent cannot get from reading your code, package manifests, or existing documentation.

| Include | Exclude | Why |
| --- | --- | --- |
| Non-obvious commands with flags | Commands in package.json scripts | Agents already read package.json |
| Rules that differ from defaults | Standard language conventions | Agents know PEP 8 and Prettier defaults |
| Architecture constraints | Full API documentation | Link to docs. Do not embed them. |
| Explicit boundaries | Obvious practices ('write clean code') | Wastes context budget. The agent already tries to. |
| Project-specific gotchas | Information duplicated from README | Redundancy reduces performance (23% cost increase in study) |

Codex enforces a 32 KiB default size limit on AGENTS.md. Content beyond that limit is silently truncated. Even within the limit, shorter files perform better because every line competes for the agent's attention budget.

## AGENTS.md vs CLAUDE.md vs .cursorrules vs copilot-instructions.md

Four tools, four configuration files. They serve the same purpose (giving agents project context) but differ in scope, loading behavior, and features.

| Feature | AGENTS.md | CLAUDE.md | .cursorrules | copilot-instructions.md |
| --- | --- | --- | --- | --- |
| Scope | Cross-tool (20+ agents) | Claude Code only | Cursor only | GitHub Copilot only |
| Format | Plain markdown | Markdown + @imports | Markdown / MDC | Markdown |
| Hierarchy | Nearest file wins | Global + project + subdirectory | Single file + .cursor/rules/ | Single file per repo |
| @imports | No | Yes (5 levels deep) | No | No |
| Local overrides | AGENTS.override.md (Codex) | CLAUDE.local.md | Not built-in | Not built-in |
| Size limit | 32 KiB default (Codex) | ~200 lines recommended | No hard limit | No hard limit |
| Skills integration | SKILL.md (separate standard) | .claude/skills/ built-in | .cursor/ commands | Agent Skills (SKILL.md) |
| Hooks | No | Pre/post tool hooks | No | No |
| Stewardship | Linux Foundation | Anthropic | Cursor Inc. | GitHub / Microsoft |

If you use only one tool, use its native format. If you use multiple tools, put shared instructions in AGENTS.md and tool-specific configuration in the native file. Claude Code reads both AGENTS.md and CLAUDE.md when both are present.

#### 90% overlap

In practice, 90%+ of the content is identical across these files. Build commands, architecture rules, and testing conventions do not change per tool. The differences are in advanced features: CLAUDE.md's @imports, Cursor's MDC frontmatter with glob patterns, and Copilot's agent skills system. A converter tool like [rule-porter](https://dev.to/nedcodes/rule-porter-convert-cursor-rules-to-claudemd-agentsmd-and-copilot-4hjc) can translate between formats.

## Which Tools Support Which Files

| Tool | AGENTS.md | CLAUDE.md | .cursorrules | copilot-instructions.md | SKILL.md |
| --- | --- | --- | --- | --- | --- |
| OpenAI Codex | Yes (primary) | No | No | No | Yes |
| Claude Code | Yes | Yes (primary) | No | No | Yes |
| GitHub Copilot | Yes | No | No | Yes (primary) | Yes |
| Cursor | Yes | No | Yes (primary) | No | Yes |
| Gemini CLI | Yes | No | No | No | No |
| Windsurf | Yes | No | .windsurfrules | No | No |
| Devin | Yes | No | No | No | No |
| Aider | Yes | No | No | No | No |

AGENTS.md has the broadest compatibility. If you maintain one instruction file, make it AGENTS.md. Add CLAUDE.md or `.cursorrules` only if you need features specific to those tools.

## What is SKILL.md

AGENTS.md tells agents about your project. SKILL.md tells agents about a specific capability. A skill is a portable directory containing a `SKILL.md` file plus optional scripts, references, and assets. Skills work across Claude Code, OpenAI Codex, GitHub Copilot, and other compatible agents.

The standard uses progressive disclosure. When a session starts, the agent reads only skill names and descriptions (the YAML frontmatter). When a task matches a skill's domain, the agent loads the full `SKILL.md` body. Supplementary files (scripts, reference docs) load only when the agent needs them. This keeps context lean until the moment detail is required.

#### SKILL.md example: deployment skill

```
---
name: deploy
description: Deploy the application to production or staging environments
---

# Deploy

## Steps

1. Run the test suite: `bun run test`
2. Build for production: `bun run build`
3. Check for TypeScript errors: `bun run typecheck`
4. If all checks pass, deploy:
   - Staging: `vercel deploy --env preview`
   - Production: `vercel deploy --prod`
5. Verify health: `curl -s https://myapp.com/health | jq .status`

## Rules

- Never deploy to production without passing tests
- Always deploy to staging first for new features
- Production deploys require the main branch
```

### SKILL.md vs AGENTS.md

| Aspect | AGENTS.md | SKILL.md |
| --- | --- | --- |
| Purpose | Project context | Reusable task/capability |
| Scope | Repository-wide | Single task or workflow |
| Loading | Always loaded at session start | On-demand when task matches |
| Format | Plain markdown | Markdown with YAML frontmatter |
| Portability | Per-repo | Shareable across projects |
| Invocation | Automatic | Automatic or manual (/skill-name) |

### Skill Directory Structure

#### Skill file layout

```
my-skill/
├── SKILL.md            # Required: instructions + frontmatter
├── scripts/            # Optional: executable scripts
│   └── validate.sh
├── references/         # Optional: reference documentation
│   └── api-spec.yaml
└── assets/             # Optional: images, templates
    └── logo.svg
```

### Where Skills Live

Skills can be stored in multiple locations depending on the tool:

- **Project skills:**`.github/skills/`, `.claude/skills/`, or `.agents/skills/`
- **Personal skills:**`~/.copilot/skills/`, `~/.claude/skills/`, or `~/.agents/skills/`
- **Installable skills:**`npx skills add https://docs-url` (Vercel's skills CLI)

#### SKILL.md Frontmatter

The `name` and `description` fields in SKILL.md frontmatter are critical. The agent decides whether to load a skill based on the description alone. A vague description means the skill never activates. Write descriptions that specify both when the skill applies and when it does not.

## AGENTS.md Templates

Copy the template closest to your stack. Delete lines that do not apply. A shorter, accurate file outperforms a comprehensive, generic one.

### Next.js / React / TypeScript

#### AGENTS.md for a Next.js project

```
# Project Name

Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, Drizzle ORM, Bun.

## Commands

- `bun run dev`: Dev server (port 3000)
- `bun run build`: Production build
- `bun run test`: Vitest suite
- `bunx vitest run src/path/to/test.ts`: Single test file
- `bun run db:push`: Push Drizzle schema changes
- `bun run lint`: ESLint

## Architecture

- /src/app/          App Router pages and layouts
- /src/components/   React components (named exports only)
- /src/lib/          Utilities, DB client, helpers
- /src/lib/db/       Drizzle schema and migrations
- /src/actions/      Server actions (all mutations go here)

## Code Style

- Server Components by default. Client components only for interactivity.
- ES modules (import/export). No CommonJS.
- No default exports except page.tsx and layout.tsx.
- Tailwind for styling. No CSS modules.

## Rules

- Mutations through server actions, not API routes.
- All DB access through Drizzle ORM in server components/actions.
- Run typecheck before committing: bun run typecheck.
- Never commit .env files.
```

### Python / FastAPI

#### AGENTS.md for a Python project

```
# Project Name

FastAPI, Python 3.12, PostgreSQL, SQLAlchemy 2.0, Alembic, uv.

## Commands

- `uv run dev`: Dev server (port 8000)
- `uv run pytest tests/ -v`: Full test suite
- `uv run pytest tests/unit/test_handlers.py::test_create -v`: Single test
- `uv run ruff check --fix .`: Lint
- `alembic upgrade head`: Migrations

## Architecture

- /app/api/v1/       Route handlers (thin, delegate to services)
- /app/services/     Business logic
- /app/models/       SQLAlchemy models
- /app/schemas/      Pydantic v2 schemas
- /app/repositories/ Data access (repository pattern)

## Rules

- Type hints on all functions. Async handlers by default.
- Handlers delegate to services. No business logic in routes.
- All DB access through repositories. No raw SQL.
- Return { data, error } shape from all endpoints.
- Use dependency injection for DB sessions.
- Never modify /app/legacy/. Sync code, intentionally.
```

### Monorepo

#### Root AGENTS.md for a monorepo

```
# Monorepo Name

Turborepo, pnpm workspaces. Frontend (Next.js) + API (Express) + shared packages.

## Commands

- `pnpm dev`: Start all services
- `pnpm build`: Build all packages
- `pnpm test`: Run all tests
- `turbo run test --filter=@app/api`: Test single package

## Structure

- /apps/web/       Next.js frontend (see apps/web/AGENTS.md)
- /apps/api/       Express API (see apps/api/AGENTS.md)
- /packages/ui/    Shared React components
- /packages/db/    Drizzle schema, shared across apps
- /packages/types/ Shared TypeScript types

## Rules

- Shared types in @app/types. Never duplicate type definitions.
- Import shared packages by name: import { Button } from '@app/ui'
- Never use relative paths across package boundaries.
- Each package has its own AGENTS.md for package-specific rules.
- DB schema changes require migrations in both dev and test databases.
```

### SKILL.md Template

#### SKILL.md template

```
---
name: my-skill
description: >
  When to use: [specific trigger condition].
  When NOT to use: [explicit exclusion].
user-invocable: true
disable-model-invocation: false
---

# Skill Name

## Prerequisites

- [Required tools, access, or state]

## Steps

1. [First action with exact command]
2. [Second action]
3. [Verification step]

## Rules

- [Constraint 1]
- [Constraint 2]

## Examples

[One real example showing input and expected output]
```

## FAQ

### Should I use AGENTS.md or CLAUDE.md?

If you use multiple coding agents, use AGENTS.md for shared instructions and CLAUDE.md for Claude-specific features (@imports, skills, hooks). If you only use Claude Code, CLAUDE.md alone is sufficient since it has more features. Claude Code reads both files when both are present. See our [CLAUDE.md guide](https://www.morphllm.com/claude-md-guide) for detailed Claude Code configuration.

### How long should AGENTS.md be?

Start with 20 to 30 lines. The best files from the GitHub analysis of 2,500 repositories were concise and specific. Codex enforces a 32 KiB cap and silently truncates beyond it. Shorter files performed better in the Princeton study because agents spent less time parsing instructions and more time on the task.

### Can I have multiple AGENTS.md files in one repository?

Yes. Nested AGENTS.md files provide directory-specific context. The agent reads the nearest file to the code being edited. Root-level rules apply everywhere; subdirectory rules override for that subtree. OpenAI's Codex repository uses 88 AGENTS.md files across its directory structure.

### Does AGENTS.md replace documentation?

No. AGENTS.md complements your README and docs. It contains agent-specific context that would clutter human documentation: exact test flags, architectural constraints an agent needs to follow, files it should never modify. Keep your README for humans, AGENTS.md for agents.

### Should I auto-generate AGENTS.md?

Be careful. The second research study found that LLM-generated AGENTS.md files reduced success rates by 2% and increased cost by 23%, primarily because they duplicated content already available in the repository. Human-written files that contain genuinely non-obvious information performed better. Use `/init` or a generator as a starting point, then aggressively edit and trim.

### Build Faster with Agent-Native Search

Morph accelerates coding agents with subagent-native search and apply. Your AGENTS.md rules apply across all agents.

[Try Morph Free](https://www.morphllm.com/dashboard) [CLAUDE.md Guide](https://www.morphllm.com/claude-md-guide)