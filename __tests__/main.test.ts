import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as httpClient from '@actions/http-client'
import {expect, test} from '@jest/globals'

import {CreatePullRequest} from '../src/create-pull-request'
import {getDiffFiles} from '../src/main'

const token: string = process.env.TEST_GITHUB_TOKEN!
const owner: string = process.env.TEST_GITHUB_OWNER!
const repo: string = process.env.TEST_GITHUB_REPO!
const http: httpClient.HttpClient = new httpClient.HttpClient()

function removeIndex(diff: string): string {
  return diff
    .split('\n')
    .filter(line => !line.startsWith('index '))
    .join('\n')
}

async function checkDiff(prNum: number, exceptDiff: string) {
  const deadline = Date.now() + 15 * 1000
  let diff = ''
  while (Date.now() < deadline) {
    diff = await (
      await http.get(
        `https://patch-diff.githubusercontent.com/raw/${owner}/${repo}/pull/${prNum}.diff`
      )
    ).readBody()
    if (removeIndex(diff) === exceptDiff) {
      break
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  expect(removeIndex(diff)).toEqual(exceptDiff)
}

test(
  'create new pull request',
  async () => {
    const octokit = github.getOctokit(token)
    const createPullRequest = new CreatePullRequest({
      octokit,
      owner,
      repo
    })
    const commit = await createPullRequest.createCommit({
      base: 'refs/heads/main',
      diffFiles: [
        {
          path: 'hello',
          mode: '100644',
          content: Buffer.from('Hello, World!')
        },
        {
          path: 'test',
          mode: '100644',
          content: Buffer.from('Hello, Test!')
        },
        {
          path: 'dir/test',
          mode: '100644',
          content: null
        }
      ],
      message: `test ${new Date().toISOString()}`
    })
    const num = await createPullRequest.createBranchAndPull({
      head: `refs/heads/test-${crypto.randomBytes(4).toString('hex')}`,
      base: `refs/heads/main`,
      title: `test ${new Date().toISOString()}`,
      body: '',
      commitSha: commit
    })
    await checkDiff(
      num,
      [
        'diff --git a/dir/test b/dir/test',
        'deleted file mode 100644',
        '--- a/dir/test',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-test',
        'diff --git a/hello b/hello',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/hello',
        '@@ -0,0 +1 @@',
        '+Hello, World!',
        '\\ No newline at end of file',
        'diff --git a/test b/test',
        '--- a/test',
        '+++ b/test',
        '@@ -1 +1 @@',
        '-test',
        '+Hello, Test!',
        '\\ No newline at end of file\n'
      ].join('\n')
    )
  },
  60 * 1000
)

test(
  'update pull request',
  async () => {
    const octokit = github.getOctokit(token)
    const createPullRequest = new CreatePullRequest({
      octokit,
      owner,
      repo
    })
    const testStr = `Hello, Test! (${new Date().toISOString()})`
    const commit = await createPullRequest.createCommit({
      base: 'refs/heads/main',
      diffFiles: [
        {
          path: 'test',
          mode: '100644',
          content: Buffer.from(testStr)
        }
      ],
      message: `test ${new Date().toISOString()}`
    })
    const num = await createPullRequest.updateBranchAndPull({
      head: 'refs/heads/test-branch',
      base: 'refs/heads/main',
      title: `test ${new Date().toISOString()}`,
      body: `test ${new Date().toISOString()}`,
      commitSha: commit
    })

    await checkDiff(
      num,
      [
        'diff --git a/test b/test',
        '--- a/test',
        '+++ b/test',
        '@@ -1 +1 @@',
        '-test',
        `+${testStr}`,
        '\\ No newline at end of file\n'
      ].join('\n')
    )
  },
  60 * 1000
)

test(
  'update branch without pull request',
  async () => {
    const octokit = github.getOctokit(token)
    const createPullRequest = new CreatePullRequest({
      octokit,
      owner,
      repo
    })
    const testStr = `Hello, Test! (${new Date().toISOString()})`
    const commit = await createPullRequest.createCommit({
      base: 'refs/heads/main',
      diffFiles: [
        {
          path: 'test',
          mode: '100644',
          content: Buffer.from(testStr)
        }
      ],
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
    const num = await createPullRequest.updateBranchAndPull({
      head: 'refs/heads/test-branch',
      base: 'refs/heads/main',
      title: `test ${new Date().toISOString()}`,
      body: `test ${new Date().toISOString()}`,
      commitSha: commit
    })
    await checkDiff(
      num,
      [
        'diff --git a/test b/test',
        '--- a/test',
        '+++ b/test',
        '@@ -1 +1 @@',
        '-test',
        `+${testStr}`,
        '\\ No newline at end of file\n'
      ].join('\n')
    )
  },
  60 * 1000
)

test('get diff files', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'test-create-pr-'))
  await exec.exec('git', ['init', '-b', 'main'], {cwd})
  fs.writeFileSync(path.join(cwd, 'test'), 'test')
  fs.mkdirSync(path.join(cwd, 'dir'))
  fs.writeFileSync(path.join(cwd, 'dir', 'test'), 'test')
  await exec.exec('git', ['config', 'commit.gpgsign', 'false'], {cwd})
  await exec.exec('git', ['config', 'user.email', 'you@example.com'], {cwd})
  await exec.exec('git', ['config', 'user.name', 'Your Name'], {cwd})
  await exec.exec('git', ['add', '-A'], {cwd})
  await exec.exec('git', ['commit', '-m', 'first commit'], {cwd})
  expect(await getDiffFiles('main', cwd)).toEqual([])
  fs.writeFileSync(path.join(cwd, 'hello'), 'hello')
  expect(await getDiffFiles('main', cwd)).toEqual([
    {path: 'hello', mode: '100644', content: Buffer.from('hello')}
  ])
  fs.chmodSync(path.join(cwd, 'test'), 0o755)
  expect(await getDiffFiles('main', cwd)).toEqual([
    {path: 'hello', mode: '100644', content: Buffer.from('hello')},
    {path: 'test', mode: '100755', content: Buffer.from('test')}
  ])
  fs.writeFileSync(path.join(cwd, 'test'), 'foobar')
  expect(await getDiffFiles('main', cwd)).toEqual([
    {path: 'hello', mode: '100644', content: Buffer.from('hello')},
    {path: 'test', mode: '100755', content: Buffer.from('foobar')}
  ])
  fs.symlinkSync('./test', path.join(cwd, 'symlink'))
  expect(await getDiffFiles('main', cwd)).toEqual([
    {path: 'hello', mode: '100644', content: Buffer.from('hello')},
    {path: 'symlink', mode: '120000', content: Buffer.from('./test')},
    {path: 'test', mode: '100755', content: Buffer.from('foobar')}
  ])
  fs.writeFileSync(path.join(cwd, 'dir', 'test'), 'bar')
  expect(await getDiffFiles('main', cwd)).toEqual([
    {path: 'dir/test', mode: '100644', content: Buffer.from('bar')},
    {path: 'hello', mode: '100644', content: Buffer.from('hello')},
    {path: 'symlink', mode: '120000', content: Buffer.from('./test')},
    {path: 'test', mode: '100755', content: Buffer.from('foobar')}
  ])
  fs.unlinkSync(path.join(cwd, 'dir', 'test'))
  expect(await getDiffFiles('main', cwd)).toEqual([
    {path: 'hello', mode: '100644', content: Buffer.from('hello')},
    {path: 'symlink', mode: '120000', content: Buffer.from('./test')},
    {path: 'test', mode: '100755', content: Buffer.from('foobar')},
    {path: 'dir/test', mode: '100644', content: null}
  ])
  fs.writeFileSync(path.join(cwd, 'dir', 'exe'), '')
  fs.chmodSync(path.join(cwd, 'dir', 'exe'), 0o755)
  expect(await getDiffFiles('main', cwd)).toEqual([
    {path: 'dir/exe', mode: '100755', content: Buffer.alloc(0)},
    {path: 'hello', mode: '100644', content: Buffer.from('hello')},
    {path: 'symlink', mode: '120000', content: Buffer.from('./test')},
    {path: 'test', mode: '100755', content: Buffer.from('foobar')},
    {path: 'dir/test', mode: '100644', content: null}
  ])
})
