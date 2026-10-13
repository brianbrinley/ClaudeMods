# Mod Ideas

Ideas for mods we could build next, starting with Boomi and integration work. The ideas below aren't built yet. Treat it as a brainstorm: add ideas, argue with the rankings, and claim one to build.

**Built from this page so far:**
- The Companion guardrail, now the [boomi-standards](boomi-standards/README.md) mod.
- The deployment watcher, folded into the [boomi-dashboard](boomi-dashboard/README.md) mod: a live summary of a Companion session that watches components for changes. (Polling the environment's runs is set aside for now; see [Dashboard follow-ups](#dashboard-follow-ups).)
- The first half of the execution debugger, in the dashboard: **Why?** reads a failed run's process log and **Ask Claude to fix** drafts the request. A session report (`/bc-dashboard report`) came with it.
- Dashboard follow-ups: **Run again** for a failed test, a spend budget (`budgetUsd`), and the next step (deploy, then test) suggested in the prompt box.
- Guardrails at a glance: the dashboard's **Guardrails** section shows what boomi-standards blocked and the runtime's state.
- Companion's activity log as a second source, and a new-session banner with the last session's recap and tips.

The [boomi-runtime](boomi-runtime/README.md) mod shows what a mod can do. It provisions a temporary Boomi runtime in the session, smoke-tests it, hands it to Boomi Companion through a shared `.env` and tears everything down at the end, while keeping the Platform API token out of the conversation. Mods can add:

- slash commands
- tools Claude can call
- network, process and file access
- session state
- lifecycle hooks, including hooks before and after every tool call
- status lines and panes

## What makes a good mod idea

A mod is worth building over a skill or a script when it uses something only a mod has:

- **Work that outlasts Claude's reply.** Polling, installs and watchers keep running in the background while you keep chatting.
- **A hook on every tool call.** A mod can check, refuse or redact what Claude does before or after it happens. `boomi-runtime` uses this to guard the API token.
- **The session's own runtime.** The Boomi runtime runs in the session's container, so a mod can put files in local folders the runtime reads, read its execution logs on disk, and start local services for it to call.
- **Commands that cost no tokens.** Slash commands run the same way every time without Claude interpreting them.

One limit to design around: **the Claude Code web app doesn't show status lines or panes yet.** An idea that depends on a pane should also work through a slash command.

## Value and effort

```mermaid
%%{init: {"theme": "base", "fontFamily": "Josefin Sans, trebuchet ms, verdana, arial, sans-serif", "themeVariables": {"fontSize": "15px", "background": "#FBF6EE", "primaryColor": "#FBF6EE", "primaryTextColor": "#0B0B0B", "primaryBorderColor": "#9A7B3F", "lineColor": "#9A7B3F", "textColor": "#0B0B0B", "secondaryColor": "#9FDED6", "tertiaryColor": "#FBE7A1", "edgeLabelBackground": "#FBF6EE", "clusterBkg": "#FBF6EE", "clusterBorder": "#9A7B3F", "actorBkg": "#F7A8C4", "actorBorder": "#C2185B", "actorTextColor": "#0B0B0B", "actorLineColor": "#9A7B3F", "signalColor": "#0B0B0B", "signalTextColor": "#0B0B0B", "labelBoxBkgColor": "#FBE7A1", "labelBoxBorderColor": "#9A7B3F", "labelTextColor": "#0B0B0B", "loopTextColor": "#0B0B0B", "noteBkgColor": "#FBE7A1", "noteBorderColor": "#9A7B3F", "noteTextColor": "#0B0B0B", "activationBkgColor": "#9FDED6", "activationBorderColor": "#0F766E", "sequenceNumberColor": "#FBF6EE"}}}%%
quadrantChart
    title Business value and effort
    x-axis Less effort --> More effort
    y-axis Lower value --> Higher value
    quadrant-1 Plan carefully
    quadrant-2 Build next
    quadrant-3 Nice to have
    quadrant-4 Wait
    Execution debugger: [0.36, 0.80]
    Broker quick wins: [0.14, 0.74]
    Test harness: [0.72, 0.84]
    Mock endpoints: [0.55, 0.66]
    Secret guard: [0.30, 0.40]
    Promotion diff: [0.58, 0.48]
    Env extensions: [0.52, 0.40]
    Full broker: [0.88, 0.42]
```

| Rank | Idea | Business value | Effort | Status |
|---|---|---|---|---|
| 1 | [Execution debugger](#execution-debugger) | High | Small to medium | Log reading built into the dashboard; per-step documents next |
| 2 | [Credential broker: quick wins](#credential-broker) | High | Small | Secure-storage token tried and removed; API-user guide kept |
| 3 | [Process test harness](#process-test-harness) | High | Medium to large | Idea |
| 4 | [Mock endpoints](#mock-endpoints) | Medium to high | Medium | Idea |
| 5 | [General secret guard](#general-secret-guard) | Medium | Small to medium | Idea |
| 6 | [Promotion diff](#promotion-diff) | Medium | Medium | Idea |
| 7 | [Environment extensions manager](#environment-extensions-manager) | Medium | Medium | Idea |
| 8 | [Credential broker: full](#credential-broker) | Medium | Large | Idea |

## The ideas

### Execution debugger

**Show Claude which step of a process failed, and what data it had at that point.**

- **Problem:** When a test execution fails, Claude often sees little more than `ERROR` and has to guess.
- **Idea:** A `/boomi trace <execution>` command and a `trace` tool Claude can call. They pull the execution's process log and each step's documents from the local runtime, then summarize where the documents stopped and why.
- **Why a mod:** The runtime runs in the session's container, so the execution artifacts are on local disk. This extends the existing `logs` tool.
- **Open question:** Which execution artifacts the runtime keeps on disk by default, and for how long.
- **Built so far:** The dashboard's **Why?** button reads the process log through Companion's own script. What's left is each step's documents from a local runtime.

### Credential broker

**Let mods and skills call the Platform API without the token ever being visible in the session.**

- **Quick wins:**
  - **Tried and removed:** the token in Claude Code's secure storage, handed to Companion's scripts only while one ran. Tests and a fake-token probe passed, but in real use it broke Companion, so it came out (boomi-runtime 0.3.0). Don't retry it without a live Companion session to test against.
  - **Kept:** a dedicated API user with only the permissions the work needs, and how to rotate its token, in the [boomi-runtime README](boomi-runtime/README.md#a-dedicated-api-user).
  - Still to try: the cloud environment's network secrets, which add credentials in the proxy.
- **Full broker:** The mod holds the token and offers a `boomi_api` tool that makes allow-listed Platform API calls for other mods and skills, so none of them needs the token.
- **Limit:** Companion's scripts read the token from `.env`, and the broker can't change that. It protects everything except Companion's own calls, which is why the full version ranks lower than the quick wins.

### Process test harness

**Run sample documents through a deployed process and compare the outputs with expected results.**

- **Problem:** Integrations rarely have regression tests, so a mapping change can quietly break a field nobody checked.
- **Idea:** A `tests/` folder of input documents and expected outputs per process. `/boomi test <process>` deploys a test wrapper, runs every case and reports differences field by field. Claude can call the same command after each change.
- **Why a mod:** The Platform API's execute call takes process properties, not documents. The local runtime gets around that: a Disk connector in the wrapper reads inputs from a harness folder and writes outputs to another, so the mod controls both ends with no extra infrastructure.
- **Open questions:**
  - Overlap with Companion's own testing.
  - The Platform API can't delete components, so the wrapper must be created once and reused.

### Mock endpoints

**Test processes that call external systems without touching those systems.**

- **Problem:** Testing a process that posts to Salesforce, NetSuite or a partner API needs access, credentials and test data in that system.
- **Idea:** The mod starts a local mock HTTP server for the session. It records real responses once, or serves hand-written ones, and replays them. `/mock record`, `/mock replay` and `/mock show` manage it, and the requests a process sent can be checked in tests.
- **Why a mod:** It starts a background process for the session and stops it when the session ends. The runtime is in the same container, so it can reach the mock on `localhost`.

### General secret guard

**Apply the token guard to every credential, not only Boomi's.**

- **Idea:** Move the guard and redaction out of `boomi-runtime` into a reusable mod configured with a list of variable names and file patterns. It then covers Salesforce, AWS and partner keys too.
- **Why now:** It matters more once mock endpoints and test harnesses bring more systems into a session.

### Promotion diff

**Show what would change before a release moves from TEST to PROD.**

- **Idea:** Compare the packaged component versions deployed to two environments and write release notes from the differences. Optionally, refuse to promote anything this session hasn't smoke-tested or run through the test harness.
- **Care needed:** It touches production. Start read-only, so it reports and never deploys.

### Environment extensions manager

**View and set connection settings and process properties per environment, with secrets masked.**

- **Idea:** `/boomi ext show <environment>` and `/boomi ext set` use the same masking as `/boomi env`, so Claude can configure an environment without seeing its passwords.
- **Open question:** How much Companion already covers.

### Dashboard follow-ups

Smaller additions to the [boomi-dashboard](boomi-dashboard/README.md) mod that build on what it already tracks:

- **Process runs in Boomi, again:** up to 0.10.0 the dashboard polled the runs on the runtimes attached to `BOOMI_ENVIRONMENT_ID` and showed this session's components' runs (tests, listener calls, schedules), toasting new failures. It was set aside in 0.11.0 to come back to later. The plain functions (`recentRuns`, `sessionRuns`, `runsOf`, `newFailures`) and the Platform API client's `environmentAtoms` and `recentRuns` are still in the mod with their tests; what's needed is the polling, the pane section and the text and report sections again.
- **Promotion diff and mock endpoints** would each show up as a section in the pane once they exist.

## Add an idea or claim one

- **Add an idea:** Open a pull request that adds a section under [The ideas](#the-ideas) and a row in the table. Give it a **problem**, the **idea**, **why a mod** (what it needs that a skill or script can't do) and any **open questions**. Rough is fine.
- **Disagree with a ranking:** Change it in the same kind of pull request and say why in the description.
- **Claim an idea:** Set its status to **In progress** with your GitHub handle. Build it as a mod following the [project conventions](CLAUDE.md), and when it ships, move it from this page to the **Mods** table in the [README](README.md).
