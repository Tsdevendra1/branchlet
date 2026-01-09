import { existsSync } from "node:fs"
import { join, relative } from "node:path"
import { Box, Text, useInput } from "ink"
import { useCallback, useEffect, useState } from "react"
import { ConfirmDialog, SelectPrompt, StatusIndicator } from "../../components/common/index.js"
import { COLORS, MESSAGES } from "../../constants/index.js"
import { openTerminal } from "../../services/file-service.js"
import type { WorktreeService } from "../../services/index.js"
import type { GitWorktree, SelectOption } from "../../types/index.js"

/**
 * Calculates target path preserving the user's current subdirectory
 */
function getTargetPath(worktreePath: string, gitRoot: string | undefined, originalCwd: string | undefined): string {
  if (!gitRoot || !originalCwd) {
    return worktreePath
  }
  // Calculate relative path from git root to where user was
  const relativePath = relative(gitRoot, originalCwd)
  // If relative path is empty or goes outside git root, just use worktree path
  if (!relativePath || relativePath.startsWith("..")) {
    return worktreePath
  }
  // Apply same relative path to the new worktree
  const targetPath = join(worktreePath, relativePath)
  // Only use target path if it exists in the new worktree
  return existsSync(targetPath) ? targetPath : worktreePath
}

interface ListWorktreesProps {
  worktreeService: WorktreeService
  onBack: () => void
  isFromWrapper?: boolean
  onPathSelect?: (path: string) => void
  originalCwd?: string | undefined
  gitRoot?: string | undefined
}

type NavigationMode = "list" | "action-menu" | "batch-delete-confirm" | "batch-deleting" | "batch-delete-result"

interface BatchDeleteResult {
  success: string[]
  failed: { path: string; error: string }[]
}

