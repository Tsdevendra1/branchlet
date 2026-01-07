import { Box, Text, useInput } from "ink"
import { useCallback, useEffect, useState } from "react"
import { ConfirmDialog, StatusIndicator } from "../../components/common/index.js"
import { COLORS, MESSAGES } from "../../constants/index.js"
import type { WorktreeService } from "../../services/index.js"
import type { CloseWorktreeState } from "../../types/index.js"

interface CloseWorktreeProps {
  worktreeService: WorktreeService
  onCancel: () => void
  isFromWrapper: boolean
  onCloseComplete: (navigateTo: string, deleteWorktree: string) => void
}

export function CloseWorktree({
  worktreeService,
  onCancel,
  isFromWrapper,
  onCloseComplete,
}: CloseWorktreeProps) {
  const [state, setState] = useState<CloseWorktreeState>({
    step: "checking",
  })
  const config = worktreeService.getConfigService().getConfig()

  const checkCurrentWorktree = useCallback(async (): Promise<void> => {
    try {
      const gitService = worktreeService.getGitService()
      const info = await gitService.getCurrentWorktreeInfo()

      if (!info.isWorktree || !info.worktreePath || !info.mainRepoPath) {
        setState({
          step: "error",
          error: MESSAGES.CLOSE_NOT_IN_WORKTREE,
        })
        return
      }

      const isClean = await gitService.isWorktreeClean(info.worktreePath)

      if (!isClean) {
        setState({
          step: "error",
          error: MESSAGES.CLOSE_HAS_UNCOMMITTED_CHANGES,
        })
        return
      }

      const newState: CloseWorktreeState = {
        step: "confirm",
        currentWorktreePath: info.worktreePath,
        mainRepoPath: info.mainRepoPath,
      }
      if (info.branch) {
        newState.branchName = info.branch
      }
      setState(newState)
    } catch (error) {
      setState({
        step: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [worktreeService])

  useEffect(() => {
    checkCurrentWorktree()
  }, [checkCurrentWorktree])

  useInput((input, key) => {
    if (state.step === "error") {
      if (key.escape || key.return || input) {
        onCancel()
      }
    }
  })

  const handleConfirm = (): void => {
    if (!state.currentWorktreePath || !state.mainRepoPath) return

    if (!isFromWrapper) {
      setState({
        step: "error",
        error: MESSAGES.CLOSE_REQUIRES_SHELL_INTEGRATION,
      })
      return
    }

    setState((prev) => ({ ...prev, step: "closing" }))
    onCloseComplete(state.mainRepoPath, state.currentWorktreePath)
  }

  const formatPath = (path: string): string => {
    const home = process.env.HOME || ""
    return path.replace(home, "~")
  }

  if (state.step === "checking") {
    return <StatusIndicator status="loading" message={MESSAGES.CLOSE_CHECKING} />
  }

  if (state.step === "error") {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.ERROR}>{state.error}</Text>
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Press any key to exit...</Text>
        </Box>
      </Box>
    )
  }

  if (state.step === "confirm") {
    const willDeleteBranch =
      config.deleteBranchWithWorktree && state.branchName && state.branchName !== "detached"

    return (
      <ConfirmDialog
        title={MESSAGES.CLOSE_CONFIRM_TITLE}
        message={
          <Box flexDirection="column">
            <Text>
              Close worktree at <Text bold>'{formatPath(state.currentWorktreePath || "")}'</Text>?
            </Text>
            {state.branchName && (
              <Text color={COLORS.MUTED}>Branch: {state.branchName}</Text>
            )}
            {willDeleteBranch && (
              <Text color={COLORS.WARNING}>
                This will also delete branch <Text bold>'{state.branchName}'</Text>
              </Text>
            )}
            <Box marginTop={1}>
              <Text color={COLORS.INFO}>
                You will be navigated to: {formatPath(state.mainRepoPath || "")}
              </Text>
            </Box>
            <Text color={COLORS.MUTED}>{MESSAGES.CLOSE_WARNING}</Text>
          </Box>
        }
        variant={willDeleteBranch ? "danger" : "warning"}
        onConfirm={handleConfirm}
        onCancel={onCancel}
      />
    )
  }

  if (state.step === "closing") {
    return <StatusIndicator status="loading" message={MESSAGES.CLOSE_CLOSING} />
  }

  return null
}
