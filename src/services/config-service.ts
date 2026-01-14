import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  DEFAULT_CONFIG,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  LOCAL_CONFIG_FILE_NAME,
} from "../constants/index"
import {
  validateConfig,
  type WorktreeConfig,
  WorktreeConfigSchema,
} from "../schemas/config-schema.js"
import type { ConfigFile } from "../types/index"
import { ConfigError } from "../utils/index"

export class ConfigService {
  private config: WorktreeConfig
  private configPath?: string

  constructor() {
    this.config = { ...DEFAULT_CONFIG }
  }

  async loadConfig(projectPath?: string): Promise<WorktreeConfig> {
    await this.ensureGlobalConfig()

    // 1. Load global config first as base
    try {
      const globalContent = await readFile(GLOBAL_CONFIG_FILE, "utf-8")
      const globalParsed = JSON.parse(globalContent)
      const globalValidation = validateConfig(globalParsed)
      if (globalValidation.success && globalValidation.data) {
        this.config = globalValidation.data
      }
    } catch {
      // Global config might not exist yet, that's ok
    }

    // 2. Find and overlay local config if it exists
    const localPath = join(projectPath || process.cwd(), LOCAL_CONFIG_FILE_NAME)
    try {
      await access(localPath)
      const localContent = await readFile(localPath, "utf-8")
      const localParsed = JSON.parse(localContent)
      const localValidation = validateConfig(localParsed)
      if (localValidation.success && localValidation.data) {
        // Merge: local overrides global
        this.config = { ...this.config, ...localValidation.data }
        this.configPath = localPath
      }
    } catch {
      // No local config, use global path
      this.configPath = GLOBAL_CONFIG_FILE
    }

    return this.config
  }

  async saveConfig(config: WorktreeConfig, path?: string): Promise<void> {
    const configPath = path || this.configPath

    if (!configPath) {
      throw new ConfigError("No config path available for saving")
    }

    const validation = validateConfig(config)
    if (!validation.success) {
      throw new ConfigError(`Invalid configuration: ${validation.error}`)
    }

    try {
      await mkdir(dirname(configPath), { recursive: true })
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")

      this.config = { ...config }
      this.configPath = configPath
    } catch (error) {
      throw new ConfigError(`Failed to save config to ${configPath}: ${error}`)
    }
  }

  getConfig(): WorktreeConfig {
    return { ...this.config }
  }

  updateConfig(updates: Partial<WorktreeConfig>): WorktreeConfig {
    this.config = { ...this.config, ...updates }
    return this.getConfig()
  }

  resetConfig(): WorktreeConfig {
    this.config = { ...DEFAULT_CONFIG }
    return this.getConfig()
  }

  private async findConfigFile(projectPath?: string): Promise<ConfigFile | null> {
    const searchPaths: string[] = []
    const baseDir = projectPath || process.cwd()

    searchPaths.push(join(baseDir, LOCAL_CONFIG_FILE_NAME))
    searchPaths.push(GLOBAL_CONFIG_FILE)

    for (const path of searchPaths) {
      try {
        await access(path)
        return {
          config: this.config,
          path,
          isGlobal: path.includes(GLOBAL_CONFIG_DIR),
        }
      } catch {}
    }

    return null
  }

  async ensureGlobalConfig(): Promise<void> {
    try {
      await access(GLOBAL_CONFIG_FILE)
    } catch {
      await mkdir(GLOBAL_CONFIG_DIR, { recursive: true })
      const defaultConfig = WorktreeConfigSchema.parse(DEFAULT_CONFIG)
      await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), "utf-8")
    }
  }

  async createGlobalConfig(): Promise<string> {
    await mkdir(GLOBAL_CONFIG_DIR, { recursive: true })
    const defaultConfig = WorktreeConfigSchema.parse(DEFAULT_CONFIG)
    await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), "utf-8")

    this.config = defaultConfig
    this.configPath = GLOBAL_CONFIG_FILE
    return GLOBAL_CONFIG_FILE
  }

  async hasGlobalConfig(): Promise<boolean> {
    try {
      await access(GLOBAL_CONFIG_FILE)
      return true
    } catch {
      return false
    }
  }

  getConfigPath(): string | undefined {
    return this.configPath
  }
}
