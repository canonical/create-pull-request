import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as github from '@actions/github'

import {CreatePullRequest} from '../src/create-pull-request'
import {getDiffFiles} from '../src/diff-files'

/**
 * Run build and package after dependabot updated the package.json.
 */
async function main(): Promise<void> {
  try {
    const branch = process.env.GITHUB_HEAD_REF as string
    const base = `refs/heads/${branch}`
    await exec.exec('npm', ['run', 'build'])
    await exec.exec('npm', ['run', 'package'])
    const diffFiles = await getDiffFiles(base)
    if (diffFiles.length === 0) {
      core.info(`no file changed from ${base}`)
      return
    }
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN as string)
    const owner = process.env.GITHUB_REPOSITORY_OWNER as string
    const repo = (process.env.GITHUB_REPOSITORY as string).split('/')[1]
    const createPullRequest = new CreatePullRequest({octokit, owner, repo})
    const commit = await createPullRequest.createCommit({
      base,
      diffFiles,
      message: 'Build dist (reopen PR to trigger CI)'
    })
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit
    })
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

main()
