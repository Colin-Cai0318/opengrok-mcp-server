---
name: opengrok
description: Use this skill to search and navigate a remote, indexed OpenGrok codebase.
---

# OpenGrok Web-only Skill

Use only the supported Web/local tool surface. Run `opengrok_index_health` or
`opengrok_list_projects` first when the project is not already known.

## Connection and project selection

For named Android connections, route Android 15 to `opengrok-android-v`, Android
16 to `opengrok-android-w`, and Android 17 to `opengrok-android-x`. If the Android
version or connection is unclear, ask the user to choose; never guess.

Every code query needs an exact non-empty project. If it is not supplied and no
default project is configured, ask the user. Never send `project: ""` or an empty
`projects` array.

## Standard tools

| Goal | Tool |
| --- | --- |
| Search text, definitions, references, or paths | `opengrok_search_code` |
| Find files by glob or name | `opengrok_find_file` |
| Read a file or line range | `opengrok_get_file_content` |
| Browse a project directory | `opengrok_browse_directory` |
| List indexed projects | `opengrok_list_projects` |
| Run 2–5 scoped queries | `opengrok_batch_search` |
| Search and return nearby source | `opengrok_search_and_read` |
| Investigate a symbol and its references | `opengrok_get_symbol_context` |
| Check connectivity | `opengrok_index_health` |
| Read local compile database information | `opengrok_get_compile_info` |
| List symbols in a file | `opengrok_get_file_symbols` |
| Build Web-derived include/import relationships | `opengrok_dependency_map` |

## Code Mode

Call `opengrok_api` once, then use `opengrok_execute`. The sandbox exposes
`search`, `batchSearch`, `getFileContent`, `getSymbolContext`, `getFileSymbols`,
`browseDir`, `findFile`, `getCompileInfo`, `indexHealth`, memory, elicitation and
sampling helpers.

For pagination, call `search` again with `startIndex` equal to the prior
`endIndex`, and stop when `endIndex >= totalCount`. `batchSearch` is not paginated.

## Workflow

1. Resolve Android connection and exact project.
2. Search definitions or text using a non-empty project scope.
3. Use returned `project` and `path` values for file reads and symbols.
4. Read targeted line ranges rather than whole large files.
