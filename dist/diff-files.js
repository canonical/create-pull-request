"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiffFiles = getDiffFiles;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Get a list of locally changed files from the base branch.
 * @param base - Base branch name, fully qualified (refs/heads/branch).
 * @param cwd - Set the working directory.
 * @return A list of locally changed files.
 */
async function getDiffFiles(base, cwd = undefined) {
    await exec.exec('git', ['add', '-A'], { cwd });
    const gitStatus = await exec.getExecOutput('git', ['status', '-s'], { cwd });
    if (gitStatus.stdout.trim() === '') {
        return [];
    }
    const stashObject = (await exec.getExecOutput('git', ['stash', 'create'], { cwd })).stdout.trim();
    const getTreeList = async (ref) => {
        core.startGroup(`git ls-tree ${ref}`);
        const list = (await exec.getExecOutput('git', [
            'ls-tree',
            ref,
            '-r',
            '-z',
            '--format',
            '%(objectmode) %(objecttype) %(objectname) %(path)'
        ], { cwd })).stdout.split('\u0000');
        core.endGroup();
        if (list.length > 0 && list[list.length - 1] === '') {
            list.pop();
        }
        return list;
    };
    const parseTreeEntry = (entry) => {
        const treeEntryRe = /^(?<objectmode>\d+) (?<objecttype>\w+) (?<objectname>[0-9a-f]+) (?<path>.+)$/s;
        const match = entry.match(treeEntryRe);
        if (!match || !match.groups) {
            throw Error(`unrecognized git ls-tree output: '${entry}'`);
        }
        return match.groups;
    };
    const treeList = (await getTreeList(stashObject))
        .map(parseTreeEntry)
        .filter(groups => groups.objecttype === 'blob');
    const baseTreeList = (await getTreeList(base))
        .map(parseTreeEntry)
        .filter(groups => groups.objecttype === 'blob');
    const treeEntries = new Map(treeList.map(groups => [groups.path, groups]));
    const baseTreeEntries = new Map(baseTreeList.map(groups => [groups.path, groups]));
    const updatedFiles = treeList
        .filter(groups => !(baseTreeEntries.has(groups.path) &&
        baseTreeEntries.get(groups.path)?.objectname === groups.objectname &&
        baseTreeEntries.get(groups.path)?.objectmode === groups.objectmode))
        .map(groups => {
        const filePath = path.join(cwd ? cwd : '', groups.path);
        return {
            path: groups.path,
            mode: groups.objectmode,
            content: groups.objectmode === '120000'
                ? fs.readlinkSync(filePath, { encoding: 'buffer' })
                : fs.readFileSync(filePath)
        };
    });
    const deletedFiles = baseTreeList
        .filter(groups => !treeEntries.has(groups.path))
        .map(groups => ({
        path: groups.path,
        mode: groups.objectmode,
        content: null
    }));
    return updatedFiles.concat(deletedFiles);
}
