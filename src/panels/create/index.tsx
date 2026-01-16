import { existsSync } from "node:fs"
import { join, relative } from "node:path"
import { Box, Text, useInput } from "ink"
import { useCallback, useEffect, useState } from "react"
import {
  CommandListProgress,
  ConfirmDialog,
  InputPrompt,
  SelectPrompt,
  StatusIndicator,
} from "../../components/common/index.js"
import { COLORS, MESSAGES } from "../../constants/index.js"
import { copyFiles, executePostCreateCommands, openTerminal } from "../../services/file-service.js"
import type { WorktreeService } from "../../services/index.js"
import type { CreateWorktreeState, GitBranch, SelectOption } from "../../types/index.js"
import {
  getRepositoryRoot,
  getWorktreePath,
  validateBranchName,
  validateDirectoryName,
} from "../../utils/index.js"

interface CreateWorktreeProps {
  worktreeService: WorktreeService
  onComplete: () => void
  onCancel: () => void
  isFromWrapper?: boolean
  quickCreateName?: string | undefined
  fromBranch?: string | undefined
  existingBranch?: string | undefined
  originalCwd?: string | undefined
  gitRoot?: string | undefined
  onPathSelect?: (path: string) => void
}

// Apply branch prefix with smart deduplication
function applyBranchPrefix(branchName: string, prefix: string): string {
  if (!prefix || !branchName) return branchName
  // Don't double-prefix if name already starts with the prefix
  if (branchName.startsWith(prefix)) return branchName
  return `${prefix}${branchName}`
}

// Calculate target path preserving subdirectory position
function getTargetPath(worktreePath: string, gitRoot: string | undefined, originalCwd: string | undefined): string {
  if (!gitRoot || !originalCwd) {
    return worktreePath
  }
  const relativePath = relative(gitRoot, originalCwd)
  // If relative path is empty or goes outside git root, just use worktree path
  if (!relativePath || relativePath.startsWith("..")) {
    return worktreePath
  }
  const targetPath = join(worktreePath, relativePath)
  // Only use target path if it exists in the new worktree
  return existsSync(targetPath) ? targetPath : worktreePath
}

