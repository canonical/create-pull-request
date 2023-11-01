import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'

import {CreatePullRequest} from './create-pull-request'
import {getDiffFiles} from './diff-files'

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', {required: true})
    const octokit = github.getOctokit(githubToken)
    const owner = github.context.repo.owner
    const repo = github.context.repo.repo
    let base = core.getInput('base')
    if (base === '') {
      base = github.context.ref
    } else {
      base = `refs/heads/${base}`
    }
    if (
      (await exec.exec('git', ['rev-parse', '--verify', base], {
        ignoreReturnCode: true
      })) !== 0
    ) {
      core.setFailed(`base "${base}" doesn't exist locally`)
      return
    }
    const head = `refs/heads/${core.getInput('branch-name', {required: true})}`
    const diffFiles = await getDiffFiles(base)
    core.info(`pickup local changes: ${Array.from(diffFiles.keys())}`)
    if (diffFiles.length === 0) {
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
    let prNum: number
    if (headExists) {
      prNum = await createPullRequest.updateBranchAndPull(pullRequestParams)
    } else {
      prNum = await createPullRequest.createBranchAndPull(pullRequestParams)
    }
    if (core.getBooleanInput('auto-merge')) {
      await exec.exec(
        'gh',
        [
          'pr',
          'merge',
          '-R',
          `${owner}/${repo}`,
          '--squash',
          '--delete-branch',
          '--auto',
          prNum.toString()
        ],
        {env: {GH_TOKEN: githubToken}}
      )
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