export function ListWorktrees({
  worktreeService,
  onBack,
  isFromWrapper = false,
  onPathSelect,
  originalCwd,
  gitRoot,
}: ListWorktreesProps) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("list")
  const [selectedWorktree, setSelectedWorktree] = useState<GitWorktree | null>(null)
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set())
  const [batchDeleteResult, setBatchDeleteResult] = useState<BatchDeleteResult | null>(null)
  const [currentlyDeleting, setCurrentlyDeleting] = useState<string | null>(null)

  const config = worktreeService.getConfigService().getConfig()

  const loadWorktrees = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      setError(undefined)
      const gitService = worktreeService.getGitService()
      const repoInfo = await gitService.getRepositoryInfo()
      const additionalWorktrees = repoInfo.worktrees.filter((wt) => !wt.isMain)
      setWorktrees(additionalWorktrees)
      // Clean up any selected items that no longer exist
      setSelectedForDeletion((prev) => {
        const newSet = new Set<string>()
        for (const path of prev) {
          if (additionalWorktrees.some((wt) => wt.path === path)) {
            newSet.add(path)
          }
        }
        return newSet
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [worktreeService])

  useEffect(() => {
    loadWorktrees()
  }, [loadWorktrees])

  const formatPath = (path: string): string => {
    const home = process.env.HOME || ""
    return path.replace(home, "~")
  }

  const handleOpenWithCommand = useCallback(
    async (worktree: GitWorktree) => {
      try {
        const config = worktreeService.getConfigService().getConfig()
        if (config.terminalCommand) {
          await openTerminal(config.terminalCommand, worktree.path)
        }
        onBack()
      } catch (error) {
        console.error("Failed to open with command:", error)
      }
    },
    [worktreeService, onBack]
  )

  const handleActionSelect = useCallback(
    (action: string) => {
      if (!selectedWorktree) return

      switch (action) {
        case "cd":
          if (isFromWrapper && onPathSelect) {
            onPathSelect(selectedWorktree.path)
          }
          break
        case "command":
          handleOpenWithCommand(selectedWorktree)
          break
      }
    },
    [selectedWorktree, isFromWrapper, onPathSelect, handleOpenWithCommand]
  )

  const toggleSelection = useCallback((path: string) => {
    setSelectedForDeletion((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(path)) {
        newSet.delete(path)
      } else {
        newSet.add(path)
      }
      return newSet
    })
  }, [])

  const executeBatchDelete = useCallback(async () => {
    const pathsToDelete = Array.from(selectedForDeletion)
    const result: BatchDeleteResult = { success: [], failed: [] }

    setNavigationMode("batch-deleting")

    for (const path of pathsToDelete) {
      setCurrentlyDeleting(path)
      try {
        // Check if worktree has uncommitted changes
        const worktree = worktrees.find((wt) => wt.path === path)
        const force = worktree ? !worktree.isClean : false
        await worktreeService.deleteWorktree(path, force)
        result.success.push(path)
      } catch (err) {
        result.failed.push({
          path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    setCurrentlyDeleting(null)
    setBatchDeleteResult(result)
    setSelectedForDeletion(new Set())
    setNavigationMode("batch-delete-result")
  }, [selectedForDeletion, worktrees, worktreeService])

  useInput((input, key) => {
    // Handle batch delete result - any key returns to list
    if (navigationMode === "batch-delete-result") {
      if (key.escape || key.return || input) {
        setBatchDeleteResult(null)
        loadWorktrees()
        setNavigationMode("list")
      }
      return
    }

    // Skip input handling during delete confirmation (ConfirmDialog handles it)
    if (navigationMode === "batch-delete-confirm") return
    if (navigationMode === "batch-deleting") return
    if (navigationMode === "action-menu") return

    if (key.escape) {
      onBack()
      return
    }

    if (worktrees.length === 0) {
      onBack()
      return
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? worktrees.length - 1 : prev - 1))
      return
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === worktrees.length - 1 ? 0 : prev + 1))
      return
    }

    // Space to toggle selection
    if (input === " ") {
      const worktree = worktrees[selectedIndex]
      if (worktree) {
        toggleSelection(worktree.path)
      }
      return
    }

    // 'd' to delete selected (only when items are selected)
    if (input.toLowerCase() === "d" && selectedForDeletion.size > 0) {
      setNavigationMode("batch-delete-confirm")
      return
    }

    if (key.return) {
      const worktree = worktrees[selectedIndex]
      if (worktree) {
        if (isFromWrapper && onPathSelect) {
          // Auto-navigate with subdirectory preservation
          onPathSelect(getTargetPath(worktree.path, gitRoot, originalCwd))
        } else {
          // Show action menu for users without shell integration
          setSelectedWorktree(worktree)
          setNavigationMode("action-menu")
        }
      }
      return
    }

    if (input.toLowerCase() === "e") {
      const worktree = worktrees[selectedIndex]
      if (worktree) {
        handleOpenWithCommand(worktree)
      }
      return
    }

    const numericInput = Number.parseInt(input, 10)
    if (!Number.isNaN(numericInput) && numericInput >= 1 && numericInput <= worktrees.length) {
      setSelectedIndex(numericInput - 1)
    }
  })

  if (loading) {
    return <StatusIndicator status="loading" message={MESSAGES.LOADING_WORKTREES} />
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.ERROR}>
          {MESSAGES.GIT_ERROR_LIST}: {error}
        </Text>
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Press any key to go back...</Text>
        </Box>
      </Box>
    )
  }

  if (worktrees.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.INFO}>{MESSAGES.LIST_NO_WORKTREES}</Text>
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Press any key to go back...</Text>
        </Box>
      </Box>
    )
  }

  // Batch delete result screen
  if (navigationMode === "batch-delete-result" && batchDeleteResult) {
    const { success, failed } = batchDeleteResult
    const hasFailures = failed.length > 0

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color={hasFailures ? COLORS.WARNING : COLORS.SUCCESS} bold>
            {hasFailures
              ? `${success.length} ${MESSAGES.BATCH_DELETE_PARTIAL} ${failed.length}`
              : `${success.length} ${MESSAGES.BATCH_DELETE_SUCCESS}`}
          </Text>
        </Box>

        {success.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={COLORS.SUCCESS}>Deleted:</Text>
            {success.map((path) => (
              <Text key={path} color={COLORS.MUTED}>
                {"  "}
                {formatPath(path)}
              </Text>
            ))}
          </Box>
        )}

        {failed.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color={COLORS.ERROR}>Failed:</Text>
            {failed.map(({ path, error }) => (
              <Box key={path} flexDirection="column">
                <Text color={COLORS.ERROR}>
                  {"  "}
                  {formatPath(path)}
                </Text>
                <Text color={COLORS.MUTED} dimColor>
                  {"    "}
                  {error}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Press any key to continue...</Text>
        </Box>
      </Box>
    )
  }

  // Batch deleting progress screen
  if (navigationMode === "batch-deleting") {
    const total = selectedForDeletion.size
    const deletingWorktree = worktrees.find((wt) => wt.path === currentlyDeleting)
    const branchName = deletingWorktree?.branch || ""
    return (
      <StatusIndicator
        status="loading"
        message={`Deleting worktrees... ${branchName ? `(${branchName})` : ""}`}
      />
    )
  }

  // Batch delete confirmation screen
  if (navigationMode === "batch-delete-confirm") {
    const selectedWorktrees = worktrees.filter((wt) => selectedForDeletion.has(wt.path))
    const hasUncommittedChanges = selectedWorktrees.some((wt) => !wt.isClean)
    const willDeleteBranches = config.deleteBranchWithWorktree

    return (
      <ConfirmDialog
        title={`${MESSAGES.BATCH_DELETE_CONFIRM_TITLE} (${selectedWorktrees.length})`}
        message={
          <Box flexDirection="column">
            <Text>The following worktrees will be deleted:</Text>
            <Box flexDirection="column" marginY={1}>
              {selectedWorktrees.map((wt) => (
                <Box key={wt.path}>
                  <Text color={COLORS.MUTED}>• </Text>
                  <Text>{formatPath(wt.path)}</Text>
                  <Text color={COLORS.SUCCESS}> ({wt.branch})</Text>
                  {!wt.isClean && <Text color={COLORS.WARNING}> [has changes]</Text>}
                </Box>
              ))}
            </Box>
            {willDeleteBranches && (
              <Text color={COLORS.WARNING}>
                Associated branches will also be deleted.
              </Text>
            )}
            {hasUncommittedChanges && (
              <Text color={COLORS.ERROR}>
                Some worktrees have uncommitted changes that will be lost!
              </Text>
            )}
            <Text color={COLORS.MUTED}>{MESSAGES.DELETE_WARNING}</Text>
          </Box>
        }
        variant={hasUncommittedChanges ? "danger" : "warning"}
        confirmLabel={MESSAGES.BATCH_DELETE_CONFIRM_LABEL}
        onConfirm={executeBatchDelete}
        onCancel={() => setNavigationMode("list")}
      />
    )
  }

  if (navigationMode === "action-menu" && selectedWorktree) {
    const config = worktreeService.getConfigService().getConfig()
    const actions: SelectOption[] = []

    if (isFromWrapper) {
      actions.push({
        label: "Navigate to Directory",
        value: "cd",
        disabled: false,
      })
    } else {
      actions.push({
        label: "Navigate to Directory",
        value: "cd",
        description: "requires shell integration",
        disabled: true,
      })
    }

    if (config.terminalCommand) {
      actions.push({
        label: "Open with Command",
        value: "command",
        description: "Open using configured terminal command",
      })
    }

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>
            Selected: <Text color={COLORS.PRIMARY}>{formatPath(selectedWorktree.path)}</Text>{" "}
            <Text color={COLORS.SUCCESS}>({selectedWorktree.branch})</Text>
          </Text>
        </Box>
        <SelectPrompt
          label="Choose action:"
          options={actions}
          onSelect={handleActionSelect}
          onCancel={() => setNavigationMode("list")}
        />
      </Box>
    )
  }

  // Build hint text
  const hintParts = ["↑↓ Navigate", "Space Toggle"]
  if (selectedForDeletion.size > 0) {
    hintParts.push(`d Delete (${selectedForDeletion.size})`)
  }
  hintParts.push("Enter Action Menu", "E Command", "Esc Back")
  const hintText = hintParts.join(" • ")

  return (
    <Box flexDirection="column" width="100%">
      <Box justifyContent="space-between" width="100%">
        <Text bold color={COLORS.MUTED}>
          PATH
        </Text>
        <Text bold color={COLORS.MUTED}>
          BRANCH
        </Text>
      </Box>

      {worktrees.map((worktree, index) => {
        const path = formatPath(worktree.path)
        const isSelected = index === selectedIndex
        const isMarkedForDeletion = selectedForDeletion.has(worktree.path)
        const marker = isSelected ? "> " : "  "
        const checkbox = isMarkedForDeletion ? "[x] " : "[ ] "

        return (
          <Box key={worktree.path} justifyContent="space-between" width="100%">
            <Text
              {...(isSelected
                ? { color: COLORS.PRIMARY }
                : worktree.isMain
                  ? { color: COLORS.PRIMARY }
                  : {})}
            >
              {marker}
              <Text {...(isMarkedForDeletion ? { color: COLORS.WARNING } : {})}>{checkbox}</Text>
              {path}
            </Text>
            <Text color={COLORS.SUCCESS}>{worktree.branch}</Text>
          </Box>
        )
      })}

      <Box marginTop={2}>
        <Text color={COLORS.MUTED} dimColor>
          {hintText}
        </Text>
      </Box>
    </Box>
  )
}
