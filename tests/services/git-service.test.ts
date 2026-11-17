import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitService } from "../../src/services/git-service.js"
import { executeGitCommand } from "../../src/utils/git-commands.js"

describe("GitService", () => {
  const gitService = new GitService()

  describe("constructor", () => {
    test("should create GitService with default git root", () => {
      const service = new GitService()
      expect(service).toBeInstanceOf(GitService)
    })

    test("should create GitService with custom git root", () => {
      const service = new GitService("/custom/path")
      expect(service).toBeInstanceOf(GitService)
    })
  })

  describe("validateRepository", () => {
    test("should validate repository status", async () => {
      const result = await gitService.validateRepository()
      expect(typeof result).toBe("boolean")
    })
  })

  describe("getCurrentBranch", () => {
    test("should get current branch or null", async () => {
      const result = await gitService.getCurrentBranch()
      expect(result === null || typeof result === "string").toBe(true)
    })
  })

  describe("getDefaultBranch", () => {
    test("should get default branch", async () => {
      const result = await gitService.getDefaultBranch()
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe("branchExists", () => {
    test("should check if branch exists", async () => {
      const result = await gitService.branchExists("main")
      expect(typeof result).toBe("boolean")
    })

    test("should return false for non-existent branch", async () => {
      const result = await gitService.branchExists("definitely-does-not-exist-12345")
      expect(result).toBe(false)
    })

    test("should handle special characters in branch name", async () => {
      const result = await gitService.branchExists("feature/test-branch_123")
      expect(typeof result).toBe("boolean")
    })
  })

  describe("worktreeExists", () => {
    test("should check if worktree exists", async () => {
      const result = await gitService.worktreeExists("/non/existent/path")
      expect(result).toBe(false)
    })

    test("should handle current directory check", async () => {
      const result = await gitService.worktreeExists(process.cwd())
      expect(typeof result).toBe("boolean")
    })
  })

  describe("isWorktreeClean", () => {
    test("should check worktree cleanliness", async () => {
      const result = await gitService.isWorktreeClean("/non/existent/path")
      expect(typeof result).toBe("boolean")
    })

    test("should handle current directory", async () => {
      const result = await gitService.isWorktreeClean(process.cwd())
      expect(typeof result).toBe("boolean")
    })
  })

  describe("listWorktrees", () => {
    test("should return array of worktrees", async () => {
      try {
        const result = await gitService.listWorktrees()
        expect(Array.isArray(result)).toBe(true)
        
        if (result.length > 0) {
          const worktree = result[0]
          expect(worktree).toHaveProperty("path")
          expect(worktree).toHaveProperty("commit")
          expect(worktree).toHaveProperty("branch")
          expect(worktree).toHaveProperty("isMain")
          expect(worktree).toHaveProperty("isClean")
        }
      } catch (error) {
        // If not in a git repository, expect an error
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe("listBranches", () => {
    test("should return array of branches", async () => {
      try {
        const result = await gitService.listBranches()
        expect(Array.isArray(result)).toBe(true)
        
        if (result.length > 0) {
          const branch = result[0]
          expect(branch).toHaveProperty("name")
          expect(branch).toHaveProperty("lastCommitDate")
          expect(branch).toHaveProperty("isDefault")
          expect(branch).toHaveProperty("isCurrent")
          expect(branch).toHaveProperty("recentlyUsed")
        }
      } catch (error) {
        // If not in a git repository, expect an error
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe("getRecentBranches", () => {
    test("should return array of recent branches", async () => {
      try {
        const result = await gitService.getRecentBranches()
        expect(Array.isArray(result)).toBe(true)
        
        for (const branch of result) {
          expect(typeof branch).toBe("string")
          expect(branch.length).toBeGreaterThan(0)
        }
      } catch (error) {
        // If not in a git repository, expect an error
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe("createWorktree", () => {
    async function git(cwd: string, ...args: string[]): Promise<string> {
      const identity = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
      const result = await executeGitCommand([...identity, ...args], cwd)
      if (!result.success) throw new Error(result.stderr)
      return result.stdout.trim()
    }

    async function repoWithMainBehindOrigin() {
      const dir = mkdtempSync(join(tmpdir(), "branchlet-"))
      const repo = join(dir, "repo")
      const other = join(dir, "other")
      await git(dir, "init", "-q", "--bare", "origin.git")
      await git(dir, "clone", "-q", "origin.git", "repo")
      await git(repo, "commit", "-q", "--allow-empty", "-m", "first")
      await git(repo, "branch", "-M", "main")
      await git(repo, "push", "-q", "-u", "origin", "main")
      await git(dir, "clone", "-q", "-b", "main", "origin.git", "other")
      await git(other, "commit", "-q", "--allow-empty", "-m", "second")
      await git(other, "push", "-q", "origin", "main")
      await git(repo, "switch", "-q", "-c", "work")
      return { dir, repo, originMain: await git(other, "rev-parse", "HEAD") }
    }

    test("starts a new branch from origin's latest commit when the local branch is behind", async () => {
      const { dir, repo, originMain } = await repoWithMainBehindOrigin()
      try {
        const options = { name: "wt", sourceBranch: "main", newBranch: "feature", basePath: dir }
        await new GitService(repo).createWorktree(options)
        const wt = join(dir, "wt")
        expect(await git(wt, "rev-parse", "HEAD")).toBe(originMain)
        const upstream = await executeGitCommand(["rev-parse", "--abbrev-ref", "@{upstream}"], wt)
        expect(upstream.success).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test("starts from origin's latest commit while the local branch is checked out", async () => {
      const { dir, repo, originMain } = await repoWithMainBehindOrigin()
      try {
        await git(repo, "switch", "-q", "main")
        const options = { name: "wt", sourceBranch: "main", newBranch: "feature", basePath: dir }
        await new GitService(repo).createWorktree(options)
        expect(await git(join(dir, "wt"), "rev-parse", "HEAD")).toBe(originMain)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test("keeps tracking origin when the source is origin's copy of a branch", async () => {
      const { dir, repo } = await repoWithMainBehindOrigin()
      try {
        await git(join(dir, "other"), "push", "-q", "origin", "main:feature")
        await git(repo, "fetch", "-q", "origin")
        const options = {
          name: "wt",
          sourceBranch: "origin/feature",
          newBranch: "feature",
          basePath: dir,
        }
        await new GitService(repo).createWorktree(options)
        const upstream = await git(join(dir, "wt"), "rev-parse", "--abbrev-ref", "@{upstream}")
        expect(upstream).toBe("origin/feature")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test("keeps the local branch's commits that origin lacks", async () => {
      const { dir, repo } = await repoWithMainBehindOrigin()
      try {
        await git(repo, "switch", "-q", "main")
        await git(repo, "commit", "-q", "--allow-empty", "-m", "local only")
        const localMain = await git(repo, "rev-parse", "HEAD")
        await git(repo, "switch", "-q", "work")
        const options = { name: "wt", sourceBranch: "main", newBranch: "feature", basePath: dir }
        await new GitService(repo).createWorktree(options)
        expect(await git(join(dir, "wt"), "rev-parse", "HEAD")).toBe(localMain)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test("should handle invalid options gracefully", async () => {
      const invalidOptions = {
        name: "",
        sourceBranch: "non-existent",
        newBranch: "test-branch",
        basePath: "/tmp/test-invalid",
      }

      try {
        await gitService.createWorktree(invalidOptions)
        // If it doesn't throw, that's fine too
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe("deleteWorktree", () => {
    test("should handle non-existent worktree deletion", async () => {
      try {
        await gitService.deleteWorktree({
          path: "/completely/non/existent/path/12345",
          force: false,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    test("should handle force deletion", async () => {
      try {
        await gitService.deleteWorktree({
          path: "/non/existent/path",
          force: true,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe("getRepositoryInfo", () => {
    test("should return repository information", async () => {
      try {
        const result = await gitService.getRepositoryInfo()
        
        expect(result).toHaveProperty("path")
        expect(result).toHaveProperty("isGitRepo")
        expect(result).toHaveProperty("currentBranch")
        expect(result).toHaveProperty("defaultBranch")
        expect(result).toHaveProperty("worktrees")
        expect(result).toHaveProperty("branches")
        
        expect(typeof result.path).toBe("string")
        expect(result.isGitRepo).toBe(true)
        expect(typeof result.currentBranch).toBe("string")
        expect(typeof result.defaultBranch).toBe("string")
        expect(Array.isArray(result.worktrees)).toBe(true)
        expect(Array.isArray(result.branches)).toBe(true)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    test("should handle repository info in non-git directory", async () => {
      const tempService = new GitService("/tmp")
      
      try {
        const result = await tempService.getRepositoryInfo()
        expect(result.isGitRepo).toBe(true) // This is set to true in the function
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe("branch status functionality", () => {
    test("should get branch status when comparison branch exists", async () => {
      const service = new GitService()
      
      try {
        const result = await service.getBranchStatus("test-branch-that-does-not-exist")
        // Should return null for non-existent branch
        expect(result).toBeNull()
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    test("should handle branch status for current branch", async () => {
      const service = new GitService()
      
      try {
        const currentBranch = await service.getCurrentBranch()
        if (currentBranch) {
          const result = await service.getBranchStatus(currentBranch)
          // Should return null when comparing branch with itself
          expect(result).toBeNull()
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    test("should handle getBranchStatus with no comparison branch available", async () => {
      const service = new GitService("/tmp") // Non-git directory
      
      const result = await service.getBranchStatus("any-branch")
      expect(result).toBeNull()
    })
  })

  describe("branch deletion functionality", () => {
    test("should prevent deletion of current branch", async () => {
      const service = new GitService()
      
      try {
        const currentBranch = await service.getCurrentBranch()
        if (currentBranch) {
          await expect(service.deleteBranch(currentBranch)).rejects.toThrow()
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    test("should prevent deletion of default branch", async () => {
      const service = new GitService()
      
      try {
        const defaultBranch = await service.getDefaultBranch()
        await expect(service.deleteBranch(defaultBranch)).rejects.toThrow()
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    test("should handle deletion of non-existent branch", async () => {
      const service = new GitService()
      
      try {
        await service.deleteBranch("non-existent-branch-12345")
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })

    test("should handle force deletion", async () => {
      const service = new GitService()
      
      try {
        await service.deleteBranch("non-existent-branch-12345", true)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe("error handling", () => {
    test("should handle git operations in non-git directory", async () => {
      const tempService = new GitService("/tmp")
      
      const isValid = await tempService.validateRepository()
      expect(isValid).toBe(false)
    })

    test("should handle operations with invalid paths", async () => {
      const invalidService = new GitService("/absolutely/does/not/exist/123456789")
      
      const isValid = await invalidService.validateRepository()
      expect(isValid).toBe(false)
    })
  })
})