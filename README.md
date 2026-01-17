# 🌳 Branchlet

[![npm version](https://badge.fury.io/js/branchlet.svg)](https://www.npmjs.com/package/branchlet)
[![license](https://img.shields.io/npm/l/branchlet.svg)](https://www.npmjs.com/package/branchlet)

A interactive CLI tool for creating and managing Git worktrees with an easy to use interface.

![Branchlet Demo](assets/branchlet-demo.gif)

## Features

- **Quick Commands**: Jump directly to specific actions via command line
- **Smart Configuration**: Project-specific and global configuration support
- **File Management**: Automatically copy configuration files to new worktrees
- **Post-Create Actions**: Run custom commands after worktree creation

## Installation

```bash
npm install -g branchlet
```

## Quick Start

Run Branchlet in any Git repository:

```bash
branchlet
```

This opens an interactive menu where you can:
- Create new worktrees
- List existing worktrees
- Delete worktrees
- Configure settings

## Commands

### Interactive Menu (Default)
```bash
branchlet
```
Opens the main menu with all available options.

### Direct Commands
```bash
branchlet create           # Go directly to worktree creation
branchlet create feature-x # Quick create worktree with name 'feature-x'
branchlet create feature-x --from main  # Create from specific branch
branchlet -e feature/auth  # Create worktree for existing branch
branchlet list             # List all worktrees
branchlet delete           # Go directly to worktree deletion
branchlet close            # Close current worktree and return to main repo
branchlet prefix john      # Set branch prefix to 'john/'
branchlet prefix --clear   # Clear branch prefix
branchlet settings         # Open settings menu
```

### Options
```bash
branchlet --help              # Show help information
branchlet --version           # Show version number
branchlet -m create           # Set initial mode
branchlet --from <branch>     # Source branch to create worktree from (overrides config)
branchlet -e, --existing <branch>  # Create worktree for an existing branch
```

## Shell Integration

For the best experience, set up shell integration to enable automatic directory switching when creating or selecting worktrees.

### Setup

Run `branchlet` and select **"Setup Shell Integration"** from the menu. This adds a wrapper function and shorthand aliases to your shell config (`~/.zshrc` or `~/.bashrc`).

After setup, reload your shell:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

### Shorthand Aliases

After shell integration, you can use these shortcuts:

| Alias | Command | Description |
|-------|---------|-------------|
| `bl` | `branchlet` | Open interactive menu |
| `blc` | `branchlet create` | Create a new worktree |
| `blc -e <branch>` | `branchlet -e <branch>` | Create worktree for existing branch |
| `bll` | `branchlet list` | List and switch worktrees |
| `blx` | `branchlet close` | Close current worktree |

### Examples with Aliases
```bash
bl                    # Open interactive menu
blc                   # Create worktree interactively
blc feature-auth      # Quick create worktree named 'feature-auth'
blc -e feature/auth   # Create worktree for existing 'feature/auth' branch
bll                   # List worktrees and switch to one
blx                   # Close current worktree and return to main repo
```

## Configuration

Branchlet looks for configuration files in this order:
1. `.branchlet.json` in your repo's root (project-specific)
2. `~/.branchlet/settings.json` (global configuration)

### Configuration Options

Create a `.branchlet.json` file in your project root or configure global settings:

```json
{
  "worktreeCopyPatterns": [".env*", ".vscode/**"],
  "worktreeCopyIgnores": ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  "worktreePathTemplate": "$BASE_PATH.worktree",
  "postCreateCmd": ["npm install", "npm run db:generate"],
  "terminalCommand": "code .",
  "deleteBranchWithWorktree": true,
  "branchPrefix": "feature/",
  "defaultSourceBranch": "main"
}
```

#### Configuration Fields

- **`worktreeCopyPatterns`**: Files/directories to copy to new worktrees (supports glob patterns)
  - Default: `[".env*", ".vscode/**"]`
  - Examples: `["*.json", "config/**", ".env.local"]`

- **`worktreeCopyIgnores`**: Files/directories to exclude when copying (supports glob patterns)
  - Default: `["**/node_modules/**", "**/dist/**", "**/.git/**", "**/Thumbs.db", "**/.DS_Store"]`

- **`worktreePathTemplate`**: Template for worktree directory names
  - Default: `"$BASE_PATH.worktree"`
  - Variables: `$BASE_PATH`, `$WORKTREE_PATH`, `$BRANCH_NAME`, `$SOURCE_BRANCH`
  - Examples: `"worktrees/$BRANCH_NAME"`, `"$BASE_PATH-branches/$BRANCH_NAME"`

- **`postCreateCmd`**: Commands to run after creating a worktree. Runs in the new worktree directory.
  - Default: `[]`
  - Examples: `["npm install"]`, `["pnpm install", "pnpm build"]`
  - Variables supported in commands: `$BASE_PATH`, `$WORKTREE_PATH`, `$BRANCH_NAME`, `$SOURCE_BRANCH`

- **`terminalCommand`**: Command to open terminal/editor in the new worktree. Runs in the new worktree directory.
  - Default: `""`
  - Examples: `"code ."`, `"cursor ."`, `"zed ."`

- **`deleteBranchWithWorktree`**: Whether to also delete the associated git branch when deleting a worktree
  - Default: `false`
  - When enabled, deleting a worktree will also delete its branch (with safety checks)
  - Shows warnings for branches with unpushed commits or uncommitted changes

- **`branchPrefix`**: Prefix to automatically add to new branch names
  - Default: `""`
  - Examples: `"feature/"`, `"john/"`, `"fix/"`
  - When set to `"feature/"`, creating a branch named `auth` will create `feature/auth`

- **`defaultSourceBranch`**: Default branch to create worktrees from
  - Default: `""` (uses current branch)
  - Examples: `"main"`, `"develop"`
  - Can be overridden with `--from` flag: `branchlet create feature-x --from develop`

### Template Variables

Available in `worktreePathTemplate`, `postCreateCmd`, and `terminalCommand`:

- `$BASE_PATH`: Base name of your repository
- `$WORKTREE_PATH`: Full path to the new worktree
- `$BRANCH_NAME`: Name of the new branch
- `$SOURCE_BRANCH`: Name of the source branch

## Usage Examples

### Basic Workflow

1. **Navigate to your Git repository**
   ```bash
   cd my-project
   ```

2. **Start Branchlet**
   ```bash
   branchlet
   ```

3. **Create a worktree**
   - Select "Create new worktree"
   - Enter directory name (e.g., `feature-auth`)
   - Choose source branch (e.g., `main`)
   - Enter new branch name (e.g., `feature/authentication`)
   - Confirm creation

### Project-Specific Configuration

Create `.branchlet.json` in your project:

```json
{
  "worktreeCopyPatterns": [
    ".env.local",
    ".vscode/**",
    "package.json",
    "tsconfig.json"
  ],
  "worktreePathTemplate": "worktrees/$BRANCH_NAME",
  "postCreateCmd": [
    "npm install",
    "npm run db:populate"
  ],
  "terminalCommand": "code .",
  "deleteBranchWithWorktree": true,
  "branchPrefix": "feature/",
  "defaultSourceBranch": "main"
}
```

## Requirements

- Node.js 20.0.0 or higher
- Git installed and available in PATH
- Operating system: macOS, Linux, or Windows

## License

MIT
