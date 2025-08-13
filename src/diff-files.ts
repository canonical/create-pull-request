import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as path from 'path'

import {DiffFile} from './create-pull-request.js'

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
  const gitStatus = await exec.getExecOutput('git', ['status', '-s'], {cwd})
  if (gitStatus.stdout.trim() === '') {
    return []
  }
  const stashObject = (
    await exec.getExecOutput('git', ['stash', 'create'], {cwd})
  ).stdout.trim()
  const getTreeList = async (ref: string): Promise<string[]> => {
    core.startGroup(`git ls-tree ${ref}`)
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
        {cwd}
      )
    ).stdout.split('\u0000')
    core.endGroup()
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
