# canonical/create-pull-request

This action is used to create a pull request from local changes.

## Usage

```yaml
  test:
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
