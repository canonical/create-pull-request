import * as fs from 'fs'
import * as path from 'path'

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'

import {CreatePullRequest, DiffFile} from './create-pull-request'

/**
 * Get a list of locally changed files from the base branch.
 * @param base - Base branch name, fully qualified (refs/heads/branch).
 * @param cwd - Set the working directory.
 * @return A list of locally changed files.
 */
export async function getDiffFiles(
  base: string,
  cwd: string | undefined = undefined
): Promise<DiffFile[]> {
  await exec.exec('git', ['add', '-A'], {cwd})
  const stashObject = (
    await exec.getExecOutput('git', ['stash', 'create'], {cwd})
  ).stdout.trim()
  const getTreeList = async (ref: string): Promise<string[]> => {
    const list = (
      await exec.getExecOutput(
        'git',
        [
          'ls-tree',
          ref,
          '-r',
          '-z',
          '--format',
          '%(objectmode) %(objecttype) %(objectname) %(path)'
        ],
        {cwd, silent: true}
      )
    ).stdout.split('\u0000')
    if (list.length > 0 && list[list.length - 1] === '') {
      list.pop()
    }
    return list
  }
  const parseTreeEntry = (entry: string): {[key: string]: string} => {
    const treeEntryRe =
      /^(?<objectmode>\d+) (?<objecttype>\w+) (?<objectname>[0-9a-f]+) (?<path>.+)$/s
    const match = entry.match(treeEntryRe)
    if (!match || !match.groups) {
      throw Error(`unrecognized git ls-tree output: '${entry}'`)
    }
    return match.groups
  }
  const treeList = (await getTreeList(stashObject))
    .map(parseTreeEntry)
    .filter(groups => groups.objecttype === 'blob')

  const baseTreeList = (await getTreeList(base))
    .map(parseTreeEntry)
    .filter(groups => groups.objecttype === 'blob')
  const treeEntries = new Map(treeList.map(groups => [groups.path, groups]))
  const baseTreeEntries = new Map(
    baseTreeList.map(groups => [groups.path, groups])
  )
  const updatedFiles: DiffFile[] = treeList
    .filter(
      groups =>
        !(
          baseTreeEntries.has(groups.path) &&
          baseTreeEntries.get(groups.path)?.objectname === groups.objectname &&
          baseTreeEntries.get(groups.path)?.objectmode === groups.objectmode
        )
    )
    .map(groups => {
      const filePath = path.join(cwd ? cwd : '', groups.path)
      return {
        path: groups.path,
        mode: groups.objectmode,
        content:
          groups.objectmode === '120000'
            ? fs.readlinkSync(filePath, {encoding: 'buffer'})
            : fs.readFileSync(filePath)
      }
    })
  const deletedFiles: DiffFile[] = baseTreeList
    .filter(groups => !treeEntries.has(groups.path))
    .map(groups => ({
      path: groups.path,
      mode: groups.objectmode,
      content: null
    }))
  return updatedFiles.concat(deletedFiles)
}

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', {required: true})
    const octokit = github.getOctokit(githubToken)
    const owner = github.context.repo.owner
    const repo = github.context.repo.repo
    const base = github.context.ref
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
