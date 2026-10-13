import { expect, test } from 'claude-code/testing';
import { attention, closeItem, diagnose, fixPrompt, report, guardrails, guardrailText, pastSessions, historyTotals, historySummary, pastParts, projectsDiffer, runWords, budgetOf, nextStep, closedCount, reopenAll, compareWatched, componentOf, componentPath, components, describe, FLAMINGO_IDLE, flamingo, cachedTokens, formatTokens, newTokens, totalTokens, friendlyType, meter, modelMix, modelSplits, tokenSplit, modelName, pixelCells, newFailures, readOutput, readResults, assignResults, githubUrl, parseResults, runsOf, runsSummary, recentRuns, scriptRuns, sparkline, spendOf, spends, stages, statusLine, summary, recapOf, recapLine, welcomeLine, TIPS, parseActivityLog, logStep, newLogSteps, choicesOf, choiceLabel, choiceFrom, choiceList, pondRows, sceneAt, sceneRows, limitViews, limitsLine, limitsShort, span, shareView, pruneDays, monthSpend, monthView, resumeCommand, resumable, } from '../hooks/activity';
import { agentstudioReading, bdiRunId, bdiRunReading, bdiStatusChecks, causeWords, datahubDeployReading, datahubStatusChecks, deployState, productWords, quarantineChecks, quarantineReading } from '../hooks/products';
import { reviewPrompt, reviewSession, reviewText } from '../hooks/review';
const ID = '1a2b3c4d-1111-2222-3333-444455556666';
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const dashboard = (activity = [], extra = {}) => ({
    activity,
    platform: { phase: 'off', message: 'Off: no Boomi credentials.', runs: [] },
    watched: [],
    ...extra,
});
let nextId = 0;
const act = (kind, outcome, subject, at, more = {}) => ({
    id: ++nextId,
    kind,
    outcome,
    subject,
    detail: outcome,
    startedAt: at,
    endedAt: at,
    ...more,
});
const FILE = 'active-development/processes/Orders.xml';
/** The script runs in a command, without the folder each ran from (its own test checks that). */
const runsIn = (command) => scriptRuns(command).map(({ scriptsDir: _dir, args: _args, ...run }) => run);
test('scriptRuns finds the Companion scripts a command runs and what they name', () => {
    expect(runsIn(`cd work && bash scripts/boomi-component-push.sh ${FILE} --branch dev && bash scripts/boomi-deploy.sh ${FILE} --deployment-notes "first cut"`)).toEqual([
        { kind: 'push', file: `work/${FILE}` },
        { kind: 'deploy', file: `work/${FILE}` },
    ]);
    expect(runsIn(`bash scripts/boomi-test-execute.sh --process-id ${ID} --test-data in.json`)).toEqual([{ kind: 'test', processId: ID }]);
    expect(runsIn('bash scripts/boomi-undeploy.sh dep-123')).toEqual([{ kind: 'undeploy', deploymentId: 'dep-123' }]);
    expect(runsIn(`bash scripts/boomi-component-pull.sh --component-id ${ID}`)).toEqual([{ kind: 'pull', componentId: ID }]);
});
test("scriptRuns notes Companion's other scripts, and finds scripts inside bash -c", () => {
    expect(runsIn('bash scripts/boomi-component-search.sh --name Orders')).toEqual([{ kind: 'other', script: 'component-search' }]);
    expect(runsIn(`bash -c 'cd x && bash scripts/boomi-deploy.sh ${FILE}'`)).toEqual([{ kind: 'deploy', file: `x/${FILE}` }]);
});
test('scriptRuns leaves out help, connection tests, the shared library and other commands', () => {
    expect(runsIn('bash scripts/boomi-component-push.sh --test-connection')).toEqual([]);
    expect(runsIn('bash scripts/boomi-deploy.sh --list-environments')).toEqual([]);
    expect(runsIn('source scripts/boomi-common.sh')).toEqual([]);
    expect(runsIn('git status')).toEqual([]);
});
test('componentPath names a component file the same way from a script and from an edit', () => {
    expect(componentPath(`/Users/me/work/${FILE}`)).toBe(FILE);
    expect(componentPath(FILE)).toBe(FILE);
    expect(componentPath('/Users/me/work/active-development/inventories/search.xml')).toBeUndefined();
    expect(componentPath('/Users/me/work/notes.md')).toBeUndefined();
    expect(componentPath('/w/src/components/a.xml', 'src/components')).toBeUndefined();
    expect(componentPath('/w/components/a.xml', 'components')).toBe('components/a.xml');
});
test('readOutput reads a push with its new version, a create with its ID, an unchanged push', () => {
    expect(readOutput('push', "SUCCESS: Pushed component 'Orders Sync' — now version 7", false)).toMatchObject({
        outcome: 'ok',
        name: 'Orders Sync',
        version: '7',
    });
    expect(readOutput('create', `SUCCESS: Component 'Orders API' created with ID: ${ID}`, false)).toMatchObject({
        outcome: 'ok',
        componentId: ID,
    });
    expect(readOutput('push', "Component 'Orders' matches the last push — nothing sent to the platform.", false).outcome).toBe('ok');
});
test('readOutput reads errors, and scripts that only read succeed without a SUCCESS line', () => {
    expect(readOutput('deploy', 'ERROR: Deployment failed (HTTP 400): bad package', true)).toMatchObject({
        outcome: 'failed',
        detail: 'ERROR: Deployment failed (HTTP 400): bad package',
    });
    expect(readOutput('push', 'something went wrong', true).outcome).toBe('failed');
    expect(readOutput('other', 'Found 3 components', false).outcome).toBe('ok');
    expect(readOutput('other', 'ERROR: HTTP 401', true).outcome).toBe('failed');
});
test("readOutput reads a test's execution status, and an ERROR status fails it", () => {
    expect(readOutput('test', 'Execution completed: status=COMPLETE, executionId=execution-abc-123', false)).toMatchObject({
        outcome: 'ok',
        executionStatus: 'COMPLETE',
        executionId: 'execution-abc-123',
    });
    expect(readOutput('test', 'Execution completed: status=ERROR, executionId=execution-abc-124', false).outcome).toBe('failed');
});
test("a component's stages read as its journey: edited, saved, deployed, tested", () => {
    const [row] = components([
        act('edit', 'ok', 'Orders Sync', NOW - 50, { file: FILE, type: 'process' }),
        act('push', 'ok', 'Orders Sync', NOW - 40, { file: FILE, version: '4' }),
        act('deploy', 'ok', 'Orders Sync', NOW - 30, { file: FILE, componentId: ID }),
        act('test', 'failed', 'Orders Sync', NOW - 20, { componentId: ID, executionStatus: 'ERROR' }),
    ]);
    expect(row.name).toBe('Orders Sync');
    expect(stages(row).map(s => s.text)).toEqual(['saved v4', 'deployed', 'test ERROR']);
});
test('an edit after the last save, and a save after the last deploy, say so', () => {
    const [row] = components([
        act('push', 'ok', 'Orders Sync', NOW - 50, { file: FILE, version: '4' }),
        act('deploy', 'ok', 'Orders Sync', NOW - 40, { file: FILE }),
        act('push', 'ok', 'Orders Sync', NOW - 30, { file: FILE, version: '5' }),
        act('edit', 'ok', 'Orders Sync', NOW - 20, { file: FILE }),
    ]);
    expect(stages(row).map(s => s.text)).toEqual(['edited since last save', 'saved v5', 'redeploy needed']);
    const [fresh] = components([act('edit', 'ok', 'New Map', NOW, { file: 'active-development/maps/New.xml' })]);
    expect(stages(fresh).map(s => s.text)).toEqual(['edited, not in Boomi yet']);
});
test('needs attention lists current failures with a next step, and a later fix clears them', () => {
    const failing = dashboard([act('test', 'failed', 'Orders Sync', NOW, { componentId: ID, executionStatus: 'ERROR', executionId: 'execution-0490202b-2e2f' })]);
    const [item] = attention(failing, NOW, 24 * HOUR);
    expect(item.title).toBe('Test of Orders Sync ended ERROR');
    expect(item.hint).toContain('Execution 0490202b…: press Why?');
    expect(item.executionId).toBe('execution-0490202b-2e2f');
    const fixed = dashboard([...failing.activity, act('test', 'ok', 'Orders Sync', NOW + 1, { componentId: ID, executionStatus: 'COMPLETE' })]);
    expect(attention(fixed, NOW, 24 * HOUR)).toEqual([]);
});
test("only recent runs of this session's components need attention", () => {
    const runs = [
        { executionId: 'e1', processName: 'Orders Sync', status: 'ERROR', at: '2026-09-07T09:45:11Z' },
        { executionId: 'e2', processName: 'Orders Sync', status: 'ERROR', at: '2026-10-12T10:00:00Z' },
        { executionId: 'e3', processName: 'JMX Capability Scan', status: 'ERROR', at: '2026-10-12T10:30:00Z' },
    ];
    const state = dashboard([act('deploy', 'ok', 'Orders Sync', NOW - HOUR, { file: FILE })], { platform: { phase: 'ok', message: '', runs } });
    expect(recentRuns(runs, NOW, 24 * HOUR).map(r => r.executionId)).toEqual(['e2', 'e3']);
    // An old run, and a run of a process this session never touched, aren't news.
    expect(attention(state, NOW, 24 * HOUR).map(a => a.title)).toEqual(['Run of Orders Sync ended ERROR']);
    expect(attention({ ...state, activity: [] }, NOW, 24 * HOUR)).toEqual([]);
});
test('the status line leads with the latest step, then what needs attention, then the cost', () => {
    const state = dashboard([
        act('test', 'failed', 'Orders Sync', NOW - 10, { componentId: ID, executionStatus: 'ERROR' }),
        act('push', 'ok', 'Weather API', NOW, { file: 'active-development/c/W.xml', version: '2' }),
    ]);
    expect(statusLine(state, NOW, 24 * HOUR, { usd: 1.837, tokens: 1_240_000 })).toBe('✓ Saved Weather API to Boomi (v2) · ✗ 1 needs attention · 1.24M tokens · $1.84 this session');
    expect(statusLine(dashboard(), NOW, 24 * HOUR)).toBe('waiting for Companion');
});
test("in a new session, the status line doesn't replay the last session's step", () => {
    const restored = dashboard([act('test', 'ok', 'a component', NOW - 14 * HOUR, { componentId: ID, executionStatus: 'COMPLETE', isRestored: true })]);
    const recap = { endedAt: NOW - 14 * HOUR, components: 4, saves: 6, deploys: 2, tests: 3, testsFailed: 0, open: 0 };
    expect(statusLine(restored, NOW, 24 * HOUR, { usd: 0 }, recap)).toBe('New session · last one 14h ago, nothing left to fix · $0.00 this session');
    expect(statusLine(restored, NOW, 24 * HOUR, { usd: 0 })).toBe('waiting for Companion · $0.00 this session');
    // A failure left over is still news, and counted once.
    const failed = dashboard([act('test', 'failed', 'Orders Sync', NOW - HOUR, { componentId: ID, executionStatus: 'ERROR', isRestored: true })]);
    expect(statusLine(failed, NOW, 24 * HOUR, { usd: 0 }, { ...recap, open: 1 })).toBe('New session · last one 14h ago · ✗ 1 needs attention · $0.00 this session');
    // Once Companion does something, the step leads again.
    const working = dashboard([...restored.activity, act('push', 'ok', 'Weather API', NOW, { file: 'active-development/c/W.xml', version: '2' })]);
    expect(statusLine(working, NOW, 24 * HOUR, { usd: 0.5 }, recap)).toBe('✓ Saved Weather API to Boomi (v2) · $0.50 this session');
});
test('describe words each step for a person, not a script', () => {
    expect(describe(act('other', 'ok', 'Companion', NOW, { script: 'component-search' }))).toBe('Searched components');
    expect(describe(act('deploy', 'failed', 'Orders Sync', NOW))).toBe('Deploy of Orders Sync failed');
    expect(describe(act('push', 'blocked', 'Orders Sync', NOW))).toBe('Blocked: push of Orders Sync');
    expect(describe(act('push', 'running', 'Orders Sync', NOW))).toBe('Saving Orders Sync…');
});
test('the summary has each section, in plain words', () => {
    const text = summary(dashboard([act('edit', 'ok', 'New Map', NOW - 120_000, { file: 'active-development/maps/New.xml', type: 'transform.map' })]), { usd: 0.5, contextPercent: 41.6 }, NOW, 24 * HOUR);
    expect(text).toContain('✓ Nothing needs attention.');
    expect(text).toContain('New Map (map): ◐ edited, not in Boomi yet');
    expect(text).toContain('Edited New Map, 2m ago');
    expect(text).not.toContain('Process runs');
    expect(text).toContain('Session: $0.50 so far · context 42% full');
});
test('a watched component changed by someone else is flagged, a change of our own is not', () => {
    const before = { componentId: ID, name: 'Orders Sync', version: '3' };
    const theirs = compareWatched(before, { version: '4', modifiedBy: 'pat@example.com' }, 'me@example.com');
    expect(theirs.isNewChange).toBe(true);
    expect(theirs.next.changedBy).toBe('pat@example.com');
    expect(compareWatched(before, { version: '4', modifiedBy: 'ME@example.com' }, 'me@example.com').isNewChange).toBe(false);
    expect(compareWatched({ componentId: ID }, { version: '3' }, 'me@example.com').isNewChange).toBe(false);
});
test('newFailures returns only failed runs not seen before', () => {
    const old = [{ executionId: 'e1', processName: 'A', status: 'ERROR', at: 't1' }];
    const fresh = [
        { executionId: 'e2', processName: 'B', status: 'ERROR', at: 't2' },
        { executionId: 'e3', processName: 'C', status: 'COMPLETE', at: 't3' },
        ...old,
    ];
    expect(newFailures(old, fresh).map(run => run.executionId)).toEqual(['e2']);
});
test('componentOf reads the root element; friendlyType names types in plain words', () => {
    const xml = `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${ID}" name="Orders Sync" type="process"><bns:object><x componentId="other"/></bns:object></bns:Component>`;
    expect(componentOf(xml)).toEqual({ componentId: ID, name: 'Orders Sync', type: 'process' });
    expect(componentOf('<bns:Component componentId="" name="New">').componentId).toBeUndefined();
    expect(friendlyType('connector-settings')).toBe('connection');
    expect(friendlyType('profile.json')).toBe('JSON profile');
});
test('formatTokens reads at a glance', () => {
    expect([950, 4_210, 312_400, 1_240_000].map(formatTokens)).toEqual(['950', '4.2k', '312k', '1.24M']);
});
test("each step's spend is the difference from the step before; a component's is its steps summed", () => {
    const list = [
        act('edit', 'ok', 'Orders Sync', NOW - 30, { file: FILE, tokensAt: 10_000, usdAt: 0.1 }),
        act('push', 'ok', 'Orders Sync', NOW - 20, { file: FILE, tokensAt: 25_000, usdAt: 0.3 }),
        act('other', 'ok', 'Companion', NOW - 10, { script: 'component-search', tokensAt: 26_000, usdAt: 0.31 }),
    ];
    const all = spends(list);
    expect(all.get(list[0].id)).toEqual({ tokens: 10_000, usd: 0.1 });
    expect(all.get(list[1].id)?.tokens).toBe(15_000);
    expect(Math.round((all.get(list[1].id)?.usd ?? 0) * 100)).toBe(20);
    const [row] = components(list);
    expect(spendOf(row.ids, all).tokens).toBe(25_000);
});
test('sparkline and meter draw at a glance', () => {
    expect(sparkline([1, 4, 8])).toBe('▂▅█');
    expect(sparkline([0, 0])).toBe('');
    expect(meter(31, 10)).toBe('▰▰▰▱▱▱▱▱▱▱');
});
test('modelName reads model ids in words, and modelMix lists each model biggest first', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('claude-haiku-5-5-20260901')).toBe('Haiku 5.5');
    expect(modelName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelName('some-gateway-model')).toBe('some-gateway-model');
    const mix = modelMix({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 2, models: { 'claude-haiku-5-5': 26_000, 'claude-opus-5-5': 312_000 } });
    expect(mix).toBe('Opus 5.5 312k · Haiku 5.5 26k');
});
test('the 8-bit flamingo stands in one place, with a little life: glances, blinks, now and then a shift or a turn', () => {
    const ticks = Array.from({ length: 7200 }, (_, i) => i); // an hour
    const scenes = ticks.map(sceneAt);
    const changes = scenes.filter((s, i) => i > 0 && JSON.stringify(s) !== JSON.stringify(scenes[i - 1]));
    // Something every 10 to 15 seconds: about 4 to 10 changes a minute (each glance or blink is two), never busy.
    expect(changes.length).toBeGreaterThan(240);
    expect(changes.length).toBeLessThan(600);
    for (let minute = 0; minute < 60; minute++) {
        const window = scenes.slice(minute * 120, minute * 120 + 120);
        expect(new Set(window.map(s => JSON.stringify(s))).size).toBeGreaterThan(1);
    }
    // It glances back, blinks, shifts and turns, and a neighbour visits, over the hour.
    expect(scenes.some(s => s.isLookingBack)).toBe(true);
    expect(scenes.some(s => s.isBlinking)).toBe(true);
    expect(new Set(scenes.map(s => s.leg)).size).toBe(2);
    expect(new Set(scenes.map(s => s.facing)).size).toBe(2);
    expect(scenes.some(s => s.visitor > 0)).toBe(true);
    // Never both at once, and the same tick always draws the same.
    expect(scenes.some(s => s.isBlinking && s.isLookingBack)).toBe(false);
    expect(sceneAt(4321)).toEqual(sceneAt(4321));
});
test("the flamingo's poses: the same 12-by-16 sprite, so nothing jumps", () => {
    const base = { facing: 'right', leg: 'one', isLookingBack: false, isBlinking: false, visitor: 0 };
    expect(flamingo(base)).toEqual([...FLAMINGO_IDLE]);
    for (const scene of [base, { ...base, isLookingBack: true }, { ...base, leg: 'other' }, { ...base, facing: 'left' }, { ...base, isBlinking: true }]) {
        const pixels = flamingo(scene);
        expect(pixels).toHaveLength(16);
        expect(pixels.every(row => row.length === 12)).toBe(true);
    }
    // Looking back turns the beak the other way; the body stays.
    const back = flamingo({ ...base, isLookingBack: true });
    expect(back[2]).toBe('...LLPPPP...');
    expect(back.slice(8)).toEqual(FLAMINGO_IDLE.slice(8));
    // The other leg: standing and tucked legs trade places.
    expect(flamingo({ ...base, leg: 'other' }).slice(12)).toEqual(['....PPP.P...', '.....P..P...', '........P...', '........PP..']);
    // Facing left is the whole bird reflected.
    expect(flamingo({ ...base, facing: 'left' })[2]).toBe('...LLPPPP...');
    // A blink closes the eye; the beak's tip stays dark.
    const blink = flamingo({ ...base, isBlinking: true });
    expect(blink[1]).toBe('...PPPPP....');
    expect(blink[3]).toContain('K');
    expect(pixelCells(FLAMINGO_IDLE, { P: 'p', L: 'l', K: 'k' }).length).toBe(8);
});
test('a neighbour peeks in from the side the flamingo faces, looks, and goes', () => {
    // The visit, column by column, wherever in the hour it falls.
    const visits = Array.from({ length: 7200 }, (_, i) => sceneAt(i).visitor);
    const first = visits.findIndex(v => v > 0);
    expect(visits.slice(first, first + 10)).toEqual([2, 4, 6, 6, 6, 6, 6, 4, 2, 0]);
    // Facing right, it comes in at the right edge, its beak toward the flamingo.
    const rows = sceneRows({ facing: 'right', leg: 'one', isLookingBack: false, isBlinking: false, visitor: 6 });
    expect(rows).toHaveLength(16);
    expect(rows.every(r => r.length === 18)).toBe(true);
    expect(rows[2].slice(12)).toBe('LLPPPP');
    // Not there between visits: only the flamingo, in the middle of its strip.
    expect(sceneRows({ facing: 'right', leg: 'one', isLookingBack: false, isBlinking: false, visitor: 0 })[0]).toBe('.......PPP........');
    // Facing left, it comes in at the left edge.
    expect(sceneRows({ facing: 'left', leg: 'one', isLookingBack: false, isBlinking: false, visitor: 6 })[2].slice(0, 6)).toBe('PPPPLL');
});
test('the flamingo stands in a thin line of still water across its strip', () => {
    expect(pondRows()).toEqual(['..................', 'WWW.WWW.WWW.WWW.WW']);
    expect(pixelCells(pondRows(), { W: '#9FDED6' })[0].map(c => c.char).join('')).toBe('▄▄▄ ▄▄▄ ▄▄▄ ▄▄▄ ▄▄');
});
test('pixelCells packs two pixel rows into each cell with half blocks', () => {
    const colors = { P: '#C2185B', L: '#F7A8C4' };
    expect(pixelCells(['P.P.', 'PL..'], colors)).toEqual([
        [{ char: '█', color: '#C2185B', bg: undefined }, { char: '▄', color: '#F7A8C4' }, { char: '▀', color: '#C2185B' }, { char: ' ' }],
    ]);
    expect(pixelCells(['PL', 'LP'], colors)[0][0]).toEqual({ char: '▀', color: '#C2185B', bg: '#F7A8C4' });
    expect(pixelCells(FLAMINGO_IDLE, { P: 'p', L: 'l', K: 'k' }).length).toBe(8);
});
test("a script that's only read or searched isn't a run", () => {
    expect(runsIn('cat scripts/boomi-deploy.sh')).toEqual([]);
    expect(runsIn('grep -n SUCCESS scripts/boomi-deploy.sh | head')).toEqual([]);
    expect(runsIn('sed -n 1,40p skills/boomi-integration/scripts/boomi-deploy.sh')).toEqual([]);
    expect(runsIn(`BOOMI_X=1 timeout 60 bash -x scripts/boomi-deploy.sh ${FILE}`)).toEqual([{ kind: 'deploy', file: FILE }]);
    expect(runsIn(`./scripts/boomi-deploy.sh ${FILE}; echo done`)).toEqual([{ kind: 'deploy', file: FILE }]);
});
test('a file named after a cd is read from that folder', () => {
    const [run] = runsIn('cd active-development && bash ../scripts/boomi-deploy.sh processes/Listener.xml');
    expect(run.file).toBe('active-development/processes/Listener.xml');
    expect(componentPath(run.file)).toBe('active-development/processes/Listener.xml');
    expect(runsIn('cd /w/active-development/processes && bash /w/scripts/boomi-deploy.sh ./Listener.xml')[0].file).toBe('/w/active-development/processes/Listener.xml');
});
test("a script's SUCCESS line passes it even when the command's exit code is an error", () => {
    const output = "SUCCESS: Deployed 'WX Listener' (package: p1)\nbash: tpyo: command not found";
    expect(readOutput('deploy', output, true)).toMatchObject({ outcome: 'ok', name: 'WX Listener' });
    expect(readOutput('deploy', 'bash: tpyo: command not found', true).outcome).toBe('failed');
    expect(readOutput('deploy', 'Deploying...', false)).toMatchObject({ outcome: 'ok', detail: 'finished' });
});
test('one component named two ways is one row, and its failure needs attention once', () => {
    const list = [
        act('create', 'ok', 'WX Listener', NOW - 30, { file: 'active-development/processes/Listener.xml', componentId: ID }),
        act('deploy', 'failed', 'Listener.xml', NOW - 20, { file: 'x/processes/Listener.xml', componentId: ID }),
        act('deploy', 'failed', 'WX Listener', NOW - 10, { componentId: ID, detail: 'ERROR: x' }),
    ];
    const rows = components(list);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('WX Listener');
    expect(attention(dashboard(list), NOW, 24 * HOUR).length).toBe(1);
});
test("a step that names no component stays out of the components list", () => {
    expect(components([act('deploy', 'ok', 'a component', NOW)])).toEqual([]);
});
test('new tokens leave out cache reads, which are counted apart', () => {
    const l = { input: 1_000, output: 2_000, cacheRead: 300_000, cacheWrite: 5_000, calls: 3 };
    expect(newTokens(l)).toBe(8_000);
    expect(cachedTokens(l)).toBe(300_000);
    expect(totalTokens(l)).toBe(308_000);
});
test('the token split names each kind, and each model gets its own line when there are several', () => {
    const opus = { input: 18_000, output: 44_000, cacheRead: 3_300_000, cacheWrite: 350_000 };
    expect(tokenSplit(opus)).toBe('412k new (18k in · 44k out · 350k cache writes) · 3.30M cache reads');
    const ledger = { ...opus, calls: 60, byModel: { 'claude-opus-5-5': opus } };
    expect(modelSplits(ledger)).toEqual([]);
    const haiku = { input: 2_000, output: 1_000, cacheRead: 40_000, cacheWrite: 9_000 };
    expect(modelSplits({ ...ledger, byModel: { 'claude-haiku-5-5': haiku, 'claude-opus-5-5': opus } })).toEqual([
        'Opus 5.5: 412k new (18k in · 44k out · 350k cache writes) · 3.30M cache reads',
        'Haiku 5.5: 12k new (2.0k in · 1.0k out · 9.0k cache writes) · 40k cache reads',
    ]);
});
// --- Regression: a live OrderValidator build that left "Components this session" empty ---
const SKILL = '/Users/me/.claude/plugins/cache/boomi-companion/bc-integration/1.0.76/skills/boomi-integration';
test('a multi-line command runs each script, each with its own file', () => {
    const command = [
        `bash ${SKILL}/scripts/boomi-component-create.sh active-development/profiles/OrderRequest.xml`,
        `bash ${SKILL}/scripts/boomi-component-create.sh active-development/processes/Listener.xml`,
    ].join('\n');
    expect(runsIn(command)).toEqual([
        { kind: 'create', file: 'active-development/profiles/OrderRequest.xml' },
        { kind: 'create', file: 'active-development/processes/Listener.xml' },
    ]);
});
test('a script run in a loop is a run', () => {
    const command = `for f in active-development/profiles/*.xml; do bash ${SKILL}/scripts/boomi-component-create.sh "$f"; done`;
    expect(runsIn(command).map(run => run.kind)).toEqual(['create']);
    expect(runsIn(`if true; then bash ${SKILL}/scripts/boomi-deploy.sh ${FILE}; fi`)).toEqual([{ kind: 'deploy', file: FILE }]);
});
test('each result in the output is read on its own, so a loop of creates is several components', () => {
    const output = [
        "Creating component 'OrderValidator - Order Request Profile' on the account default branch",
        `SUCCESS: Component 'OrderValidator - Order Request Profile' created with ID: 11111111-1111-1111-1111-111111111111`,
        "Creating component 'OrderValidator - Order Response Profile' on the account default branch",
        'ERROR: Create failed (HTTP 400): bad profile',
        "Creating component 'OrderValidator - Listener Validate Order' on the account default branch",
        `SUCCESS: Component 'OrderValidator - Listener Validate Order' created with ID: 33333333-1111-1111-1111-111111111111`,
    ].join('\n');
    expect(readResults('create', output, true).map(r => [r.name, r.outcome, r.componentId])).toEqual([
        ['OrderValidator - Order Request Profile', 'ok', '11111111-1111-1111-1111-111111111111'],
        ['OrderValidator - Order Response Profile', 'failed', undefined],
        ['OrderValidator - Listener Validate Order', 'ok', '33333333-1111-1111-1111-111111111111'],
    ]);
});
test('a loop that ran one script six times is six steps; each run keeps its own result', () => {
    const results = parseResults(Array.from({ length: 3 }, (_, i) => `Creating component 'P${i}' on the account default branch\nSUCCESS: Component 'P${i}' created with ID: ${i}1111111-1111-1111-1111-111111111111`).join('\n'));
    const { first, extras } = assignResults([{ id: 7, kind: 'create' }], results);
    expect(first.get(7)?.name).toBe('P0');
    expect(extras.get(7)?.map(r => r.name)).toEqual(['P1', 'P2']);
});
test('a push and a deploy in one command each take their own result, named from the lines before', () => {
    const output = [
        `Pushing component 'OrderValidator - Listener Validate Order' (${ID}) to the account default branch`,
        "SUCCESS: Pushed component 'OrderValidator - Listener Validate Order' — now version 3",
        `Packaging 'OrderValidator - Listener Validate Order' (${ID}) from the account default branch`,
        'ERROR: Deployment failed (HTTP 400): no runtime',
    ].join('\n');
    const { first } = assignResults([{ id: 1, kind: 'push' }, { id: 2, kind: 'deploy' }], parseResults(output));
    expect(first.get(1)).toMatchObject({ outcome: 'ok', version: '3', componentId: ID });
    expect(first.get(2)).toMatchObject({ outcome: 'failed', name: 'OrderValidator - Listener Validate Order', componentId: ID });
});
const LISTENER = 'OrderValidator - Listener Validate Order';
const listenerRuns = [
    ...['a', 'b', 'c', 'd'].map(x => ({ executionId: `execution-${x}`, processName: LISTENER, processId: ID, status: 'COMPLETE', at: '2026-10-12T11:00:00Z', executionType: 'exec_listener' })),
    { executionId: 'execution-81f61084-fd93-4565-9bda-9bf0d4b4f102', processName: LISTENER, processId: ID, status: 'ERROR', at: '2026-10-12T11:05:00Z', executionType: 'exec_listener' },
];
test("a component's runs in Boomi show on its row, matched by its ID", () => {
    const [row] = components([act('deploy', 'ok', LISTENER, NOW - 60_000, { componentId: ID, file: 'active-development/processes/Listener.xml' })]);
    expect(runsOf(row, listenerRuns).length).toBe(5);
    expect(stages(row, listenerRuns).map(s => s.text)).toEqual(['deployed', '1 of 5 listener runs failed']);
    expect(runsOf({ name: 'Something else' }, listenerRuns)).toEqual([]);
});
test('a failed run of a session component needs attention with that context, until marked seen', () => {
    const state = dashboard([act('deploy', 'ok', LISTENER, NOW - 60_000, { componentId: ID })], {
        platform: { phase: 'ok', message: '', runs: listenerRuns },
    });
    const [item] = attention(state, NOW, 24 * HOUR);
    expect(item.title).toBe(`Listener run of ${LISTENER} ended ERROR`);
    expect(item.hint).toContain('Execution 81f61084…. Press Why?');
    expect(item.executionId).toBe('execution-81f61084-fd93-4565-9bda-9bf0d4b4f102');
    expect(attention({ ...state, seenRuns: ['execution-81f61084-fd93-4565-9bda-9bf0d4b4f102'] }, NOW, 24 * HOUR)).toEqual([]);
});
test('a collapsed runs section reads as one line', () => {
    expect(runsSummary(listenerRuns, 24)).toEqual({ level: 'critical', text: '5 in 24h, 1 failed' });
    expect(runsSummary(listenerRuns.slice(0, 4), 24)).toEqual({ level: 'healthy', text: '4 in 24h, none failed' });
});
test("the footer's link is the origin's GitHub page, in any remote form, and nothing for other hosts", () => {
    expect(githubUrl('git@github.com:brianbrinley/ClaudeMods.git')).toBe('https://github.com/brianbrinley/ClaudeMods');
    expect(githubUrl('https://github.com/brianbrinley/ClaudeMods')).toBe('https://github.com/brianbrinley/ClaudeMods');
    expect(githubUrl('https://x-access-token:abc@github.com/o/r.git')).toBe('https://github.com/o/r');
    expect(githubUrl('ssh://git@github.com/o/r.git')).toBe('https://github.com/o/r');
    expect(githubUrl('https://gitlab.com/o/r.git')).toBeUndefined();
    expect(githubUrl(null)).toBeUndefined();
});
test("steps from an earlier session don't skew the first new step's spend", () => {
    const list = [
        act('push', 'ok', 'A', NOW - 50, { file: FILE, tokensAt: 400_000, isRestored: true }),
        act('push', 'ok', 'A', NOW - 10, { file: FILE, tokensAt: 5_000 }),
    ];
    expect(spends(list).get(list[1].id)?.tokens).toBe(5_000);
});
test('closing an item takes it out of Needs attention; a new failure of the same component comes back', () => {
    const failed = act('deploy', 'failed', 'Orders Sync', NOW - 30, { componentId: ID, detail: 'ERROR: no runtime' });
    let state = dashboard([failed]);
    const [item] = attention(state, NOW, 24 * HOUR);
    expect(item.key).toBe(`step:${failed.id}`);
    state = closeItem(state, item.key);
    expect(attention(state, NOW, 24 * HOUR)).toEqual([]);
    expect(closedCount(state, NOW, 24 * HOUR)).toBe(1);
    const again = { ...state, activity: [...state.activity, act('deploy', 'failed', 'Orders Sync', NOW, { componentId: ID, detail: 'ERROR: no runtime' })] };
    expect(attention(again, NOW, 24 * HOUR).length).toBe(1);
    expect(attention(reopenAll(state), NOW, 24 * HOUR).length).toBe(1);
});
test('closing a run marks it seen, and closing a watched change clears it', () => {
    const run = { executionId: 'execution-e9', processName: 'P', status: 'ERROR', at: '2026-10-12T11:00:00Z' };
    const state = dashboard([act('deploy', 'ok', 'P', NOW - HOUR, { file: FILE })], {
        platform: { phase: 'ok', message: '', runs: [run] },
        watched: [{ componentId: ID, name: 'W', version: '4', changedBy: 'pat@example.com' }],
    });
    const keys = attention(state, NOW, 24 * HOUR).map(item => item.key).sort();
    expect(keys).toEqual(['run:execution-e9', `watch:${ID}`]);
    const closed = keys.reduce(closeItem, state);
    expect(attention(closed, NOW, 24 * HOUR)).toEqual([]);
    expect(closed.seenRuns).toEqual(['execution-e9']);
    expect(closed.watched[0].changedBy).toBeUndefined();
});
test("a script named by its path tells where Companion's scripts are", () => {
    expect(scriptRuns(`bash ${SKILL}/scripts/boomi-deploy.sh ${FILE}`)[0].scriptsDir).toBe(`${SKILL}/scripts`);
    expect(scriptRuns(`cd /w && bash scripts/boomi-deploy.sh ${FILE}`)[0].scriptsDir).toBe('/w/scripts');
    expect(scriptRuns(`boomi-deploy.sh ${FILE}`)[0].scriptsDir).toBeUndefined();
});
const LOG = [
    'Executing test for process 33333333 on atom a1',
    '2026-10-12T11:05:00Z\tINFO\tStart\tExecuting Process OrderValidator - Listener Validate Order',
    '2026-10-12T11:05:01Z\tWARNING\tMap\tNo data produced from map',
    '2026-10-12T11:05:01Z\tSEVERE\tParse Order\tUnexpected character (\'}\' (code 125)) at line 1, column 18',
    '2026-10-12T11:05:01Z\tSEVERE\tException\tOrder JSON is not valid',
].join('\n');
test('diagnose picks the SEVERE lines out of a process log, without their timestamps', () => {
    expect(diagnose(LOG)).toEqual({
        lines: ["SEVERE · Parse Order · Unexpected character ('}' (code 125)) at line 1, column 18", 'SEVERE · Exception · Order JSON is not valid'],
        severe: 2,
        warnings: 1,
    });
    expect(diagnose('a\nb\nc').lines).toEqual(['a', 'b', 'c']);
});
test('the fix request names the execution and quotes what the log said', () => {
    const text = fixPrompt('Listener run of X ended ERROR', 'execution-81f6', { lines: ['SEVERE\tParse Order\tbad'], severe: 1, warnings: 0 });
    expect(text).toContain('Listener run of X ended ERROR (execution execution-81f6). Its process log says:');
    expect(text).toContain('  SEVERE\tParse Order\tbad');
    expect(text).toContain('push, redeploy and test it again');
});
test('the session report has each section, and a pipe in a name keeps the table intact', () => {
    const state = dashboard([
        act('push', 'ok', 'A | B', NOW - 60_000, { file: FILE, version: '2' }),
        act('deploy', 'ok', 'A | B', NOW - 50_000, { file: FILE }),
        act('test', 'failed', 'A | B', NOW - 40_000, { file: FILE, executionStatus: 'ERROR', executionId: 'execution-1' }),
    ]);
    const text = report(state, { session: '3adaec6a', date: '2026-10-12', repo: 'https://github.com/o/r', usage: { usd: 0.42, split: '12k new (…) · 80k cache reads', model: 'Opus 5.5', startedAt: NOW - 3_600_000 } }, NOW, 24 * HOUR);
    expect(text).toContain('# Boomi Companion session report');
    expect(text).toContain('Session 3adaec6a · 2026-10-12 · 1h 0m · Opus 5.5');
    expect(text).toContain('Repository: https://github.com/o/r');
    expect(text).toContain('| A \\| B |  | ✓ saved v2 · ✓ deployed · ✗ test ERROR |');
    expect(text).toContain('- ✗ Test of A | B ended ERROR (execution execution-1)');
    expect(text).toContain('## Needs attention');
    expect(text).toContain('- Cost: $0.42');
    expect(text).toContain('- Tokens: 12k new (…) · 80k cache reads');
});
test('a test keeps its arguments so it can be run again', () => {
    expect(scriptRuns(`bash scripts/boomi-test-execute.sh --process-id ${ID} --atom-id a1`)[0].args).toEqual(['--process-id', ID, '--atom-id', 'a1']);
    expect(scriptRuns(`bash scripts/boomi-component-push.sh ${FILE}`)[0].args).toBeUndefined();
});
test('the budget warns from 80% and says when it is spent, and stays quiet without one', () => {
    expect(budgetOf(1, 5)).toEqual({ level: 'healthy', percent: 20, text: '20% of the $5.00 budget' });
    expect(budgetOf(4.2, 5)?.level).toBe('warning');
    expect(budgetOf(5.5, 5)).toMatchObject({ level: 'critical', text: 'budget spent: $5.50 of the $5.00 budget' });
    expect(budgetOf(4, 0)).toBeUndefined();
    expect(budgetOf(undefined, 5)).toBeUndefined();
    expect(statusLine(dashboard(), NOW, 24 * HOUR, { usd: 4.2, budgetUsd: 5 })).toContain('◐ 84% of the $5.00 budget');
    expect(statusLine(dashboard(), NOW, 24 * HOUR, { usd: 1, budgetUsd: 5 })).not.toContain('budget');
});
test('the next step is to deploy what was saved, then to test what was deployed', () => {
    const saved = act('push', 'ok', 'Orders Sync', NOW - 60_000, { file: FILE, type: 'process' });
    expect(nextStep([saved])).toBe('Deploy Orders Sync and test it');
    const deployed = act('deploy', 'ok', 'Orders Sync', NOW - 50_000, { file: FILE, type: 'process' });
    expect(nextStep([saved, deployed])).toBe('Test Orders Sync');
    expect(nextStep([saved, deployed, act('test', 'ok', 'Orders Sync', NOW - 40_000, { file: FILE, type: 'process' })])).toBeUndefined();
    expect(nextStep([saved, deployed, act('test', 'failed', 'Orders Sync', NOW - 40_000, { file: FILE, type: 'process' })])).toBeUndefined();
    expect(nextStep([saved, act('deploy', 'running', 'Orders Sync', NOW - 50_000, { file: FILE, type: 'process' })])).toBeUndefined();
    expect(nextStep([act('push', 'ok', 'Order Profile', NOW, { file: 'active-development/profiles/P.xml', type: 'profile.json' })])).toBeUndefined();
    expect(nextStep([{ ...saved, isRestored: true }])).toBeUndefined();
});
const SCAN = {
    sessions: [
        {
            id: 'aaaaaaaa-1111',
            project: '/Users/me/orders',
            startedAt: '2026-10-10T09:00:00Z',
            endedAt: '2026-10-10T09:47:00Z',
            firstPrompt: 'Build the orders sync process',
            costUsd: 3.5,
            models: { 'claude-opus-5-5': { input: 100, output: 900, cacheRead: 50_000, cacheWrite: 1000 } },
            commands: [
                'bash scripts/boomi-component-push.sh active-development/processes/Orders.xml && bash scripts/boomi-deploy.sh active-development/processes/Orders.xml',
                `bash scripts/boomi-test-execute.sh --process-id ${ID}`,
                `bash scripts/boomi-test-execute.sh --process-id ${ID}`,
            ],
        },
        {
            id: 'bbbbbbbb-2222',
            project: '/Users/me/old',
            startedAt: '2026-09-01T09:00:00Z',
            costUsd: null,
            models: { 'claude-sonnet-5-5': { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 } },
            commands: ['bash scripts/boomi-component-create.sh active-development/profiles/P.xml'],
        },
        // Only looked at a script: not a Companion session.
        { id: 'cccccccc-3333', startedAt: '2026-10-11T09:00:00Z', costUsd: 9, models: {}, commands: ['cat scripts/boomi-deploy.sh', 'find / -name boomi-deploy.sh'] },
    ],
};
test('past sessions are the ones that ran a Companion script, with their work, components and cost', () => {
    const past = pastSessions(SCAN);
    expect(past.map(s => s.id)).toEqual(['aaaaaaaa-1111', 'bbbbbbbb-2222']);
    expect(past[0]).toMatchObject({ costUsd: 3.5, tokens: 2000, cached: 50_000, runs: { push: 1, deploy: 1, test: 2 }, components: ['Orders'] });
    expect(past[0].models).toEqual(['Opus 5.5']);
    expect(past[1].costUsd).toBeUndefined();
    expect(runWords(past[0].runs)).toBe('1 push · 1 deploy · 2 tests');
});
test('history adds up the week, the month and everything, and says what has no recorded cost', () => {
    const past = pastSessions(SCAN);
    expect(historyTotals(past, NOW, 7 * 86_400_000)).toEqual({ sessions: 1, usd: 3.5, unpriced: 0, tokens: 2000 });
    expect(historyTotals(past, NOW)).toMatchObject({ sessions: 2, usd: 3.5, unpriced: 1 });
    const text = historySummary(past, NOW, 90, { currentId: 'aaaaaaaa-1111', timeZone: 'UTC' });
    expect(text).toContain('This week: 1 session · $3.50 · 2.0k tokens');
    expect(text).toContain('All 90 days: 2 sessions · $3.50 (+1 without a recorded cost)');
    // Each session: when, how long, the cost and what it was about; then what it did. The folders differ, so they show.
    expect(text).toContain('Oct 10, 09:00 (this session) · 47m · $3.50 · "Build the orders sync process"\n      1 push · 1 deploy · 2 tests · Orders · 2.0k tokens · orders');
    expect(text).toContain('Sep 1, 09:00 · no recorded cost\n      1 create · P · 20 tokens · old');
    expect(historySummary([], NOW, 90)).toContain('No Boomi Companion sessions');
});
test("a failed test's execution is one item, not a second one for its run in Boomi, even once it's closed", () => {
    const tested = act('test', 'failed', 'Orders Sync', NOW - 30, { componentId: ID, executionStatus: 'ERROR', executionId: 'execution-77' });
    const runs = [{ executionId: 'execution-77', processName: 'Orders Sync', processId: ID, status: 'ERROR', at: '2026-10-12T11:59:00Z' }];
    const state = dashboard([tested], { platform: { phase: 'ok', message: '', runs } });
    expect(attention(state, NOW, 24 * HOUR).map(item => item.key)).toEqual([`step:${tested.id}`]);
    expect(attention(closeItem(state, `step:${tested.id}`), NOW, 24 * HOUR)).toEqual([]);
});
test('guardrails: what the standards and runtime mods say, each with an icon and a label', () => {
    expect(guardrails(undefined, undefined)).toEqual([]);
    const blocked = { checks: 3, blocked: 1, last: { script: 'push', files: 1, errors: 2, warnings: 0, isBlocked: true, findings: ['Orders.xml: a password is typed into a password field', 'Orders.xml: x'] } };
    expect(guardrails(blocked, undefined)).toEqual([
        { level: 'serious', text: 'Standards blocked the last push: Orders.xml: a password is typed into a password field (+1 more)' },
    ]);
    const passed = { checks: 4, blocked: 1, last: { script: 'deploy', files: 1, errors: 0, warnings: 0, isBlocked: false, findings: [] } };
    expect(guardrails(passed, undefined)[0]).toEqual({ level: 'healthy', text: 'Standards: the last deploy passed (4 checks, 1 blocked)' });
    expect(guardrails({ ...passed, last: { ...passed.last, warnings: 1, findings: ['A.xml: name'] } }, undefined)[0].level).toBe('warning');
    expect(guardrails({ ...passed, last: { ...passed.last, errors: 1, findings: ['A.xml: bad'] } }, undefined)[0].text).toContain('not enforced');
    expect(guardrails({ checks: 0, blocked: 0 }, undefined)[0].level).toBeUndefined();
    expect(guardrails(undefined, { phase: 'online', message: '', name: 'cc-1', smoke: { phase: 'passed', message: '' } })).toEqual([
        { level: 'healthy', text: 'Runtime cc-1 online, smoke test passed' },
    ]);
    expect(guardrails(undefined, { phase: 'online', message: '', name: 'cc-1', smoke: { phase: 'failed', message: 'ERROR' } })[1]).toEqual({ level: 'critical', text: 'Smoke test failed: ERROR' });
    expect(guardrails(undefined, { phase: 'installing', message: 'Downloading', name: 'cc-1' })[0]).toEqual({ level: 'warning', text: 'Runtime cc-1 installing: Downloading' });
    expect(guardrails(undefined, { phase: 'error', message: 'did not come online' })[0].level).toBe('critical');
    expect(guardrails(undefined, { phase: 'idle', message: '' })[0].level).toBeUndefined();
    expect(guardrailText(guardrails(passed, { phase: 'idle', message: '' }))).toBe('Guardrails:\n  ✓ Standards: the last deploy passed (4 checks, 1 blocked)\n  Runtime: none in this session. /boomi up starts one.');
    expect(guardrailText([])).toBe('');
});
test("event-streams-setup.sh is Companion's too, though it isn't named boomi-*", () => {
    expect(scriptRuns('bash scripts/event-streams-setup.sh create-topic orders')).toMatchObject([{ kind: 'other', script: 'event-streams-setup' }]);
});
test('a session is named by its own title first, then its first request; one folder for all of them goes unsaid', () => {
    const both = pastSessions({ sessions: [{ ...SCAN.sessions[0], title: 'Orders sync build' }] })[0];
    expect(both.label).toBe('Orders sync build');
    const parts = pastParts(both, { timeZone: 'UTC' });
    expect(parts.head).toBe('Oct 10, 09:00 · 47m · $3.50 · "Orders sync build"');
    expect(parts.detail).toBe('1 push · 1 deploy · 2 tests · Orders · 2.0k tokens');
    expect(projectsDiffer(pastSessions({ sessions: [SCAN.sessions[0], { ...SCAN.sessions[0], id: 'x' }] }))).toBe(false);
});
// --- A new session's banner ---
test("the recap counts only this session's own Companion steps, and says what is left", () => {
    const state = dashboard([
        act('push', 'ok', 'Old', NOW - 30 * HOUR, { file: 'active-development/x/Old.xml', isRestored: true }),
        act('push', 'ok', 'Orders Sync', NOW - HOUR, { file: FILE, componentId: ID }),
        act('deploy', 'ok', 'Orders Sync', NOW - HOUR, { file: FILE, componentId: ID }),
        act('test', 'failed', 'Orders Sync', NOW - 30 * 60_000, { componentId: ID, executionStatus: 'ERROR' }),
    ]);
    const recap = recapOf(state, NOW, 24 * HOUR, 2.5);
    expect(recap).toEqual({ endedAt: NOW - 30 * 60_000, components: 1, saves: 1, deploys: 1, tests: 1, testsFailed: 1, open: 1, usd: 2.5 });
    expect(recapLine(recap, NOW + 14 * HOUR)).toEqual({
        level: 'critical',
        text: 'Last session 15h ago: 1 component · 1 save · 1 deploy · 1 test (1 failed) · 1 left to fix · $2.50',
    });
    expect(recapOf(dashboard([act('other', 'ok', 'x', NOW, { script: 'component-search' })]), NOW, 24 * HOUR)).toBeUndefined();
});
test('the welcome line turns from the recap through every tip and back', () => {
    const recap = { endedAt: NOW - HOUR, components: 2, saves: 2, deploys: 0, tests: 0, testsFailed: 0, open: 0 };
    expect(welcomeLine(0, recap, NOW)).toEqual({ level: 'healthy', text: 'Last session 1h ago: 2 components · 2 saves · nothing left to fix' });
    expect(welcomeLine(1, recap, NOW).text).toBe(TIPS[0]);
    expect(welcomeLine(TIPS.length + 1, recap, NOW).text).toMatch(/^Last session/);
    expect(welcomeLine(0, undefined, NOW).text).toBe(TIPS[0]);
    for (const tip of TIPS)
        expect(tip.startsWith('Tip: ')).toBe(true);
});
// --- Companion's activity log ---
/** A line as Companion's log_activity writes it (v1.0.83). */
const logLine = (at, operation, result, details, http = 200) => JSON.stringify({ timestamp: at, skill_name: 'boomi-integration', skill_version: '1.0.83', workspace: 'w', operation, script: `boomi-${operation}`, user: 'me', boomi_user: 'me@example.com', account_id: 'a', environment_id: null, result, http_code: http, details });
test("Companion's log reads into steps in the dashboard's words, skipping lines it can't read", () => {
    const log = [
        '_code":200,"details":{}}',
        logLine('2026-10-12T11:00:00Z', 'component-create', 'success', { component_name: 'Orders Sync', component_id: ID, file_path: FILE, branch: 'account-default' }),
        logLine('2026-10-12T11:01:00Z', 'deploy-package', 'fail', { component_name: 'Orders Sync', component_id: ID, error: 'Component is not deployable' }, 400),
        logLine('2026-10-12T11:02:00Z', 'test-execute', 'success', { process_id: ID, atom_id: 'x', request_id: 'r', waited: false }),
        logLine('2026-10-12T11:03:00Z', 'undeploy', 'success', { deployment_id: 'd-1', environment_id: 'env' }),
        logLine('2026-10-12T11:04:00Z', 'folder-list', 'success', {}),
        'not json',
    ].join('\n');
    const entries = parseActivityLog(log);
    expect(entries.map(e => e.operation)).toEqual(['component-create', 'deploy-package', 'test-execute', 'undeploy', 'folder-list']);
    const steps = entries.map(e => logStep(e, 'active-development', NOW - 30 * 60_000));
    expect(steps[0]).toMatchObject({ kind: 'create', outcome: 'ok', subject: 'Orders Sync', componentId: ID, file: FILE, source: 'log', isRestored: true });
    expect(steps[1]).toMatchObject({ kind: 'deploy', outcome: 'failed', detail: 'ERROR: deploy-package failed (HTTP 400): Component is not deployable' });
    expect(describe({ id: 1, ...steps[2] })).toBe(`Test of ${ID} submitted, not waited for`);
    expect(steps[3]).toMatchObject({ kind: 'undeploy', subject: 'deployment d-1' });
    expect(steps[4]).toBeUndefined();
});
test("Claude's own runs cover their log entries, one each, so a loop's entries aren't added again", () => {
    const at = Date.parse('2026-10-12T11:00:00Z');
    const loop = [
        act('create', 'ok', 'Request Profile', at, { startedAt: at - 500, endedAt: at + 2_000, componentId: 'p1' }),
        act('create', 'ok', 'Response Profile', at, { startedAt: at - 500, endedAt: at + 2_000, componentId: 'p2' }),
    ];
    const entries = parseActivityLog([
        logLine('2026-10-12T11:00:00Z', 'component-create', 'success', { component_name: 'Request Profile', component_id: 'p1' }),
        logLine('2026-10-12T11:00:01Z', 'component-create', 'success', { component_name: 'Response Profile', component_id: 'p2' }),
        // A third, from a terminal a minute later: Claude didn't run it.
        logLine('2026-10-12T11:01:00Z', 'component-create', 'success', { component_name: 'Error Profile', component_id: 'p3' }),
    ].join('\n'));
    const opts = { now: NOW, windowMs: 24 * HOUR, sessionStart: 0, componentsDir: 'active-development' };
    const fresh = newLogSteps(entries, loop, opts);
    expect(fresh.map(s => s.subject)).toEqual(['Error Profile']);
    // Once added, it's known by its key.
    expect(newLogSteps(entries, [...loop, { id: 9, ...fresh[0] }], opts)).toEqual([]);
    // Outside the window, nothing.
    expect(newLogSteps(entries, [], { ...opts, windowMs: HOUR / 2 })).toEqual([]);
});
// --- Picking an item for a command ---
test('a command picks its item by label or by number, from the items it fits', () => {
    const needs = attention(dashboard([
        act('deploy', 'failed', 'Weather API', NOW - HOUR, { file: 'active-development/w/W.xml' }),
        act('test', 'failed', 'Orders Sync', NOW, { componentId: ID, executionStatus: 'ERROR', executionId: 'execution-1' }),
    ]), NOW, 24 * HOUR);
    const choices = choicesOf(needs, n => n.executionId !== undefined);
    expect(choices.map(c => c.n)).toEqual([1]);
    expect(choiceLabel(choices[0])).toBe('1. Test of Orders Sync ended ERROR');
    expect(choiceFrom('1. Test of Orders Sync ended ERROR', choices)?.n).toBe(1);
    expect(choiceFrom(' 1 ', choices)?.n).toBe(1);
    expect(choiceFrom('2', choices)).toBeUndefined();
    expect(choiceList('Which?', choices, '/bc-dashboard why', NOW)).toBe('Which?\n  1. ✗ Test of Orders Sync ended ERROR, just now\nRun /bc-dashboard why <number> with one of them.');
});
test('the resume command quotes a folder only when it needs it', () => {
    const s = { id: 'aaaaaaaa-1111', tokens: 0, cached: 0, models: [], runs: {}, components: [] };
    expect(resumeCommand({ ...s, project: '/Users/me/orders' })).toBe('cd /Users/me/orders && claude --resume aaaaaaaa-1111');
    expect(resumeCommand({ ...s, project: "/Users/me/pat's sync" })).toBe("cd '/Users/me/pat'\\''s sync' && claude --resume aaaaaaaa-1111");
    expect(resumeCommand(s)).toBe('claude --resume aaaaaaaa-1111');
    expect(resumable([s, { ...s, id: 'b' }], 'aaaaaaaa-1111').map(x => x.id)).toEqual(['b']);
});
// --- Companion's other plugins ---
test("each plugin's scripts read as runs: the verb, what it acted on, and nothing for read-only verbs", () => {
    const one = (command) => scriptRuns(command)[0];
    expect(one('bash s/datahub-model.sh publish 5b0a1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d --notes "v2"')).toMatchObject({ kind: 'other', product: 'datahub', script: 'datahub-model', verb: 'publish', target: '5b0a1c2d…' });
    expect(one('bash s/datahub-quarantine.sh approve repo-1 uni-1 txn-77')).toMatchObject({ verb: 'approve', target: 'txn-77' });
    expect(one('bash s/datahub-golden-record.sh enddate --universe u-1 rec-9')).toMatchObject({ verb: 'enddate', target: 'rec-9' });
    expect(one('bash s/bdi-cdc.sh enable flow-1 --no-wait')).toMatchObject({ product: 'bdi', verb: 'enable', target: 'flow-1' });
    expect(one('bash s/agentstudio-session.sh invoke --deployment dep-1 --message "hello there"')).toMatchObject({ product: 'agentstudio', verb: 'invoke', target: 'dep-1' });
    expect(one('bash s/agentstudio-deployment.sh package-create agent-1 --deploy')).toMatchObject({ verb: 'package-create', target: 'agent-1' });
    expect(one('bash s/connectordev-version.sh upload build/conn.zip --group my-group --changelog "fix"')).toMatchObject({ product: 'connectordev', verb: 'upload', target: 'my-group' });
    expect(one('bash s/connectordev-descriptor-lint.sh src/connector-descriptor.xml')).toMatchObject({ verb: '', target: 'connector-descriptor.xml' });
    expect(one('BOOMI_COMMON_SH=x bash s/boomi-marketplace-install.sh --bundle-id b-1 --folder-id 9')).toMatchObject({ product: 'marketplace', target: 'b-1' });
    // Read-only verbs, help and the env checks aren't steps.
    for (const command of [
        'bash s/datahub-model.sh list',
        'bash s/bdi-flow.sh status flow-1 run-1',
        'bash s/bdi-flow.sh logs flow-1 run-1',
        'bash s/agentstudio-agent.sh get a-1',
        'bash s/datahub-env-check.sh',
        'bash s/bdi-flow.sh run --help',
    ])
        expect(scriptRuns(command)).toEqual([]);
    // bc-integration's own scripts are as they were.
    expect(one('bash s/boomi-deploy.sh active-development/processes/Orders.xml')).toMatchObject({ kind: 'deploy' });
    expect(one('bash s/boomi-deploy.sh x.xml')?.product).toBeUndefined();
});
test("another plugin's step in words: done, doing and failed", () => {
    const base = { product: 'bdi', script: 'bdi-flow', verb: 'run', subject: 'flow-1' };
    expect(productWords(base, 'did')).toBe('BDI: ran flow flow-1');
    expect(productWords(base, 'doing')).toBe('BDI: run flow flow-1…');
    expect(productWords(base, 'failed')).toBe("BDI: couldn't run flow flow-1");
    expect(productWords({ ...base, subject: '' }, 'did')).toBe('BDI: ran a flow');
    expect(productWords({ product: 'bdi', script: 'bdi-variable', verb: 'env-set', subject: '' }, 'did')).toBe('BDI: set environment variables');
});
test('a past session counts its steps with other plugins, and one with only those still counts', () => {
    const [s] = pastSessions({
        sessions: [{ id: 's1', startedAt: '2026-10-10T09:00:00Z', commands: ['bash s/datahub-model.sh publish m-1', 'bash s/datahub-deployment.sh deploy u-1 r-1 --version 2', 'bash s/bdi-flow.sh run f-1'] }],
    });
    expect(s?.products).toEqual({ datahub: 2, bdi: 1 });
    expect(pastParts(s).detail).toContain('2 Data Hub steps · 1 BDI step');
});
// --- Usage limits and a personal Companion budget ---
test('usage limits: the busiest window first, warning from 80% or when the pace runs out before the reset', () => {
    const at = (ms) => new Date(NOW + ms).toISOString();
    const views = limitViews([
        { kind: 'five_hour', percentUsed: 10, resetsAt: at(4 * 3_600_000) },
        // Three days into the week, 60% used: 3.5 more days would use it up, and it resets in 4.
        { kind: 'seven_day', percentUsed: 60, resetsAt: at(4 * 86_400_000) },
    ], NOW);
    expect(views.map(v => v.kind)).toEqual(['seven_day', 'five_hour']);
    expect(views[0]).toMatchObject({ level: 'warning', isRunningOut: true, pace: 'used up in 2d 0h', resetsIn: '4d 0h' });
    // An hour into five, 10%: on pace for half of it.
    expect(views[1]).toMatchObject({ level: 'healthy', pace: 'on pace for 50% by reset' });
    // An hour into five, 30%: out in 2h 20m, before it resets in 4h.
    expect(limitViews([{ kind: 'five_hour', percentUsed: 30, resetsAt: at(4 * 3_600_000) }], NOW)[0]).toMatchObject({ level: 'warning', pace: 'used up in 2h 20m' });
    expect(limitViews([{ kind: 'seven_day', percentUsed: 100 }], NOW)[0]?.level).toBe('critical');
    // Too early in a window to project.
    expect(limitViews([{ kind: 'seven_day', percentUsed: 5, resetsAt: at(6.9 * 86_400_000) }], NOW)[0]?.pace).toBeUndefined();
    expect(limitsShort([{ kind: 'seven_day', percentUsed: 42.4 }, { kind: 'five_hour', percentUsed: 12 }], NOW)).toBe('week 42% · 5h 12%');
    expect(limitsLine([], NOW)).toBeUndefined();
    expect(span(90 * 60_000)).toBe('1h 30m');
    expect(span(50 * 3_600_000)).toBe('2d 2h');
});
test("Companion's share scales to its period: a seventh a day, a week, a month's days in sevenths", () => {
    const now = new Date(2026, 9, 13, 12).getTime();
    const days = { '2026-10-13': 2, '2026-10-10': 3, '2026-10-01': 5, '2026-09-30': 9 };
    expect(shareView(days, 28, 'day', now)).toMatchObject({ percent: 50, level: 'healthy' });
    expect(Math.round(shareView(days, 28, 'week', now).percent * 100)).toBe(Math.round(((2 + 3) / 28) * 10_000));
    expect(Math.round(shareView(days, 28, 'month', now).percent * 100)).toBe(Math.round(((2 + 3 + 5) / ((28 * 31) / 7)) * 10_000));
    expect(shareView(days, 0, 'week', now)).toBeUndefined();
    expect(shareView({ '2026-10-13': 4 }, 28, 'day', now)?.level).toBe('critical');
    expect(Object.keys(pruneDays({ '2026-08-01': 1, '2026-10-13': 1 }, now))).toEqual(['2026-10-13']);
});
test("Companion's month: this month's earlier sessions on this machine, not this one twice, plus this one live", () => {
    const now = new Date(2026, 9, 13, 12).getTime();
    const base = { tokens: 0, cached: 0, models: [], runs: {}, components: [] };
    const sessions = [
        { ...base, id: 'a', startedAt: new Date(2026, 9, 2).toISOString(), costUsd: 3 },
        { ...base, id: 'now', startedAt: new Date(2026, 9, 13).toISOString(), costUsd: 1 },
        { ...base, id: 'old', startedAt: new Date(2026, 8, 20).toISOString(), costUsd: 7 },
    ];
    expect(monthSpend(sessions, now, 'now', 2)).toBe(5);
    expect(monthView(8.5, 10)).toMatchObject({ level: 'warning', text: 'Companion this month: $8.50 of $10' });
    expect(monthView(1, 0)).toBeUndefined();
});
test("BDI's run responses: the run ID, the status checks in a command, and how a run went", () => {
    expect(bdiRunId('{"run_id":"6a1b","status":"pending"}')).toBe('6a1b');
    expect(bdiStatusChecks('bash s/bdi-flow.sh status flow-1 run-9 && echo done')).toEqual([{ flow: 'flow-1', run: 'run-9' }]);
    expect(bdiStatusChecks("bash s/bdi-flow.sh status 'flow-1' \"run-9\"")).toEqual([{ flow: 'flow-1', run: 'run-9' }]);
    expect(bdiStatusChecks('bash s/bdi-flow.sh runs flow-1 --from a --to b')).toEqual([]);
    expect(bdiRunReading('{"status":"failed","error_description":"No such table"}')).toEqual({ status: 'failed', reason: 'No such table' });
    expect(bdiRunReading('{"status":"failed","error_description":"Run canceled"}')).toEqual({ status: 'canceled' });
    expect(bdiRunReading('{"run":{"status":"SUCCEEDED"}}')).toEqual({ status: 'succeeded' });
    expect(bdiRunReading('NOTE: something\n{"status":"running"}')).toEqual({ status: 'running' });
    expect(bdiRunReading('ERROR: HTTP 404')).toBeUndefined();
});
// --- Cost review ---
test("a costly session's review names what drove its cost, each with a change for next time", () => {
    const [s] = pastSessions({
        sessions: [
            {
                id: 'big',
                startedAt: '2026-10-10T09:00:00Z',
                costUsd: 20.1,
                models: { 'claude-opus-5-5': { input: 100_000, output: 300_000, cacheRead: 9_000_000, cacheWrite: 450_000 }, 'claude-haiku-5-5': { input: 50_000, output: 50_000 } },
                commands: [...Array(6).fill(`bash s/boomi-test-execute.sh --process-id ${ID}`), 'bash s/boomi-component-push.sh active-development/p/Orders.xml'],
                prompts: 46,
                peakContext: 180_000,
                compactions: 2,
                subagentTokens: 500_000,
                file: '/home/me/.claude/projects/-work/big.jsonl',
            },
        ],
    });
    const { summary, findings } = reviewSession(s);
    expect(summary).toBe('$20 · 46 prompts · 950k new tokens · 9.00M re-read · peak context 180k');
    expect(findings.map(f => f.title)).toEqual([
        'Opus 5.5 did 89% of the work',
        '90% of its tokens were the conversation re-read, over 46 prompts',
        'The conversation reached 180k tokens of context',
        'It compacted 2 times',
        `${ID.slice(0, 8)}… was tested 6 times`,
        'Subagents used 53% of its new tokens',
    ]);
    expect(findings[0].tip).toContain('/model');
    expect(findings[1].tip).toContain('/clear');
    expect(findings[2].tip).toContain('/compact');
    const prompt = reviewPrompt(s);
    expect(prompt).toContain('Its transcript is /home/me/.claude/projects/-work/big.jsonl');
    expect(prompt).toContain('- It compacted 2 times');
});
test('a lean session has nothing to point at', () => {
    const [s] = pastSessions({
        sessions: [{ id: 'small', costUsd: 0.4, models: { 'claude-sonnet-5-5': { input: 2000, output: 3000, cacheRead: 10_000 } }, commands: ['bash s/boomi-deploy.sh x/P.xml'], prompts: 3, peakContext: 20_000 }],
    });
    expect(reviewSession(s).findings).toEqual([]);
    expect(reviewText(s)).toContain('✓ Nothing stands out: its cost came from the work itself.');
});
test("Data Hub's responses: a deploy's ID and status, the checks in a command, quarantine entries and their causes", () => {
    expect(datahubDeployReading('<mdm:UniverseDeployment><mdm:id>d-1</mdm:id><mdm:status>PENDING</mdm:status></mdm:UniverseDeployment>')).toEqual({ deploymentId: 'd-1', status: 'PENDING' });
    expect(datahubDeployReading('{"id":"d-2","status":"SUCCESS"}')).toEqual({ deploymentId: 'd-2', status: 'SUCCESS' });
    expect(['PENDING', 'IN_PROGRESS', 'SUCCESS', 'Deployed', 'FAILED', 'ERROR', undefined].map(deployState)).toEqual(['pending', 'pending', 'ok', 'ok', 'failed', 'failed', undefined]);
    expect(datahubStatusChecks('bash s/datahub-deployment.sh status u-1 d-1')).toEqual([{ universe: 'u-1', deployment: 'd-1' }]);
    expect(quarantineChecks('bash s/datahub-quarantine.sh query --universe u-1')).toEqual([{ universe: 'u-1', isAll: true }]);
    expect(quarantineChecks('bash s/datahub-quarantine.sh query --universe u-1 /tmp/f.xml')).toEqual([{ universe: 'u-1', isAll: false }]);
    expect(quarantineChecks('bash s/datahub-quarantine.sh reject --universe u-1 t-1')).toEqual([]);
    const entries = quarantineReading('<QuarantineQueryResponse><QuarantineEntry sourceId="S" sourceEntityId="E1"><cause>ENRICH_ERROR</cause><reason>At data quality step \'Price\': bad</reason></QuarantineEntry><QuarantineEntry><cause>ENRICH_ERROR</cause></QuarantineEntry></QuarantineQueryResponse>');
    expect(entries).toEqual([{ cause: 'ENRICH_ERROR', reason: "At data quality step 'Price': bad", sourceEntityId: 'E1' }, { cause: 'ENRICH_ERROR' }]);
    expect(causeWords(entries)).toBe('2 ENRICH_ERROR');
    expect(quarantineReading('<QuarantineQueryResponse resultCount="0"/>')).toEqual([]);
    expect(quarantineReading('ERROR: HTTP 401')).toBeUndefined();
});
test('agentstudioReading reads IDs, names and errors from JSON, and the session from a stream', () => {
    expect(agentstudioReading('{"id":"a-1","name":"Support Triage","agent_status":"DRAFT"}')).toEqual({ id: 'a-1', name: 'Support Triage' });
    expect(agentstudioReading('{"package_id":"p-1","version":3,"deployment_id":"d-1"}')).toEqual({ packageId: 'p-1', version: '3', deploymentId: 'd-1' });
    expect(agentstudioReading('{"success":true,"agent_id":"a-1","session_id":"01KS","data":{"answer":"ok"}}')).toEqual({ sessionId: '01KS' });
    expect(agentstudioReading('{"success":false,"error":"Invalid sort field: name"}')).toEqual({ error: 'Invalid sort field: name' });
    expect(agentstudioReading('event: message\ndata: {"session_id":"01KS","content":"hi"}\n\n')).toEqual({ sessionId: '01KS' });
    expect(agentstudioReading('event: message\ndata: {"session_id":"01KS"}\n\nevent: error\ndata: {"message":"Tool call failed"}\n')).toEqual({ sessionId: '01KS', error: 'Tool call failed' });
    expect(agentstudioReading('not json')).toEqual({});
});
test('productWords says "an" before a vowel and before MCP', () => {
    expect(productWords({ product: 'agentstudio', script: 'agentstudio-agent', verb: 'create' }, 'doing')).toBe('Agentstudio: create an agent…');
    expect(productWords({ product: 'agentstudio', script: 'agentstudio-source', verb: 'create' }, 'did')).toBe('Agentstudio: added an MCP server');
    expect(productWords({ product: 'agentstudio', script: 'agentstudio-tool', verb: 'create' }, 'did')).toBe('Agentstudio: created a tool');
});
