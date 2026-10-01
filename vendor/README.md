# vendor/claudemeter

[Claudemeter](https://github.com/hyperi-io/claudemeter) 2.5.20 by HyperI, MIT license
(see `LICENSE.txt` and `NOTICE` in this folder). It shows your Claude session and weekly
usage in the status bar, using the Claude Code login already on your machine.

This folder is the packaged extension (what the marketplace ships), built from the
upstream source with its own build script. Kural copies it in as a built-in extension.

To update to a newer version:

```bash
git clone --depth 1 https://github.com/hyperi-io/claudemeter /tmp/claudemeter
cd /tmp/claudemeter && npm ci && npx vsce package --no-dependencies -o /tmp/claudemeter.vsix
rm -rf vendor/claudemeter && mkdir -p /tmp/cm && unzip -q /tmp/claudemeter.vsix -d /tmp/cm
mv /tmp/cm/extension vendor/claudemeter   # then put this README.md back
```
