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
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const github = __importStar(require("@actions/github"));
const create_pull_request_1 = require("./create-pull-request");
const diff_files_1 = require("./diff-files");
async function run() {
    try {
        const githubToken = core.getInput('github-token', { required: true });
        const octokit = github.getOctokit(githubToken);
        let owner = github.context.repo.owner;
        let repo = github.context.repo.repo;
        if (core.getInput('repository') !== '') {
            ;
            [owner, repo] = core.getInput('repository').split('/');
        }
        let base = core.getInput('base');
        if (base === '') {
            base = github.context.ref;
        }
        else {
            base = `refs/heads/${base}`;
        }
        if ((await exec.exec('git', ['rev-parse', '--verify', base], {
            ignoreReturnCode: true
        })) !== 0) {
            core.setFailed(`base "${base}" doesn't exist locally`);
            return;
        }
        const head = `refs/heads/${core.getInput('branch-name', { required: true })}`;
        const diffFiles = await (0, diff_files_1.getDiffFiles)(base);
        core.info(`pickup local changes: ${Array.from(diffFiles.keys())}`);
        if (diffFiles.length === 0) {
            if (!core.getBooleanInput('ignore-no-changes')) {
                core.setFailed(`no file changed from ${base}`);
            }
            else {
                core.warning(`no file changed from ${base}`);
            }
            return;
        }
        const createPullRequest = new create_pull_request_1.CreatePullRequest({ octokit, owner, repo });
        const upsert = core.getBooleanInput('upsert');
        const headExists = await createPullRequest.refExists(head);
        if (headExists && !upsert) {
            core.setFailed(`head branch ${head} already exists`);
            return;
        }
        const commitSha = await createPullRequest.createCommit({
            base,
            diffFiles,
            message: core.getInput('commit-message', { required: true })
        });
        const pullRequestParams = {
            base,
            head,
            title: core.getInput('title', { required: true }),
            body: core.getInput('body'),
            commitSha
        };
        let prNum;
        if (headExists) {
            prNum = await createPullRequest.updateBranchAndPull(pullRequestParams);
        }
        else {
            prNum = await createPullRequest.createBranchAndPull(pullRequestParams);
        }
        if (core.getBooleanInput('auto-merge')) {
            await exec.exec('gh', [
                'pr',
                'merge',
                '-R',
                `${owner}/${repo}`,
                '--squash',
                '--delete-branch',
                '--auto',
                prNum.toString()
            ], { env: { GH_TOKEN: githubToken } });
        }
    }
    catch (error) {
        if (error instanceof Error)
            core.setFailed(error.message);
    }
}
run();
