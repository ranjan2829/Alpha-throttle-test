You are running this harness on Cursor Origin.

Install and login (human, once):

```
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
```

Clone:

```
origin repo clone 'allocations/Alpha-throttle-test'
# or
git clone 'https://origin.cursor.com/allocations/Alpha-throttle-test'
```

Push a local tree:

```
git init -b 'main'
git remote add origin 'https://origin.cursor.com/allocations/Alpha-throttle-test'
git add .
git commit -m "Initial commit"
git push -u origin 'main'
```

If this workspace already has a GitHub `origin` remote, add Origin beside it:

```
git remote add cursor-origin 'https://origin.cursor.com/allocations/Alpha-throttle-test'
origin auth setup-git --local
```

Live throttle (default forge is Origin):

```
npx tsx src/cli.ts throttle --live --rate 1 --max 3 --forge origin --repo allocations/Alpha-throttle-test
```

Do not open thousands of live changes. Keep `--max` unless the user raised it.
