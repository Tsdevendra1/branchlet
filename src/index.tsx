#!/usr/bin/env node
import { render } from "ink"
import minimist from "minimist"
import packageJson from "../package.json" with { type: "json" }
import { App } from "./components/app.js"
import { MESSAGES } from "./constants/index.js"
import { headlessCreate, headlessDelete, headlessList } from "./headless.js"
import type { AppMode } from "./types/index.js"

const VERSION = packageJson.version
const ORIGINAL_CWD = process.cwd()

function parseArguments(): { mode: AppMode; help: boolean; isFromWrapper: boolean; headless: boolean; force: boolean; json: boolean; quickCreateName?: string | undefined; deleteTarget?: string | undefined; prefixArg?: string | undefined; clearPrefix?: boolean; fromBranch?: string | undefined; existingBranch?: string | undefined } {
  const argv = minimist(process.argv.slice(2), {
    string: ["mode", "from", "existing"],
    boolean: ["help", "version", "from-wrapper", "clear", "headless", "force", "json"],
    alias: {
      h: "help",
      v: "version",
      m: "mode",
      e: "existing",
    },
  })

  if (argv.help) {
    return { mode: "menu", help: true, isFromWrapper: false, headless: false, force: false, json: false }
  }

  if (argv.version) {
    console.log(`Branchlet v${VERSION}`)
    process.exit(0)
  }

  const validModes: AppMode[] = ["menu", "create", "list", "delete", "settings", "close", "prefix"]
  let mode: AppMode = "menu"
  let quickCreateName: string | undefined
  let deleteTarget: string | undefined
  let prefixArg: string | undefined
  let clearPrefix: boolean = false
  const fromBranch: string | undefined = argv.from ? String(argv.from) : undefined
  const existingBranch: string | undefined = argv.existing ? String(argv.existing) : undefined

  // If --existing is provided, auto-set mode to create
  if (existingBranch) {
    mode = "create"
  }

  if (argv.mode && validModes.includes(argv.mode as AppMode)) {
    mode = argv.mode as AppMode
  }

  if (argv._.length > 0) {
    const command = argv._[0]
    if (validModes.includes(command as AppMode)) {
      mode = command as AppMode
    }

    // If mode is "create" and there's a second positional arg, use it as quick create name
    if (mode === "create" && argv._.length > 1) {
      quickCreateName = String(argv._[1])
    }

    // If mode is "delete" and there's a second positional arg, use it as the delete target
    if (mode === "delete" && argv._.length > 1) {
      deleteTarget = String(argv._[1])
    }

    // If mode is "prefix" and there's a second positional arg, use it as prefix value
    if (mode === "prefix" && argv._.length > 1) {
      prefixArg = String(argv._[1])
    }
  }

  // Handle --clear flag for prefix command
  if (mode === "prefix" && argv.clear === true) {
    clearPrefix = true
  }

  const isFromWrapper = argv["from-wrapper"] === true
  const headless = argv.headless === true
  const force = argv.force === true
  const json = argv.json === true

  return { mode, help: false, isFromWrapper, headless, force, json, quickCreateName, deleteTarget, prefixArg, clearPrefix, fromBranch, existingBranch }
}

