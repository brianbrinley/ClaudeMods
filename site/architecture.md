# Architecture

How the mods work inside, drawn for people who want the detail behind the READMEs. Five diagrams, from the whole repository down to a single shell command. Each one opens full size, and follows the site's Day or Night theme.

The same diagrams in Boomi's [Exosphere](https://exosphere.boomi.com/) look, to share with Boomi people, are in [`docs/architecture`](../docs/architecture/README.md) with how they're built.

## How the mods and Companion fit together

boomi-runtime provisions a temporary Boomi runtime and writes Companion's environment file. Companion builds and tests on it through the Boomi platform. boomi-dashboard reads the runtime mod's state and watches Companion's steps, their cost and the budget. boomi-standards is set aside, so it's drawn dashed; the dashboard already reads its state for when it returns.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d5-mods.html" title="How the mods and Companion fit together" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d5-mods.html"><span>Open full size</span><span class="visually-hidden">: How the mods and Companion fit together</span></a></div>
</figure>

Read with: [boomi-runtime](../boomi-runtime/README.md), and the dashboard's [Guardrails](../boomi-dashboard/README.md#what-you-see).

## How boomi-dashboard plugs into Claude Code

Claude Code raises events that one hooks module handles. It calls pure, unit-tested modules, keeps state, and draws the pane, banner and status line. It reaches Companion's docs, Boomi's Platform API, a model and git only where it needs to.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d1-overview.html" title="How boomi-dashboard plugs into Claude Code" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d1-overview.html"><span>Open full size</span><span class="visually-hidden">: How boomi-dashboard plugs into Claude Code</span></a></div>
</figure>

Read with: the dashboard's [How it works](../boomi-dashboard/README.md#how-it-works).

## From a shell command to a pane row and a budget decision

What the dashboard does with each shell command Claude runs. A Companion change while a budget is spent is refused, or asked about in `confirm` mode. Every other command is noted as running, run, read into a step, recorded, and shown in the pane, the status line and a toast.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d4-budget-gate.html" title="From a shell command to a pane row and a budget decision" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d4-budget-gate.html"><span>Open full size</span><span class="visually-hidden">: From a shell command to a pane row and a budget decision</span></a></div>
</figure>

Read with: [Budget enforcement](../boomi-dashboard/README.md#budget-enforcement).

## What happens to a prompt you type

A suggestion taken with Tab passes straight through. Any other Boomi prompt is checked by rules, shown with tips and a quick upgrade in the Prompt tab, and held while a model writes a better upgrade in the background and swaps it in. The upgrade you send goes in unchecked, so it can't loop back.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d2-prompt-lifecycle.html" title="What happens to a prompt you type" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d2-prompt-lifecycle.html"><span>Open full size</span><span class="visually-hidden">: What happens to a prompt you type</span></a></div>
</figure>

Read with: [Prompt tips](../boomi-dashboard/README.md#prompt-tips).

## How the dashboard stays aware of Companion

Installed plugin versions decide whether the index of pointers to Companion's docs is rebuilt, and then only for what changed. A prompt's words pick a few sections to read for the model. The dashboard's own guide, stamped with a version, is compared with what's installed, so a person reviews any drift.

<figure class="diagram">
<div class="diagram-frame"><iframe src="../docs/architecture/valence/d3-companion-awareness.html" title="How the dashboard stays aware of Companion" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a class="diagram-open" href="../docs/architecture/valence/d3-companion-awareness.html"><span>Open full size</span><span class="visually-hidden">: How the dashboard stays aware of Companion</span></a></div>
</figure>

Read with: [Prompt tips](../boomi-dashboard/README.md#prompt-tips) and `/bc-dashboard prompt guide` under [Commands and tools](../boomi-dashboard/README.md#commands-and-tools).