export function CreateWorktree({
  worktreeService,
  onComplete,
  onCancel,
  isFromWrapper = false,
  quickCreateName,
  fromBranch,
  existingBranch,
  originalCwd,
  gitRoot: gitRootProp,
  onPathSelect,
}: CreateWorktreeProps) {
  const [state, setState] = useState<CreateWorktreeState>({
    step: "directory",
    directoryName: "",
    sourceBranch: "",
    newBranch: "",
  })
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [repoPath, setRepoPath] = useState<string>("")

  const loadBranches = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      const gitService = worktreeService.getGitService()
      const repoInfo = await gitService.getRepositoryInfo()
      setBranches(repoInfo.branches)
      setRepoPath(repoInfo.path)
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: `Failed to load branches: ${error}`,
      }))
    } finally {
      setLoading(false)
    }
  }, [worktreeService])

  useEffect(() => {
    loadBranches()
  }, [loadBranches])

  // Handle quick create mode when quickCreateName is provided
  useEffect(() => {
    if (!quickCreateName || branches.length === 0 || loading) {
      return
    }

    // Get config for prefix
    const config = worktreeService.getConfigService().getConfig()
    const prefix = config.branchPrefix || ""
    const prefixedBranchName = applyBranchPrefix(quickCreateName, prefix)

    // Validate directory name
    const dirError = validateDirectoryName(quickCreateName)
    if (dirError) {
      setState((prev) => ({
        ...prev,
        error: `Invalid name: ${dirError}`,
      }))
      return
    }

    // Validate branch name (with prefix)
    const branchError = validateBranchName(prefixedBranchName)
    if (branchError) {
      setState((prev) => ({
        ...prev,
        error: `Invalid branch name: ${branchError}`,
      }))
      return
    }

    // Check if branch already exists (with prefix)
    const existingBranch = branches.find((b) => b.name === prefixedBranchName)
    if (existingBranch) {
      setState((prev) => ({
        ...prev,
        error: `Branch '${prefixedBranchName}' already exists`,
      }))
      return
    }

    // Get source branch - priority: CLI --from > config defaultSourceBranch > current branch
    let sourceBranch: GitBranch | undefined
    if (fromBranch) {
      sourceBranch = branches.find((b) => b.name === fromBranch)
      if (!sourceBranch) {
        setState((prev) => ({
          ...prev,
          error: `Specified branch '${fromBranch}' not found`,
        }))
        return
      }
    } else if (config.defaultSourceBranch) {
      sourceBranch = branches.find((b) => b.name === config.defaultSourceBranch)
      if (!sourceBranch) {
        setState((prev) => ({
          ...prev,
          error: `Configured default branch '${config.defaultSourceBranch}' not found`,
        }))
        return
      }
    } else {
      sourceBranch = branches.find((b) => b.isCurrent)
      if (!sourceBranch) {
        setState((prev) => ({
          ...prev,
          error: "Could not determine current branch",
        }))
        return
      }
    }

    // Set state for quick create and trigger creation
    setState({
      step: "directory",
      directoryName: quickCreateName,
      sourceBranch: sourceBranch.name,
      newBranch: prefixedBranchName,
    })

    // Trigger creation asynchronously
    const triggerQuickCreate = async () => {
      try {
        setState((prev) => ({ ...prev, step: "creating" }))

        const gitRoot = repoPath || getRepositoryRoot()
        const worktreePath = getWorktreePath(gitRoot, quickCreateName, config.worktreePathTemplate)
        const parentDir = worktreePath.replace(`/${quickCreateName}`, "")

        const gitService = worktreeService.getGitService()
        await gitService.createWorktree({
          name: quickCreateName,
          sourceBranch: sourceBranch.name,
          newBranch: prefixedBranchName,
          basePath: parentDir,
        })

        if (config.worktreeCopyPatterns.length > 0) {
          await copyFiles(gitRoot, worktreePath, config)
        }

        if (config.postCreateCmd.length > 0) {
          setState((prev) => ({
            ...prev,
            step: "running-commands",
            commandProgress: { current: 0, total: config.postCreateCmd.length },
            postCreateCommands: config.postCreateCmd,
            currentCommandIndex: 0,
          }))

          const variables = {
            BASE_PATH: gitRoot.split("/").pop() || "",
            WORKTREE_PATH: worktreePath,
            BRANCH_NAME: prefixedBranchName,
            SOURCE_BRANCH: sourceBranch.name,
          }

          await executePostCreateCommands(config.postCreateCmd, variables, (command, current, total) => {
            setState((prev) => ({
              ...prev,
              currentCommand: command,
              commandProgress: { current, total },
              currentCommandIndex: current - 1,
            }))
          })
        }

        if (config.terminalCommand) {
          await openTerminal(config.terminalCommand, worktreePath)
        }

        setState((prev) => ({ ...prev, step: "success" }))

        setTimeout(() => {
          if (isFromWrapper && onPathSelect) {
            onPathSelect(getTargetPath(worktreePath, gitRootProp || gitRoot, originalCwd))
          } else {
            onComplete()
          }
        }, 2000)
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : String(error),
          step: "directory",
        }))
      }
    }

    triggerQuickCreate()
  }, [quickCreateName, fromBranch, branches, loading, worktreeService, repoPath, isFromWrapper, onPathSelect, onComplete, gitRootProp, originalCwd])

  // Handle existing branch mode when existingBranch is provided
  useEffect(() => {
    // Don't run if quickCreateName is provided (it takes precedence)
    if (quickCreateName || !existingBranch || branches.length === 0 || loading) {
      return
    }

    // Check if the branch exists
    const branch = branches.find((b) => b.name === existingBranch)
    if (!branch) {
      setState((prev) => ({
        ...prev,
        error: `Branch '${existingBranch}' not found`,
      }))
      return
    }

    // Derive directory name by sanitizing branch name (replace / with -)
    const directoryName = existingBranch.replace(/\//g, "-")

    // Validate the derived directory name
    const dirError = validateDirectoryName(directoryName)
    if (dirError) {
      setState((prev) => ({
        ...prev,
        error: `Invalid derived directory name '${directoryName}': ${dirError}`,
      }))
      return
    }

    const config = worktreeService.getConfigService().getConfig()

    // Set state for existing branch create and trigger creation
    setState({
      step: "directory",
      directoryName,
      sourceBranch: existingBranch,
      newBranch: existingBranch, // Same as source - triggers existing branch path
    })

    // Trigger creation asynchronously
    const triggerExistingBranchCreate = async () => {
      try {
        setState((prev) => ({ ...prev, step: "creating" }))

        const gitRoot = repoPath || getRepositoryRoot()
        const worktreePath = getWorktreePath(gitRoot, directoryName, config.worktreePathTemplate)
        const parentDir = worktreePath.replace(`/${directoryName}`, "")

        const gitService = worktreeService.getGitService()
        await gitService.createWorktree({
          name: directoryName,
          sourceBranch: existingBranch,
          newBranch: existingBranch, // Same as source - uses existing branch
          basePath: parentDir,
        })

        if (config.worktreeCopyPatterns.length > 0) {
          await copyFiles(gitRoot, worktreePath, config)
        }

        if (config.postCreateCmd.length > 0) {
          setState((prev) => ({
            ...prev,
            step: "running-commands",
            commandProgress: { current: 0, total: config.postCreateCmd.length },
            postCreateCommands: config.postCreateCmd,
            currentCommandIndex: 0,
          }))

          const variables = {
            BASE_PATH: gitRoot.split("/").pop() || "",
            WORKTREE_PATH: worktreePath,
            BRANCH_NAME: existingBranch,
            SOURCE_BRANCH: existingBranch,
          }

          await executePostCreateCommands(config.postCreateCmd, variables, (command, current, total) => {
            setState((prev) => ({
              ...prev,
              currentCommand: command,
              commandProgress: { current, total },
              currentCommandIndex: current - 1,
            }))
          })
        }

        if (config.terminalCommand) {
          await openTerminal(config.terminalCommand, worktreePath)
        }

        setState((prev) => ({ ...prev, step: "success" }))

        setTimeout(() => {
          if (isFromWrapper && onPathSelect) {
            onPathSelect(getTargetPath(worktreePath, gitRootProp || gitRoot, originalCwd))
          } else {
            onComplete()
          }
        }, 2000)
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : String(error),
          step: "directory",
        }))
      }
    }

    triggerExistingBranchCreate()
  }, [quickCreateName, existingBranch, branches, loading, worktreeService, repoPath, isFromWrapper, onPathSelect, onComplete, gitRootProp, originalCwd])

  useInput((input, key) => {
    if (state.error) {
      if (key.escape || key.return || input) {
        setState((prev) => {
          const { error: _error, ...rest } = prev
          return rest
        })
      }
    }
  })

  const handleDirectorySubmit = (directoryName: string): void => {
    setState((prev) => ({
      ...prev,
      directoryName: directoryName.trim(),
      step: "source-branch",
    }))
  }

  const handleSourceBranchSelect = (sourceBranch: string): void => {
    setState((prev) => ({
      ...prev,
      sourceBranch,
      newBranch: "",
      step: "new-branch",
    }))
  }

  const handleNewBranchSubmit = (newBranch: string): void => {
    const trimmedBranch = newBranch.trim()
    const config = worktreeService.getConfigService().getConfig()
    const prefix = config.branchPrefix || ""

    // If empty, use source branch (no prefix applied)
    // If not empty, apply prefix
    const finalBranch = trimmedBranch
      ? applyBranchPrefix(trimmedBranch, prefix)
      : state.sourceBranch

    setState((prev) => ({
      ...prev,
      newBranch: finalBranch,
      step: "confirm",
    }))
  }

  const validateNewBranchName = (name: string): string | undefined => {
    if (!name.trim()) {
      return undefined
    }

    const config = worktreeService.getConfigService().getConfig()
    const prefix = config.branchPrefix || ""
    const prefixedName = applyBranchPrefix(name, prefix)

    const formatError = validateBranchName(prefixedName)
    if (formatError) {
      return formatError
    }

    const existingBranch = branches.find((branch) => branch.name === prefixedName)
    if (existingBranch) {
      return `Branch '${prefixedName}' already exists`
    }

    return undefined
  }

  const handleConfirm = async (): Promise<void> => {
    try {
      setState((prev) => ({ ...prev, step: "creating" }))

      const config = worktreeService.getConfigService().getConfig()
      const gitRoot = repoPath || getRepositoryRoot()
      const worktreePath = getWorktreePath(
        gitRoot,
        state.directoryName,
        config.worktreePathTemplate
      )
      const parentDir = worktreePath.replace(`/${state.directoryName}`, "")

      const gitService = worktreeService.getGitService()
      await gitService.createWorktree({
        name: state.directoryName,
        sourceBranch: state.sourceBranch,
        newBranch: state.newBranch,
        basePath: parentDir,
      })

      if (config.worktreeCopyPatterns.length > 0) {
        await copyFiles(gitRoot, worktreePath, config)
      }

      if (config.postCreateCmd.length > 0) {
        setState((prev) => ({
          ...prev,
          step: "running-commands",
          commandProgress: { current: 0, total: config.postCreateCmd.length },
          postCreateCommands: config.postCreateCmd,
          currentCommandIndex: 0,
        }))

        const variables = {
          BASE_PATH: gitRoot.split("/").pop() || "",
          WORKTREE_PATH: worktreePath,
          BRANCH_NAME: state.newBranch,
          SOURCE_BRANCH: state.sourceBranch,
        }

        await executePostCreateCommands(
          config.postCreateCmd,
          variables,
          (command, current, total) => {
            setState((prev) => ({
              ...prev,
              currentCommand: command,
              commandProgress: { current, total },
              currentCommandIndex: current - 1,
            }))
          }
        )
      }

      if (config.terminalCommand) {
        await openTerminal(config.terminalCommand, worktreePath)
      }

      setState((prev) => ({ ...prev, step: "success" }))

      setTimeout(() => {
        if (isFromWrapper && onPathSelect) {
          onPathSelect(getTargetPath(worktreePath, gitRootProp || gitRoot, originalCwd))
        } else {
          onComplete()
        }
      }, 2000)
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
        step: "directory",
      }))
    }
  }

  const getBranchOptions = (): SelectOption<string>[] => {
    const config = worktreeService.getConfigService().getConfig()
    const configuredDefault = config.defaultSourceBranch
    const options: SelectOption<string>[] = []

    for (const branch of branches) {
      // Priority: CLI --from > config defaultSourceBranch > current branch
      let isSelectedDefault: boolean
      if (fromBranch) {
        isSelectedDefault = branch.name === fromBranch
      } else if (configuredDefault) {
        isSelectedDefault = branch.name === configuredDefault
      } else {
        isSelectedDefault = branch.isCurrent
      }

      const option: SelectOption<string> = {
        label: branch.name,
        value: branch.name,
        isDefault: isSelectedDefault,
      }

      if (branch.isCurrent) {
        option.description = "current"
      } else if (branch.isDefault) {
        option.description = "default"
      }

      options.push(option)
    }

    return options
  }

  if (loading) {
    return <StatusIndicator status="loading" message={MESSAGES.LOADING_BRANCHES} />
  }

  if (state.error) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.ERROR}>{state.error}</Text>
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Press any key to try again...</Text>
        </Box>
      </Box>
    )
  }

  switch (state.step) {
    case "directory":
      return (
        <InputPrompt
          label={MESSAGES.CREATE_DIRECTORY_PROMPT}
          placeholder={MESSAGES.CREATE_DIRECTORY_PLACEHOLDER}
          validate={validateDirectoryName}
          onSubmit={handleDirectorySubmit}
          onCancel={onCancel}
        />
      )

    case "source-branch":
      return (
        <SelectPrompt
          label={MESSAGES.CREATE_SOURCE_BRANCH_PROMPT}
          options={getBranchOptions()}
          onSelect={handleSourceBranchSelect}
          onCancel={onCancel}
        />
      )

    case "new-branch":
      return (
        <InputPrompt
          label={MESSAGES.CREATE_NEW_BRANCH_PROMPT}
          placeholder={MESSAGES.CREATE_NEW_BRANCH_PLACEHOLDER}
          validate={validateNewBranchName}
          onSubmit={handleNewBranchSubmit}
          onCancel={onCancel}
        />
      )

    case "confirm": {
      const isUsingExistingBranch = state.newBranch === state.sourceBranch
      const message = isUsingExistingBranch
        ? `Create worktree '${state.directoryName}' using existing branch '${state.sourceBranch}'?`
        : `Create worktree '${state.directoryName}' with new branch '${state.newBranch}' from '${state.sourceBranch}'?`

      return (
        <ConfirmDialog
          title={MESSAGES.CREATE_CONFIRM_TITLE}
          message={message}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      )
    }

    case "creating":
      return <StatusIndicator status="loading" message={MESSAGES.CREATE_CREATING} />

    case "running-commands":
      return (
        <CommandListProgress
          commands={state.postCreateCommands || []}
          currentIndex={state.currentCommandIndex || 0}
        />
      )

    case "success":
      return <StatusIndicator status="success" message={MESSAGES.CREATE_SUCCESS} spinner={false} />

    default:
      return <Text>Unknown step</Text>
  }
}
