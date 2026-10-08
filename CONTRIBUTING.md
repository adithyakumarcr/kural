# Contributing to Kural

Thanks for helping!

## Reporting a bug

Use **Issues → New issue → Bug report**. It asks for what the bug is, the steps to reproduce it, and screenshots:
without those, a bug usually can't be fixed. Ideas go in **Idea for a feature**.

## Changing the code

Only Adithya merges pull requests into `main`; nobody can push to it directly.

1. Fork the repo and make a branch: `git checkout -b my-change`
2. Make your change. Run the tests: `npm test`. Try it: `./install.sh` (Mac or Ubuntu).
3. Push your branch and open a pull request to `main`. Say what you changed, why, and how you tested it.
4. The tests run automatically. Adithya reviews the pull request and merges it, or asks for changes.

Security-relevant changes (the updater, permissions, the browser proxy, build scripts, workflows) need a test and a note
in the pull request saying which threat they address (see [docs/threat-model.md](docs/threat-model.md)).

Releases are made only by the maintainer, by tagging `main` (see "Releases" in the README).

## License

By contributing, you agree that your change is shared under Kural's license: MIT with the Commons Clause (free to
use and change, also at work; not to be sold). See [LICENSE](LICENSE).
