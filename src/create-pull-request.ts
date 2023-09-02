import {GitHub} from '@actions/github/lib/utils'
import {RequestError} from '@octokit/request-error'
import * as core from '@actions/core'

interface BranchAndPullRequestOptions {
  head: string
  base: string
  title: string
  body: string
  commitSha: string
}

export interface DiffFile {
  content: Buffer | null
  mode: string
  path: string
}

export class CreatePullRequest {
  private readonly octokit: InstanceType<typeof GitHub>
  private readonly owner: string
  private readonly repo: string

  /**
   *
   * @param octokit - Github client.
   * @param owner - Github repository owner.
   * @param repo - Github repository name.
   */
  constructor({
    octokit,
    owner,
    repo
  }: {
    octokit: InstanceType<typeof GitHub>
    owner: string
    repo: string
  }) {
    this.octokit = octokit
    this.owner = owner
    this.repo = repo
  }

  /**
   * Check if a reference exists on GitHub.
   * @param ref - Fully qualified reference name, for example: refs/heads/branch.
   * @return True if the reference exists.
   */
  async refExists(ref: string): Promise<boolean> {
    try {
      await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: ref.replace('refs/', '')
      })
      return true
    } catch (error) {
      if (error instanceof RequestError && error.status === 404) {
        return false
      } else {
        throw error
      }
    }
  }

  /**
   * Create a branch and pull request on GitHub.
   * @param head - Head branch name, fully qualified (refs/heads/branch)
   * @param base - Base branch name, fully qualified (refs/heads/branch)
   * @param title - Pull request title.
   * @param body - Pull request body.
   * @param commitSha - The sha of the commit that the new branch will point at.
   */
  async createBranchAndPull({
    head,
    base,
    title,
    body,
    commitSha
  }: BranchAndPullRequestOptions): Promise<number> {
    core.info(`attempt to create branch ${head}`)
    const ref = (
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: head,
        sha: commitSha
      })
    ).data
    core.info(`create ref: ${ref.ref} with commit ${commitSha}`)
    const pullRequest = (
      await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        base,
        head: ref.ref,
        title,
        body
      })
    ).data
    core.info(
      `create pull request ${pullRequest.title}, base: ${pullRequest.base.ref}, head: ${pullRequest.head.ref}`
    )
    return pullRequest.number
  }

  /**
   * Update the existing branch and pull request on GitHub.
   * There must be one and only one open pull request in the repository associated with the given head and base.
   * @param head - Head branch name, fully qualified (refs/heads/branch)
   * @param base - Base branch name, fully qualified (refs/heads/branch)
   * @param title - The new title for the existing pull request.
   * @param body - The new body for the existing pull request.
   * @param commitSha - Update the existing branch to point to this commit.
   */
  async updateBranchAndPull({
    head,
    base,
    title,
    body,
    commitSha
  }: BranchAndPullRequestOptions): Promise<number> {
    core.warning(`force update branch ${head} to ${commitSha}`)
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: head.replace('refs/', ''),
      sha: commitSha,
      force: true
    })
    const pulls = (
      await this.octokit.rest.pulls.list({
        owner: this.owner,
        repo: this.repo,
        head: `${this.owner}:${head.replace('refs/heads/', '')}`,
        base: base.replace('refs/heads/', ''),
        state: 'open'
      })
    ).data
    if (pulls.length === 0) {
      const pullRequest = (
        await this.octokit.rest.pulls.create({
          owner: this.owner,
          repo: this.repo,
          base,
          head,
          title,
          body
        })
      ).data
      core.info(
        `create pull request ${pullRequest.title}, base: ${pullRequest.base.ref}, head: ${pullRequest.head.ref}`
      )
      return pullRequest.number
    }
    if (pulls.length > 1) {
      const pullNumbers = pulls.map(p => p.number)
      throw Error(
        `multiple pull requests ${pullNumbers} associated with ${head} from ${base}`
      )
    }
    const pull = pulls[0]
    core.warning(`update pull request #${pull.number}`)
    await this.octokit.rest.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: pull.number,
      title,
      body
    })
    return pull.number
  }

  /**
   * Create a git commit on GitHub.
   * @param base - Base branch name, fully qualified (refs/heads/branch).
   * @param diffFiles - Changed files in this commit.
   * @param message - Git commit message.
   * @return SHA of the new git commit.
   */
  async createCommit({
    base,
    diffFiles,
    message
  }: {
    base: string
    diffFiles: DiffFile[]
    message: string
  }): Promise<string> {
    const blobs: Map<string, string> = new Map()
    for (const diffFile of diffFiles) {
      if (diffFile.content !== null) {
        const blob = (
          await this.octokit.rest.git.createBlob({
            owner: this.owner,
            repo: this.repo,
            content: diffFile.content.toString('base64'),
            encoding: 'base64'
          })
        ).data.sha
        blobs.set(diffFile.path, blob)
        core.info(`upload blob: ${diffFile.path} (${blob})`)
      }
    }
    core.info(
      `attempt to find ref ${base} in github.com/${this.owner}/${this.repo}`
    )
    const parent = (
      await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: base.replace('refs/', '')
      })
    ).data.object.sha
    core.info(`retrieve parent ref: ${base} (${parent})`)
    const tree = (
      await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: parent,
        tree: diffFiles.map(diffFile => ({
          path: diffFile.path,
          mode: diffFile.mode as
            | '100644'
            | '100755'
            | '040000'
            | '160000'
            | '120000',
          type: 'blob',
          sha: diffFile.content === null ? null : blobs.get(diffFile.path)
        }))
      })
    ).data.sha
    core.info(`create tree: ${tree}`)
    const commit = (
      await this.octokit.rest.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        parents: [parent],
        tree,
        message
      })
    ).data
    core.info(
      `create commit ${commit.sha}, parents: ${commit.parents.map(
        p => p.sha
      )}, message: ${commit.message}`
    )
    return commit.sha
  }
}