function showHelp(): void {
  console.log(`
${MESSAGES.WELCOME}

Usage:
  branchlet [command] [options]

Commands:
  create [name]  Create a new worktree (interactive if no name given)
  list           List all worktrees
  delete [name]  Delete a worktree (by branch name or path in headless mode)
  close          Close current worktree and return to main repo
  prefix [name]  Set branch prefix (e.g., 'john' creates 'john/' prefix)
  settings       Manage configuration
  (no command)   Start interactive menu

Options:
  -h, --help             Show this help message
  -v, --version          Show version number
  -m, --mode             Set initial mode
  --from <branch>        Source branch to create worktree from (overrides config)
  -e, --existing <branch>  Create worktree for an existing branch
  --from-wrapper         Called from shell wrapper (outputs path to stdout)
  --headless             Run without the interactive UI (auto-enabled when stdin
                         is not a TTY). Supports create/delete/list.
  --force                With headless delete: delete even with uncommitted changes
  --json                 With headless list: output JSON

Examples:
  branchlet                    # Start interactive menu
  branchlet create             # Go directly to create worktree flow
  branchlet create feature-x   # Quick create worktree with name 'feature-x'
  branchlet create feature-x --from main  # Create from 'main' branch
  branchlet -e feature/my-branch  # Create worktree for existing branch
  branchlet list               # List all worktrees
  branchlet prefix john        # Set branch prefix to 'john/'
  branchlet prefix --clear     # Clear branch prefix
  branchlet --from-wrapper     # Used by shell wrapper to enable directory switching
  branchlet delete             # Go directly to delete worktree flow
  branchlet settings           # Open settings menu

Shell Integration:
  Run 'branchlet' and select "Setup Shell Integration" to enable quick directory switching.
  After setup, just run 'branchlet' to quickly change to any worktree directory.

  Shorthand aliases (after shell integration):
    bl     branchlet         # Open interactive menu
    blc    branchlet create  # Create a new worktree
    blc -e <branch>          # Create worktree for existing branch
    bll    branchlet list    # List and switch worktrees
    blx    branchlet close   # Close current worktree

Configuration:
  The tool looks for configuration files in the following order:
  1. .branchlet.json in current directory
  2. ~/.branchlet/settings.json (global config)

For more information, visit: https://github.com/raghavpillai/git-worktree-manager
`)
}

async function main(): Promise<void> {
  const { mode, help, isFromWrapper, headless, force, json, quickCreateName, deleteTarget, prefixArg, clearPrefix, fromBranch, existingBranch } = parseArguments()

  if (help) {
    showHelp()
    process.exit(0)
  }

  // Headless mode: explicit --headless, or no TTY (e.g. invoked by an agent or in a
  // pipe, where Ink's raw mode would crash). --from-wrapper opens /dev/tty itself.
  if (headless || (!process.stdin.isTTY && !isFromWrapper)) {
    try {
      if (mode === "create" && (quickCreateName || existingBranch)) {
        await headlessCreate({ name: quickCreateName, fromBranch, existingBranch })
      } else if (mode === "delete" && deleteTarget) {
        await headlessDelete(deleteTarget, force)
      } else if (mode === "list") {
        await headlessList(json)
      } else {
        console.error(
          "Headless mode supports: create <name> [--from <branch>] | create -e <branch> | delete <name-or-path> [--force] | list [--json]"
        )
        process.exit(1)
      }
      process.exit(0)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }

  let hasExited = false

  let inkStdin: NodeJS.ReadStream = process.stdin
  let inkStdout: NodeJS.WriteStream = process.stdout

  if (isFromWrapper) {
    process.env.FORCE_COLOR = "3"

    try {
      const fs = require("node:fs")
      const tty = require("node:tty")
      // Open separate file descriptors for read and write (required for Node.js v22+)
      const ttyReadFd = fs.openSync("/dev/tty", "r")
      const ttyWriteFd = fs.openSync("/dev/tty", "w")
      inkStdin = new tty.ReadStream(ttyReadFd) as unknown as NodeJS.ReadStream
      inkStdout = new tty.WriteStream(ttyWriteFd) as unknown as NodeJS.WriteStream

      Object.defineProperty(inkStdout, "isTTY", { value: true })
      Object.defineProperty(inkStdout, "hasColors", { value: () => true })
      Object.defineProperty(inkStdout, "getColorDepth", { value: () => 24 })
    } catch (error) {
      console.error("Could not open /dev/tty:", error)
    }
  }

  const { unmount } = render(
    <App
      initialMode={mode}
      isFromWrapper={isFromWrapper}
      quickCreateName={quickCreateName}
      fromBranch={fromBranch}
      existingBranch={existingBranch}
      prefixArg={prefixArg}
      clearPrefix={clearPrefix}
      originalCwd={ORIGINAL_CWD}
      onExit={() => {
        if (!hasExited) {
          hasExited = true
          unmount()
          process.exit(0)
        }
      }}
    />,
    {
      stdin: inkStdin,
      stdout: inkStdout,
      stderr: process.stderr,
    }
  )

  process.on("SIGINT", () => {
    if (!hasExited) {
      hasExited = true
      unmount()
      process.exit(0)
    }
  })

  process.on("SIGTERM", () => {
    if (!hasExited) {
      hasExited = true
      unmount()
      process.exit(0)
    }
  })
}

void main()
