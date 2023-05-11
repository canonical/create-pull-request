import * as fs from 'fs'

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'

async function run(): Promise<void> {
  try {
    const octokit = github.getOctokit(
      core.getInput('github-token', {required: true})
    )
    const baseBranch = core.getInput('base-branch')
      ? core.getInput('base-branch')
      : github.context.ref
    await exec.exec('git', ['add', '-A'])
    const diffFiles: string[] = (
      await exec.getExecOutput('git', ['diff', '--name-only', baseBranch])
    ).stdout
      .trim()
      .split('\n')
    core.info(`pickup local changes: ${diffFiles}`)
    if (!diffFiles) {
      core.setFailed(`no file changed from ${baseBranch}`)
      return
    }
    const newBranch = core.getInput('branch-name', {required: true})
    const blobs: Map<string, string> = new Map()
    for (const file of diffFiles) {
      const blob = (
        await octokit.rest.git.createBlob({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          content: fs.readFileSync(file, {encoding: 'utf-8'})
        })
      ).data.sha
      blobs.set(file, blob)
      core.info(`upload blob: ${file} (${blob})`)
    }
    const parentRef = github.context.ref.replace('refs/', '')
    core.info(
      `attempt to find ref ${parentRef} in github.com/${github.context.repo.owner}/${github.context.repo.repo}`
    )
    const parent = (
      await octokit.rest.git.getRef({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        ref: parentRef
      })
    ).data.object.sha
    core.info(`retrieve parent ref: ${github.context.ref} (${parent})`)
    const tree = (
      await octokit.rest.git.createTree({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        base_tree: parent,
        tree: diffFiles.map(file => ({
          path: file,
          mode: '100644',
          type: 'blob',
          sha: blobs.get(file)
        }))
      })
    ).data.sha
    core.info(`create tree: ${tree}`)
    const commit = (
      await octokit.rest.git.createCommit({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        parents: [parent],
        tree,
        message: core.getInput('commit-message', {required: true})
      })
    ).data
    core.info(
      `create commit ${commit.sha}, parents: ${commit.parents}, message: ${commit.message}`
    )
    core.info(`attempt to create branch ${newBranch}`)
    const ref = (
      await octokit.rest.git.createRef({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        ref: `refs/heads/${newBranch}`,
        sha: commit.sha
      })
    ).data
    core.info(`create ref: ${ref.ref} with commit ${commit.sha}`)
    const pullRequest = (
      await octokit.rest.pulls.create({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        base: baseBranch,
        head: ref.ref,
        title: core.getInput('title', {required: true}),
        body: core.getInput('body')
      })
    ).data
    core.info(
      `create pull request ${pullRequest.title}, base: ${pullRequest.base}, head: ${pullRequest.head}`
    )
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
