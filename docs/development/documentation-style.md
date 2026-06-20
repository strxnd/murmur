# Documentation Style

Murmur docs are plain Markdown in this repository. Do not introduce a docs site generator without a separate decision.

## Audience

Default to maintainer-first explanations. User setup belongs under [getting started](../getting-started/README.md); implementation details belong under [architecture](../architecture/README.md); stable public surfaces belong under [reference](../reference/README.md).

## Source of Truth

Current code behavior is the source of truth. Avoid roadmap statements and avoid documenting behavior that only exists as an aspiration.

When documenting a subsystem, include:

- Key source files.
- Data flow.
- Failure modes.
- Extension points.

## Diagrams

Use Mermaid fenced code blocks:

````markdown
```mermaid
flowchart TD
  A --> B
```
````

Do not add generated diagram images or screenshots for architecture docs.

## Links

Each page should be linked from its folder `README.md`; folder indexes should be linked from [docs/README.md](../README.md). Prefer relative links.
