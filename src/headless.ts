import { dirname, resolve } from "node:path"
import { ConfigService } from "./services/config-service.js"
import { copyFiles, executePostCreateCommands } from "./services/file-service.js"
import { GitService } from "./services/git-service.js"
import { WorktreeService } from "./services/worktree-service.js"
import type { TemplateVariables } from "./types/index.js"
import {
  getCurrentBranch,
  getGitRoot,
  getRepositoryBaseName,
  getRepositoryRoot,
  getWorktreePath,
  validateBranchName,
  validateDirectoryName,
} from "./utils/index.js"

export interface HeadlessCreateOptions {
  name?: string | undefined
  fromBranch?: string | undefined
  existingBranch?: string | undefined
}

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function applyBranchPrefix(branchName: string, prefix: string): string {
  if (!prefix || !branchName) return branchName
  if (branchName.startsWith(prefix)) return branchName
  return `${prefix}${branchName}`
}

async function runCommands(commands: string[], variables: TemplateVariables): Promise<boolean> {
  const results = await executePostCreateCommands(commands, variables, (command, index, total) => {
    console.error(`[${index}/${total}] ${command}`)
  })

  let allSucceeded = true
  for (const result of results) {
    if (result.output.trim()) {
      console.error(result.output.trim())
    }
    if (!result.success) {
      allSucceeded = false
      console.error(`Command failed: ${result.command}`)
      if (result.error) {
        console.error(result.error.trim())
      }
    }
  }
  return allSucceeded
}

export async function headlessCreate(options: HeadlessCreateOptions): Promise<void> {
  const invocationDir = getRepositoryRoot()
  // True main repo root, so placement and config are correct even when run from inside a worktree.
  const gitRoot = (await getGitRoot(invocationDir)) ?? invocationDir
  const gitService = new GitService(gitRoot)
  if (!(await gitService.validateRepository())) {
    fail("Current directory is not a git repository")
  }

  const configService = new ConfigService()
  const config = await configService.loadConfig(gitRoot)

  let directoryName: string
  let sourceBranch: string
  let newBranch: string

  if (options.existingBranch) {
    const branch = options.existingBranch
    newBranch = branch
    directoryName = branch.replace(/\//g, "-")
    if (await gitService.branchExists(branch)) {
      sourceBranch = branch
    } else {
      const remoteBranch = await gitService.findRemoteBranch(branch)
      if (!remoteBranch) fail(`Branch '${branch}' not found`)
      sourceBranch = remoteBranch
    }
  } else if (options.name) {
    directoryName = options.name
    newBranch = applyBranchPrefix(options.name, config.branchPrefix)
    if (await gitService.branchExists(newBranch)) {
      fail(`Branch '${newBranch}' already exists`)
    }
    const requestedSource = options.fromBranch || config.defaultSourceBranch
    if (requestedSource) {
      if (!(await gitService.branchExists(requestedSource))) {
        fail(`Source branch '${requestedSource}' not found`)
      }
      sourceBranch = requestedSource
    } else {
      const currentBranch = await getCurrentBranch(invocationDir)
      if (!currentBranch) fail("Could not determine current branch")
      sourceBranch = currentBranch
    }
  } else {
    fail(
      "Headless create requires a name: branchlet create <name> --headless (or -e <existing-branch>)"
    )
  }

  const dirError = validateDirectoryName(directoryName)
  if (dirError) fail(`Invalid name: ${dirError}`)
  const branchError = validateBranchName(newBranch)
  if (branchError) fail(`Invalid branch name: ${branchError}`)

  const worktreePath = getWorktreePath(
    gitRoot,
    directoryName,
    config.worktreePathTemplate,
    newBranch,
    sourceBranch
  )
  if (await gitService.worktreeExists(worktreePath)) {
    fail(`Worktree already exists at '${worktreePath}'`)
  }

  console.error(
    `Creating worktree '${directoryName}' from '${sourceBranch}' (branch: ${newBranch})`
  )
  await gitService.createWorktree({
    name: directoryName,
    sourceBranch,
    newBranch,
    basePath: dirname(worktreePath),
  })

  if (config.worktreeCopyPatterns.length > 0) {
    const { dir: envSource, fromSourceBranch } = await gitService.resolveEnvSource(
      sourceBranch,
      invocationDir
    )
    const copyResult = await copyFiles(envSource, worktreePath, config)
    console.error(`Copied ${copyResult.copied.length} file(s) from ${envSource}`)
    if (!fromSourceBranch) {
      console.error(
        `Note: no checked-out worktree for '${sourceBranch}'; copied env files from current folder`
      )
    }
    for (const error of copyResult.errors) {
      console.error(`Copy error: ${error}`)
    }
  }

  let commandsSucceeded = true
  if (config.postCreateCmd.length > 0) {
    commandsSucceeded = await runCommands(config.postCreateCmd, {
      BASE_PATH: getRepositoryBaseName(gitRoot),
      WORKTREE_PATH: worktreePath,
      BRANCH_NAME: newBranch,
      SOURCE_BRANCH: sourceBranch,
    })
  }

  // Last stdout line is the worktree path so callers can parse it
  console.log(worktreePath)

  if (!commandsSucceeded) {
    console.error("Worktree created, but some post-create commands failed")
    process.exit(1)
  }
}

export async function headlessDelete(target: string, force: boolean): Promise<void> {
  const gitRoot = getRepositoryRoot()
  const worktreeService = new WorktreeService(gitRoot)
  await worktreeService.initialize()
  const gitService = worktreeService.getGitService()
  const config = worktreeService.getConfigService().getConfig()

  const worktrees = await gitService.listWorktrees()
  const resolvedTarget = resolve(target)
  const worktree = worktrees.find((wt) => wt.path === resolvedTarget || wt.branch === target)
  if (!worktree) fail(`No worktree found for '${target}'`)
  if (worktree.isMain) fail("Refusing to delete the main worktree")

  if (config.postCloseCmd.length > 0) {
    const succeeded = await runCommands(config.postCloseCmd, {
      BASE_PATH: getRepositoryBaseName(gitRoot),
      WORKTREE_PATH: worktree.path,
      BRANCH_NAME: worktree.branch || "",
      SOURCE_BRANCH: "",
      MAIN_REPO_PATH: gitRoot,
    })
    if (!succeeded) {
      console.error("Continuing with deletion despite post-close command failures")
    }
  }

  const result = await worktreeService.deleteWorktree(worktree.path, force)
  const branchNote = result.branchDeleted ? ` and branch '${result.branchName}'` : ""
  console.log(`Deleted worktree ${worktree.path}${branchNote}`)
}

export async function headlessList(json: boolean): Promise<void> {
  const gitService = new GitService(getRepositoryRoot())
  if (!(await gitService.validateRepository())) {
    fail("Current directory is not a git repository")
  }

  const worktrees = await gitService.listWorktrees()
  if (json) {
    const output = worktrees.map((wt) => ({
      path: wt.path,
      branch: wt.branch,
      isMain: wt.isMain ?? false,
      isClean: wt.isClean,
    }))
    console.log(JSON.stringify(output, null, 2))
  } else {
    for (const wt of worktrees) {
      console.log(`${wt.path}\t${wt.branch}${wt.isMain ? "\t(main)" : ""}`)
    }
  }
}
