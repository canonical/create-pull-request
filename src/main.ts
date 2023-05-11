import * as fs from 'fs'

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'
import {CreatePullRequest} from './create-pull-request'

/**
 * Get a list of locally changed files from the base branch.
 * @param base - Base branch name, fully qualified (refs/heads/branch).
 * @return A map of relevant filename and file content of locally changed files.
 */
async function getDiffFiles(base: string): Promise<Map<string, Buffer>> {
  await exec.exec('git', ['add', '-A'])
  const diffFiles: string = (
    await exec.getExecOutput('git', ['diff', '--name-only', base])
  ).stdout.trim()
  if (!diffFiles) {
    return new Map()
  }
  const result: Map<string, Buffer> = new Map()
  for (const file of diffFiles.split('\n')) {
    result.set(file, fs.readFileSync(file))
  }
  return result
}

async function run(): Promise<void> {
  try {
    const octokit = github.getOctokit(
      core.getInput('github-token', {required: true})
    )
    const owner = github.context.repo.owner
    const repo = github.context.repo.repo
    const base = github.context.ref
    const head = `refs/heads/${core.getInput('branch-name', {required: true})}`
    const diffFiles = await getDiffFiles(base)
    core.info(`pickup local changes: ${Array.from(diffFiles.keys())}`)
    if (diffFiles.size === 0) {
      if (!core.getBooleanInput('ignore-no-changes')) {
        core.setFailed(`no file changed from ${base}`)
      } else {
        core.warning(`no file changed from ${base}`)
      }
      return
    }
    const createPullRequest = new CreatePullRequest({octokit, owner, repo})
    const upsert = core.getBooleanInput('upsert')
    const headExists = await createPullRequest.refExists(head)
    if (headExists && !upsert) {
      core.setFailed(`head branch ${head} already exists`)
      return
    }
    const commitSha = await createPullRequest.createCommit({
      base,
      diffFiles,
      message: core.getInput('commit-message', {required: true})
    })
    const pullRequestParams = {
      base,
      head,
      title: core.getInput('title', {required: true}),
      body: core.getInput('body'),
      commitSha
    }
    if (headExists) {
      await createPullRequest.updateBranchAndPull(pullRequestParams)
    } else {
      await createPullRequest.createBranchAndPull(pullRequestParams)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
