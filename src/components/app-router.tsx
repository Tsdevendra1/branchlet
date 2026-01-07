import { Box } from "ink"
import { useState } from "react"
import { COLORS } from "../constants/index.js"
import { BorderContext } from "../contexts/border-context.js"
import {
  CloseWorktree,
  CreateWorktree,
  DeleteWorktree,
  ListWorktrees,
  MainPanel,
  PrefixPanel,
  SettingsMenu,
  SetupShellIntegration,
} from "../panels/index.js"
import type { WorktreeService } from "../services/index.js"
import type { ShellIntegrationStatus } from "../services/shell-integration-service.js"
import type { AppMode } from "../types/index.js"
import { WelcomeHeader } from "./welcome-header.js"

interface AppRouterProps {
  mode: AppMode
  worktreeService: WorktreeService
  lastMenuIndex: number
  gitRoot?: string | undefined
  shellIntegrationStatus: ShellIntegrationStatus | null
  isFromWrapper: boolean
  quickCreateName?: string | undefined
  prefixArg?: string | undefined
  clearPrefix?: boolean | undefined
  onMenuSelect: (value: AppMode | "exit", selectedIndex?: number) => void
  onBackToMenu: () => void
  onExit: () => void
  onShellIntegrationComplete: () => void
}

export function AppRouter({
  mode,
  worktreeService,
  lastMenuIndex,
  gitRoot,
  shellIntegrationStatus,
  isFromWrapper,
  quickCreateName,
  prefixArg,
  clearPrefix,
  onMenuSelect,
  onBackToMenu,
  onExit,
  onShellIntegrationComplete,
}: AppRouterProps) {
  const [borderColor, setBorderColor] = useState<string>(COLORS.MUTED)

  return (
    <BorderContext.Provider value={{ setBorderColor }}>
      <Box flexDirection="column">
        <WelcomeHeader mode={mode} gitRoot={gitRoot} />

        {mode === "menu" && (
          <Box borderStyle="round" paddingX={1} borderColor={COLORS.MUTED}>
            <MainPanel
              onSelect={onMenuSelect}
              onCancel={onExit}
              defaultIndex={lastMenuIndex}
              shellIntegrationStatus={shellIntegrationStatus}
            />
          </Box>
        )}

        {mode === "create" && (
          <Box borderStyle="round" paddingX={1} borderColor={borderColor}>
            <CreateWorktree
              worktreeService={worktreeService}
              onComplete={onBackToMenu}
              onCancel={onBackToMenu}
              isFromWrapper={isFromWrapper}
              quickCreateName={quickCreateName}
              onPathSelect={(path) => {
                process.stdout.write(`${path}\n`)
                onExit()
              }}
            />
          </Box>
        )}

        {mode === "list" && (
          <Box borderStyle="round" paddingX={1} borderColor={borderColor}>
            <ListWorktrees
              worktreeService={worktreeService}
              onBack={onBackToMenu}
              isFromWrapper={isFromWrapper}
              onPathSelect={(path) => {
                process.stdout.write(`${path}\n`)
                onExit()
              }}
            />
          </Box>
        )}

        {mode === "delete" && (
          <Box borderStyle="round" paddingX={1} borderColor={borderColor}>
            <DeleteWorktree
              worktreeService={worktreeService}
              onComplete={onBackToMenu}
              onCancel={onBackToMenu}
            />
          </Box>
        )}

        {mode === "settings" && (
          <Box borderStyle="round" paddingX={1} borderColor={borderColor}>
            <SettingsMenu worktreeService={worktreeService} onBack={onBackToMenu} />
          </Box>
        )}

        {mode === "setup" && (
          <Box borderStyle="round" paddingX={1} borderColor={borderColor}>
            <SetupShellIntegration
              shellIntegrationStatus={shellIntegrationStatus}
              onComplete={() => {
                onShellIntegrationComplete()
                onBackToMenu()
              }}
              onCancel={onBackToMenu}
            />
          </Box>
        )}

        {mode === "close" && (
          <Box borderStyle="round" paddingX={1} borderColor={borderColor}>
            <CloseWorktree
              worktreeService={worktreeService}
              onCancel={onExit}
              isFromWrapper={isFromWrapper}
              onCloseComplete={(navigateTo, deleteWorktree) => {
                process.stdout.write(`${JSON.stringify({ navigateTo, deleteWorktree })}\n`)
                onExit()
              }}
            />
          </Box>
        )}

        {mode === "prefix" && (
          <Box borderStyle="round" paddingX={1} borderColor={borderColor}>
            <PrefixPanel
              worktreeService={worktreeService}
              prefixArg={prefixArg}
              clearPrefix={clearPrefix}
              onComplete={onExit}
            />
          </Box>
        )}
      </Box>
    </BorderContext.Provider>
  )
}
