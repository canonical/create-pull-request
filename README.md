# canonical/create-pull-request

This GitHub action automates the process of creating a pull request from local
changes. It utilizes the GitHub REST API to create commits. If the GitHub token
used in this action is a bot token, the commits will be created as signed and
shown as verified.

## Inputs

### `inputs.github-token`

The GitHub token required to perform actions such as pushing commits and
creating pull requests.

### `inputs.branch-name`

The name of the new branch to be created by this action. If an existing branch
with the same name exists in the repository, the action will fail, unless the
`upsert` option is enabled. In that case, the branch will be force-updated.

### `inputs.commit-message`

The commit message for the new commit created by this action.

### `inputs.title`

The title of the pull request that will be created.

### `inputs.body`

**Optional**

The body content of the pull request. This can provide additional information or
context for the changes being made.

### `inputs.upsert`

**Options:** `true | false`

**Default:** `false`

By default, the action fails if there's an existing branch with the same name in
the repository. Enabling `upsert` allows this action to update the existing
branch and its related pull request instead of doing nothing and failing.

**WARNING**: In upsert mode, commits in the existing branch will be
irreversibly removed.

### `inputs.ignore-no-changes`

**Options:** `true | false`

**Default:** `false`

By default, the action fails if no local changes are detected. Enabling this
option allows the action to do nothing and exit successfully when there are no
changes.

## Usage

```yaml
  create-pull-request:
    permissions: write-all
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Change local files
        run: |
          echo hello > hello
          echo new-test > test

      - name: Create pull request
        uses: canonical/create-pull-request@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          commit-message: Test commit message
          branch-name: new-branch
          title: Test pull request
          body: Test pull request body
```
