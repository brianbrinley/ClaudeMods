# Architecture

The READMEs tell you what the mods do. These diagrams show how they do it. The first one is the big picture, and the rest zoom in on the dashboard. Click any diagram to open it full size.

If you're sharing these with people at Boomi, there's a copy of each in Boomi's own [Exosphere](https://exosphere.boomi.com/) style in [`docs/architecture`](../docs/architecture/README.md).

## How the mods and Companion fit together

boomi-runtime spins up a temporary Boomi runtime for your session and writes Companion's `.env`, so Companion knows where to build. Companion then builds and tests against that runtime. The dashboard sits off to the side. It reads boomi-runtime's state and watches what Companion does, what it costs, and how much of your budget is left.

boomi-standards is dashed because it's on hold for now. The dashboard still reads its state, so nothing has to change when it comes back.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d5-mods.html" title="How the mods and Companion fit together" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d5-mods.html"><span>Open full size</span><span class="visually-hidden">: How the mods and Companion fit together</span></a></div>
</figure>

The [boomi-runtime README](../boomi-runtime/README.md) covers the runtime side.

## How the dashboard plugs into Claude Code

Everything the dashboard does starts with an event from Claude Code, and one hooks module (`register.tsx`) picks them all up. The real logic lives in small, plain modules with their own unit tests. The hooks module turns their results into the pane, the banner above the prompt and the status line.

It only reaches outside the session when it has to: to read Companion's docs, poll Boomi's Platform API, ask a model to rewrite a prompt, or check git for an update.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d1-overview.html" title="How boomi-dashboard plugs into Claude Code" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d1-overview.html"><span>Open full size</span><span class="visually-hidden">: How boomi-dashboard plugs into Claude Code</span></a></div>
</figure>

There's a shorter version of this on the dashboard's [How it works](../boomi-dashboard/README.md#how-it-works) page.

## What happens when Claude runs a shell command

Usually nothing gets in the way. The dashboard marks the command as running, lets it run, reads the output, and records a step that shows up in the pane, the status line and a toast.

The exception is a spent budget. If Claude tries to change something in Boomi after the budget is used up (a create, push, deploy or test run), the dashboard refuses it, or asks you first if you've set `confirm`. Reads and status checks always go through.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d4-budget-gate.html" title="What happens when Claude runs a shell command" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d4-budget-gate.html"><span>Open full size</span><span class="visually-hidden">: What happens when Claude runs a shell command</span></a></div>
</figure>

[Budget enforcement](../boomi-dashboard/README.md#budget-enforcement) has the settings.

## What happens to a prompt you type

If you take a suggestion with Tab, it goes straight to Claude. Anything else that looks like Boomi work gets checked first. By default the dashboard holds the prompt and shows you tips and a rough upgrade in the Prompt tab. Meanwhile it asks a model for a better rewrite, which replaces the rough one when it's ready.

Whatever you send from the Prompt tab goes through unchecked, so it can't get stuck in a loop.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d2-prompt-lifecycle.html" title="What happens to a prompt you type" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d2-prompt-lifecycle.html"><span>Open full size</span><span class="visually-hidden">: What happens to a prompt you type</span></a></div>
</figure>

[Prompt tips](../boomi-dashboard/README.md#prompt-tips) explains the settings.

## How the dashboard keeps up with Companion

Companion changes often, so the dashboard doesn't keep its own copy of the docs. It keeps an index of pointers into them instead. The index is only rebuilt when a Companion plugin's version changes, and then only for the docs that actually changed. When you type a prompt, its words pick the few sections worth sending to the model.

The dashboard also has its own guide to what Claude should ask before each kind of Boomi work. It's stamped with the Companion version it was written for. When Companion moves ahead, the Prompt tab tells you, and a model can draft edits for you to review. It never edits the guide on its own.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d3-companion-awareness.html" title="How the dashboard keeps up with Companion" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d3-companion-awareness.html"><span>Open full size</span><span class="visually-hidden">: How the dashboard keeps up with Companion</span></a></div>
</figure>

To compare the guide with what's installed, run `/bc-dashboard prompt guide` (see [Commands and tools](../boomi-dashboard/README.md#commands-and-tools)).
