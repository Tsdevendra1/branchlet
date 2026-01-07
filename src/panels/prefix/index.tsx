import { Box, Text, useInput } from "ink"
import { useCallback, useEffect, useState } from "react"
import { InputPrompt, StatusIndicator } from "../../components/common/index.js"
import { COLORS, LOCAL_CONFIG_FILE_NAME } from "../../constants/index.js"
import type { WorktreeService } from "../../services/index.js"

interface PrefixPanelProps {
  worktreeService: WorktreeService
  prefixArg?: string | undefined
  clearPrefix?: boolean | undefined
  onComplete: () => void
}

type PrefixStep = "show" | "input" | "saving" | "done"

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim()
  if (!trimmed) return ""
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

export function PrefixPanel({
  worktreeService,
  prefixArg,
  clearPrefix,
  onComplete,
}: PrefixPanelProps) {
  const [step, setStep] = useState<PrefixStep>("show")
  const [currentPrefix, setCurrentPrefix] = useState<string>("")
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState<string>("")

  const configService = worktreeService.getConfigService()

  const handleSavePrefix = useCallback(async (prefix: string): Promise<void> => {
    setStep("saving")
    try {
      const config = configService.getConfig()
      const updatedConfig = { ...config, branchPrefix: prefix }

      // Save to local config
      const localConfigPath = `${process.cwd()}/${LOCAL_CONFIG_FILE_NAME}`
      await configService.saveConfig(updatedConfig, localConfigPath)

      if (prefix) {
        setMessage(`Branch prefix set to "${prefix}"`)
      } else {
        setMessage("Branch prefix cleared")
      }
      setStep("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep("show")
    }
  }, [configService])

  useEffect(() => {
    const config = configService.getConfig()
    setCurrentPrefix(config.branchPrefix || "")

    // If clearing prefix
    if (clearPrefix) {
      handleSavePrefix("")
      return
    }

    // If prefix arg provided, set it directly
    if (prefixArg !== undefined) {
      const normalized = normalizePrefix(prefixArg)
      handleSavePrefix(normalized)
      return
    }

    // Otherwise show current prefix and wait for input
    if (config.branchPrefix) {
      setStep("show")
    } else {
      setStep("input")
    }
  }, [clearPrefix, prefixArg, handleSavePrefix, configService])

  const handlePrefixSubmit = (value: string): void => {
    const normalized = normalizePrefix(value)
    handleSavePrefix(normalized)
  }

  const validatePrefix = (value: string): string | undefined => {
    if (!value.trim()) return undefined
    // Basic validation - prefix should be valid as start of branch name
    if (/[\s~^:?*[\]\\@]/.test(value)) {
      return "Prefix contains invalid characters"
    }
    if (value.startsWith("-")) {
      return "Prefix cannot start with -"
    }
    return undefined
  }

  useInput((input, key) => {
    if (step === "show") {
      if (key.escape) {
        onComplete()
      } else if (key.return || input === "c" || input === "C") {
        // Clear prefix
        handleSavePrefix("")
      } else if (input === "s" || input === "S") {
        // Set new prefix
        setStep("input")
      }
    } else if (step === "done") {
      if (key.return || key.escape || input) {
        onComplete()
      }
    } else if (error) {
      if (key.return || key.escape || input) {
        setError(undefined)
        setStep("show")
      }
    }
  })

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.ERROR}>{error}</Text>
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Press any key to continue...</Text>
        </Box>
      </Box>
    )
  }

  if (step === "saving") {
    return <StatusIndicator status="loading" message="Saving prefix..." />
  }

  if (step === "done") {
    return (
      <Box flexDirection="column">
        <StatusIndicator status="success" message={message} spinner={false} />
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Saved to {LOCAL_CONFIG_FILE_NAME}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>Press any key to exit...</Text>
        </Box>
      </Box>
    )
  }

  if (step === "input") {
    return (
      <InputPrompt
        label="Enter branch prefix:"
        placeholder="e.g., john or feature (trailing / added automatically)"
        validate={validatePrefix}
        onSubmit={handlePrefixSubmit}
        onCancel={onComplete}
      />
    )
  }

  // step === "show"
  return (
    <Box flexDirection="column">
      <Text bold>Branch Prefix Configuration</Text>
      <Box marginTop={1}>
        {currentPrefix ? (
          <Text>
            Current prefix: <Text color={COLORS.PRIMARY} bold>{currentPrefix}</Text>
          </Text>
        ) : (
          <Text color={COLORS.MUTED}>No branch prefix configured</Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.MUTED}>
          Press <Text bold>s</Text> to set a new prefix
        </Text>
        {currentPrefix && (
          <Text color={COLORS.MUTED}>
            Press <Text bold>c</Text> to clear the prefix
          </Text>
        )}
        <Text color={COLORS.MUTED}>
          Press <Text bold>Esc</Text> to exit
        </Text>
      </Box>
    </Box>
  )
}
