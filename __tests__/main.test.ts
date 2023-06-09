import * as crypto from 'crypto'

import * as github from '@actions/github'
import {expect, test} from '@jest/globals'

import {CreatePullRequest} from '../src/create-pull-request'

const token: string = process.env.TEST_GITHUB_TOKEN!
const owner: string = process.env.TEST_GITHUB_OWNER!
const repo: string = process.env.TEST_GITHUB_REPO!

test('create new pull request', async () => {
  const octokit = github.getOctokit(token)
  const createPullRequest = new CreatePullRequest({
    octokit,
    owner,
    repo
  })
  const commit = await createPullRequest.createCommit({
    base: 'refs/heads/main',
    diffFiles: new Map(
      Object.entries({
        hello: 'Hello, World!',
        test: 'Hello, Test!'
      })
    ),
    message: `test ${new Date().toISOString()}`
  })
  await createPullRequest.createBranchAndPull({
    head: `refs/heads/test-${crypto.randomBytes(4).toString('hex')}`,
    base: `refs/heads/main`,
    title: `test ${new Date().toISOString()}`,
    body: '',
    commitSha: commit
  })
}, 60 * 1000)

test('update pull request', async () => {
  const octokit = github.getOctokit(token)
  const createPullRequest = new CreatePullRequest({
    octokit,
    owner,
    repo
  })
  const commit = await createPullRequest.createCommit({
    base: 'refs/heads/main',
    diffFiles: new Map(
      Object.entries({
        test: `Hello, Test! (${new Date().toISOString()})`
      })
    ),
    message: `test ${new Date().toISOString()}`
  })
  await createPullRequest.updateBranchAndPull({
    head: 'refs/heads/test-branch',
    base: 'refs/heads/main',
    title: `test ${new Date().toISOString()}`,
    body: `test ${new Date().toISOString()}`,
    commitSha: commit
  })
}, 60 * 1000)

test('update branch without pull request', async () => {
  const octokit = github.getOctokit(token)
  const createPullRequest = new CreatePullRequest({
    octokit,
    owner,
    repo
  })
  const commit = await createPullRequest.createCommit({
    base: 'refs/heads/main',
    diffFiles: new Map(
      Object.entries({
        test: `Hello, Test! (${new Date().toISOString()})`
      })
    ),
    message: `test ${new Date().toISOString()}`
  })
  const pulls = (
    await octokit.rest.pulls.list({
      owner: owner,
      repo: repo,
      head: 'refs/heads/test-branch',
      base: 'refs/heads/main',
      state: 'open'
    })
  ).data
  for (const pull of pulls) {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pull.number,
      state: 'closed'
    })
  }
  await createPullRequest.updateBranchAndPull({
    head: 'refs/heads/test-branch',
    base: 'refs/heads/main',
    title: `test ${new Date().toISOString()}`,
    body: `test ${new Date().toISOString()}`,
    commitSha: commit
  })
}, 60 * 1000)
