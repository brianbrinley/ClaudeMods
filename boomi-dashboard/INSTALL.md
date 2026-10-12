# Install the Boomi Companion Dashboard on your own computer

To install the dashboard in Claude Code on your computer, paste the prompt below into a Claude Code session. Start that session from your Boomi Companion workspace, the folder with Companion's `.env`. It works for any Claude account: nothing in the mod is tied to one.

```text
Install the boomi-dashboard Claude Code mod from https://github.com/brianbrinley/ClaudeMods for my user account, so it loads in every Claude Code session on this computer.

1. Clone the repo (main branch) to ~/ClaudeMods. If it's already there, run `git -C ~/ClaudeMods pull` instead.
2. Check that ~/ClaudeMods/boomi-dashboard/.claude-plugin/plugin.json and ~/ClaudeMods/boomi-dashboard/hooks/register.tsx exist, then run `claude plugin validate ~/ClaudeMods/boomi-dashboard` and `claude plugin test ~/ClaudeMods/boomi-dashboard` and show me the results.
3. Add the mod to the "env" block of my user settings file, ~/.claude/settings.json (not the project's settings):
   "CLAUDE_CODE_PLUGIN_DIRS": "<absolute path to ~/ClaudeMods/boomi-dashboard>"
   Use the absolute path, with my home folder spelled out. If CLAUDE_CODE_PLUGIN_DIRS already has a value, append to it with ":" (";" on Windows) instead of replacing it. Keep everything else in the file as it is, and show me the diff before you save.
4. Check that Boomi Companion (bc-integration) is installed. If it isn't, tell me how to install it, but don't install it yourself.
5. Tell me to restart Claude Code. After the restart I'll run /bc-dashboard to check it loaded.

Never read, print or copy my .env or any Boomi credentials. The mod reads them itself.
```

## After the restart

- Run `/bc-dashboard`. It should say nothing needs attention and that no components have shown up yet.
- Have Claude build something with Companion. Each component appears in the pane as Claude edits it, saves it to Boomi, deploys it and tests it, and the banner above the prompt shows the latest step.
- Run `/bc-dashboard poll` to check the connection to Boomi. If credentials or `BOOMI_ENVIRONMENT_ID` are missing, the Live environment section says which.
- The pane starts in the Day theme. Press **Night** or **Terminal** at the top of the pane, or run `/bc-dashboard theme night`, to switch.

## Updating

Run `git -C ~/ClaudeMods pull`, then restart Claude Code.

**If you installed it as boomi-cockpit:** the mod's folder is now `boomi-dashboard` and its command is `/bc-dashboard`. After the pull, change `boomi-cockpit` to `boomi-dashboard` in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, then restart. Settings you changed under `/config` and the watch list start over under the new name.
