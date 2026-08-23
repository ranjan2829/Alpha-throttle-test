You are running this harness on Cursor Origin.

Kingsley Advani (22 Aug 2026): Cursor origin · Alpha throttle test · make a recursive agent on cursor origin.

Install and login (human, once), then host this tree:

```
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
npx tsx src/cli.ts origin-setup
```

`origin-setup` mirrors GitHub onto Origin when you are logged in:

```
origin repo create-mirrored 'ranjan2829/Alpha-throttle-test' --namespace allocations
origin auth setup-git --local
git push -u cursor-origin HEAD
```

Clone if the Origin repo already exists:

```
origin repo clone 'allocations/Alpha-throttle-test'
# or
git clone 'https://origin.cursor.com/allocations/Alpha-throttle-test'
```

If this workspace already has a GitHub `origin` remote, keep it. Origin is `cursor-origin`.

Live throttle (default forge is Origin):

```
npx tsx src/cli.ts throttle --live --rate 1 --max 3 --forge origin --repo allocations/Alpha-throttle-test
```

Do not open thousands of live changes. Keep `--max` unless the user raised it.
