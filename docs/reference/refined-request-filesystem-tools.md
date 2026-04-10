# Refined Request: Filesystem Tools for NotebookLM Agent

**Date**: 2026-04-11
**Status**: Draft

---

## 1. Objective

Add filesystem management tools to the NotebookLM ADK agent, enabling it to create, read, edit, and delete files and folders. These tools allow the agent to manage local files as part of its workflows — for example, saving downloaded transcripts, organizing research materials, or managing project files.

---

## 2. Scope

### 2.1 In Scope

- **7 new tools**: `create_file`, `read_file`, `edit_file`, `delete_file`, `create_folder`, `delete_folder`, `list_folder`
- **New tool module**: `notebooklm_agent/tools/filesystem-tools.ts`
- **Agent integration**: Register all 7 tools in `agent.ts`, update barrel export in `tools/index.ts`
- **System prompt update**: Add filesystem guidance to `buildInstruction`
- **Documentation updates**: CLAUDE.md, project-design.md, project-functions.md

### 2.2 Out of Scope

- File upload to external services
- Binary file editing
- File permissions management (chmod)
- Watching files for changes
- Compression/archive operations

---

## 3. Tool Specifications

### 3.1 `create_file`

**Description**: Create a new file with the given content at the specified path.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `file_path` | `string` | Yes | Absolute or relative path for the new file |
| `content` | `string` | Yes | Text content to write to the file |
| `overwrite` | `boolean` | No | If true, overwrite existing file. If false or omitted, fail if file exists. |

**Return**: `{ status: 'success', file_path, size_bytes }` or error

**Edge Cases**:
- File already exists and overwrite=false: `{ status: 'error', error: 'File already exists: ...' }`
- Parent directory doesn't exist: Create parent directories recursively
- Invalid path: Return error

### 3.2 `read_file`

**Description**: Read the text content of a file.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `file_path` | `string` | Yes | Path to the file to read |
| `max_chars` | `number` | No | Maximum characters to return. Truncates if exceeded. |

**Return**: `{ status: 'success', content, size_bytes, truncated }` or error

**Edge Cases**:
- File doesn't exist: `{ status: 'not_found', error: 'File not found: ...' }`
- Binary file: Return error suggesting the file may be binary
- Very large file: Truncate to max_chars (default behavior via truncateText)

### 3.3 `edit_file`

**Description**: Edit a file by replacing a specific text string with new content, or append content to the end.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `file_path` | `string` | Yes | Path to the file to edit |
| `old_text` | `string` | No | Text to find and replace. If omitted, append mode. |
| `new_text` | `string` | Yes | Replacement text, or text to append if old_text is omitted |

**Return**: `{ status: 'success', file_path, message }` or error

**Edge Cases**:
- File doesn't exist: `{ status: 'not_found', error: 'File not found: ...' }`
- old_text not found in file: `{ status: 'error', error: 'Text not found in file' }`
- Multiple occurrences: Replace only the first occurrence

### 3.4 `delete_file`

**Description**: Permanently delete a file. The agent should confirm with the user before calling this.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `file_path` | `string` | Yes | Path to the file to delete |

**Return**: `{ status: 'success', message }` or error

**Edge Cases**:
- File doesn't exist: `{ status: 'not_found', error: 'File not found: ...' }`

### 3.5 `create_folder`

**Description**: Create a new folder (and parent directories if needed).

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `folder_path` | `string` | Yes | Path for the new folder |

**Return**: `{ status: 'success', folder_path }` or error

**Edge Cases**:
- Folder already exists: `{ status: 'success', message: 'Folder already exists' }` (idempotent)

### 3.6 `delete_folder`

**Description**: Permanently delete a folder and all its contents. The agent should confirm with the user before calling this.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `folder_path` | `string` | Yes | Path to the folder to delete |
| `recursive` | `boolean` | No | Must be true to delete non-empty folders. Safety guard. |

**Return**: `{ status: 'success', message }` or error

**Edge Cases**:
- Folder doesn't exist: `{ status: 'not_found', error: 'Folder not found: ...' }`
- Non-empty folder without recursive=true: `{ status: 'error', error: 'Folder is not empty. Set recursive=true to delete.' }`

### 3.7 `list_folder`

**Description**: List the contents of a folder.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `folder_path` | `string` | Yes | Path to the folder to list |
| `recursive` | `boolean` | No | If true, list contents recursively |

**Return**: `{ status: 'success', entries: [{name, type, size_bytes}], total_count }` or error

**Edge Cases**:
- Folder doesn't exist: `{ status: 'not_found', error: 'Folder not found: ...' }`
- Empty folder: `{ status: 'success', entries: [], total_count: 0 }`
- Too many entries: Truncate at 200 entries

---

## 4. Integration Requirements

### 4.1 New Files

| File | Purpose |
|------|---------|
| `notebooklm_agent/tools/filesystem-tools.ts` | 7 FunctionTool definitions using Node.js `fs` module |

### 4.2 Modified Files

| File | Change |
|------|--------|
| `notebooklm_agent/tools/index.ts` | Add filesystem tools barrel export |
| `notebooklm_agent/agent.ts` | Import tools, register in tools array, update system prompt |

### 4.3 No New Dependencies

All filesystem operations use Node.js built-in `node:fs` and `node:path` modules.

### 4.4 No New Configuration

No new environment variables needed. File paths are provided by the LLM at call time.

---

## 5. Acceptance Criteria

1. All 7 tools compile: `npx tsc --noEmit` passes
2. Tools are registered: Agent has 53 tools (46 + 7)
3. create_file creates a file and parent directories
4. read_file reads file content with optional truncation
5. edit_file replaces text or appends content
6. delete_file removes a file
7. create_folder creates directories recursively
8. delete_folder removes folders (with recursive safety guard)
9. list_folder lists directory contents
10. Destructive tools (delete_file, delete_folder) have confirmation guidance in system prompt
11. System prompt includes filesystem tools guidance
12. Unit tests exist in test_scripts/
13. Documentation updated (CLAUDE.md, project-design.md, project-functions.md)

---

## 6. Constraints

1. TypeScript only, Node.js built-in modules (`node:fs`, `node:path`)
2. Follow existing FunctionTool patterns (Zod v4 schemas, structured returns)
3. No fallback configuration values
4. Error handling: never throw from execute functions
5. Return format: `{ status: 'success' | 'error' | 'not_found', ... }`
6. Security: Validate paths, prevent directory traversal attacks
