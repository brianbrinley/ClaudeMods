// Boomi Companion's other plugins: Marketplace recipes, Data Hub, BDI
// (formerly Rivery), Agentstudio and custom connector development. Each is a
// skill folder of bash scripts called as `<script> <verb> <id or file> [--flags]`,
// read from the plugins' own scripts (bc-marketplace 0.2.10, bc-datahub
// 0.2.12, bc-bdi 0.2.5, bc-agentstudio 0.1.42, bc-connectordev 0.0.50).
// Plain functions: nothing here touches the engine.
/** Each product's name, as a person reads it. */
export const PRODUCT_NAMES = {
    marketplace: 'Marketplace',
    datahub: 'Data Hub',
    bdi: 'BDI',
    agentstudio: 'Agentstudio',
    connectordev: 'Connectors',
};
const v = (did, does, noun, target) => ({ did, does, noun, ...(target ? { target } : {}) });
/** The usual verbs on a thing: created, updated, deleted. */
const crud = (noun, extra = {}) => ({
    create: v('created', 'create', noun),
    update: v('updated', 'update', noun),
    delete: v('deleted', 'delete', noun),
    ...extra,
});
/** Scripts without subcommands: their one action is under ''. */
const PRODUCT_SCRIPTS = {
    'boomi-marketplace-install.sh': { product: 'marketplace', verbs: { '': v('installed', 'install', 'recipe', '--bundle-id') } },
    'boomi-marketplace-supporting-materials.sh': {
        product: 'marketplace',
        verbs: { '': v('downloaded the supporting materials of', 'download the supporting materials of', 'recipe', '--bundle-id') },
    },
    'datahub-model.sh': {
        product: 'datahub',
        verbs: crud('model', {
            publish: v('published', 'publish', 'model'),
            pull: v('pulled', 'pull', 'model'),
            'add-quality-step': v('added a quality step to', 'add a quality step to', 'model'),
            'remove-quality-step': v('removed a quality step from', 'remove a quality step from', 'model'),
        }),
    },
    'datahub-source.sh': {
        product: 'datahub',
        verbs: crud('source', {
            pull: v('pulled', 'pull', 'source'),
            'enable-initial-load': v('started the initial load of', 'start the initial load of', 'source'),
            'finish-initial-load': v('finished the initial load of', 'finish the initial load of', 'source'),
        }),
    },
    'datahub-deployment.sh': {
        product: 'datahub',
        verbs: { deploy: v('deployed', 'deploy', 'universe'), undeploy: v('undeployed', 'undeploy', 'universe') },
    },
    'datahub-quarantine.sh': {
        product: 'datahub',
        verbs: {
            approve: v('approved', 'approve', 'quarantined record', 'last'),
            reject: v('rejected', 'reject', 'quarantined record'),
            delete: v('deleted', 'delete', 'quarantined record', 'last'),
        },
    },
    'datahub-golden-record.sh': {
        product: 'datahub',
        verbs: {
            update: v('updated', 'update', 'golden records'),
            enddate: v('end-dated', 'end-date', 'golden record'),
            'enddate-bulk': v('end-dated', 'end-date', 'golden records'),
            restore: v('restored', 'restore', 'golden record'),
            unlink: v('unlinked a source from', 'unlink a source from', 'golden record'),
        },
    },
    'datahub-repository.sh': { product: 'datahub', verbs: { create: v('created', 'create', 'repository', 'last') } },
    'datahub-connection.sh': { product: 'datahub', verbs: { bootstrap: v('created', 'create', 'connection', 'last') } },
    'bdi-flow.sh': {
        product: 'bdi',
        verbs: {
            run: v('ran', 'run', 'flow'),
            'run-sub': v('ran a sub-flow of', 'run a sub-flow of', 'flow'),
            cancel: v('cancelled a run of', 'cancel a run of', 'flow'),
            activate: v('activated', 'activate', 'flow'),
            disable: v('disabled', 'disable', 'flow'),
            copy: v('copied', 'copy', 'flow'),
            create: v('created', 'create', 'flow'),
            edit: v('updated', 'update', 'flow'),
            restore: v('restored a version of', 'restore a version of', 'flow'),
        },
    },
    'bdi-connection.sh': {
        product: 'bdi',
        verbs: {
            create: v('created', 'create', 'connection'),
            edit: v('updated', 'update', 'connection'),
            'add-file': v('uploaded a file for', 'upload a file for', 'connection'),
        },
    },
    'bdi-cdc.sh': {
        product: 'bdi',
        verbs: {
            enable: v('turned on CDC for', 'turn on CDC for', 'flow'),
            disable: v('turned off CDC for', 'turn off CDC for', 'flow'),
            set: v('set the CDC offset of', 'set the CDC offset of', 'flow'),
            delete: v('cleared the CDC offset of', 'clear the CDC offset of', 'flow'),
        },
    },
    'bdi-env.sh': { product: 'bdi', verbs: { create: v('created', 'create', 'environment'), edit: v('updated', 'update', 'environment') } },
    'bdi-variable.sh': {
        product: 'bdi',
        verbs: {
            'env-set': v('set environment variables', 'set environment variables', ''),
            'env-delete': v('deleted environment variable', 'delete environment variable', ''),
            'river-set': v('set the variables of', 'set the variables of', 'flow'),
        },
    },
    'bdi-dataframe.sh': {
        product: 'bdi',
        verbs: { add: v('created', 'create', 'dataframe'), update: v('updated', 'update', 'dataframe'), clear: v('cleared', 'clear', 'dataframe') },
    },
    'bdi-logicode.sh': { product: 'bdi', verbs: { upload: v('uploaded Python file', 'upload Python file', '') } },
    'agentstudio-agent.sh': { product: 'agentstudio', verbs: { create: v('created', 'create', 'agent'), update: v('updated', 'update', 'agent') } },
    'agentstudio-tool.sh': {
        product: 'agentstudio',
        verbs: {
            create: v('created', 'create', 'tool'),
            update: v('updated', 'update', 'tool'),
            install: v('installed', 'install', 'tool'),
            uninstall: v('uninstalled', 'uninstall', 'tool'),
        },
    },
    'agentstudio-source.sh': { product: 'agentstudio', verbs: { create: v('added', 'add', 'MCP server'), update: v('updated', 'update', 'MCP server') } },
    'agentstudio-deployment.sh': {
        product: 'agentstudio',
        verbs: { 'package-create': v('packaged', 'package', 'agent'), deploy: v('deployed', 'deploy', 'agent') },
    },
    'agentstudio-session.sh': {
        product: 'agentstudio',
        verbs: {
            invoke: v('talked to', 'talk to', 'deployment', '--deployment'),
            continue: v('talked to', 'talk to', 'deployment', '--deployment'),
        },
    },
    'connectordev-init.sh': { product: 'connectordev', verbs: { '': v('created connector project', 'create connector project', '') } },
    'connectordev-descriptor-lint.sh': { product: 'connectordev', verbs: { '': v('linted connector descriptor', 'lint connector descriptor', '') } },
    'connectordev-doctor.sh': { product: 'connectordev', verbs: { '': v('checked connector project', 'check connector project', '') } },
    'connectordev-version.sh': {
        product: 'connectordev',
        verbs: {
            upload: v('uploaded a version to', 'upload a version to', 'connector group', '--group'),
            validate: v('validated connector descriptor', 'validate connector descriptor', ''),
            delete: v('deleted a version of', 'delete a version of', 'connector group'),
        },
    },
    'connectordev-group.sh': {
        product: 'connectordev',
        verbs: {
            create: v('created a connector group', 'create a connector group', ''),
            delete: v('deleted', 'delete', 'connector group'),
            'classification-add': v('added a connector classification', 'add a connector classification', ''),
            'classification-delete': v('deleted', 'delete', 'connector classification'),
        },
    },
    'connectordev-version-change.sh': {
        product: 'connectordev',
        verbs: {
            set: v('changed the connector version of', 'change the connector version of', 'classification'),
            cancel: v('cancelled the version change of', 'cancel the version change of', 'classification'),
        },
    },
};
/** Whether a word names one of the other plugins' scripts, read-only ones included. */
export const isProductScript = (name) => name in PRODUCT_SCRIPTS || /^(datahub|bdi|agentstudio|connectordev)-[a-z-]+\.sh$/.test(name) || /^boomi-marketplace-[a-z-]+\.sh$/.test(name);
/** Flags that stand alone: everything else that starts with -- takes the next word. */
const SWITCHES = new Set([
    '--draft',
    '--dry-run',
    '--no-wait',
    '--deploy',
    '--all',
    '--all-schemas',
    '--icons',
    '--skip-network',
    '--has-active-deployments',
    '--include-deleted',
    '--deployable',
]);
/** An ID shortened as the rest of the dashboard does, a path to its file name, a name as it is. */
const shortTarget = (word) => {
    const base = word.includes('/') ? (word.split('/').filter(Boolean).pop() ?? word) : word;
    return /^[0-9a-f-]{16,}$/i.test(base) || (base.length > 24 && !/\s/.test(base)) ? `${base.slice(0, 8)}…` : base;
};
/**
 * A run of another plugin's script, from its name and the words after it.
 * Undefined for a script that isn't one, help, and a subcommand that only reads.
 */
export const productRun = (name, args) => {
    const script = PRODUCT_SCRIPTS[name];
    if (!script)
        return undefined;
    if (args.some(arg => arg === '-h' || arg === '--help' || arg === 'help'))
        return undefined;
    const hasVerbs = !('' in script.verbs);
    const verb = hasVerbs ? (args[0] ?? '') : '';
    const found = script.verbs[verb];
    if (!found)
        return undefined;
    const rest = hasVerbs ? args.slice(1) : args;
    const positional = [];
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg.startsWith('--')) {
            const [flag, inline] = arg.split('=', 2);
            if (inline !== undefined)
                flags[flag] = inline;
            else if (!SWITCHES.has(flag) && rest[i + 1] !== undefined)
                flags[flag] = rest[++i];
        }
        else if (!arg.startsWith('-'))
            positional.push(arg);
    }
    const raw = found.target?.startsWith('--')
        ? flags[found.target]
        : found.target === 'last'
            ? positional[positional.length - 1]
            : positional[0];
    const run = { product: script.product, script: name.replace(/\.sh$/, ''), verb };
    if (raw) {
        run.target = shortTarget(raw);
        run.ref = raw;
    }
    return run;
};
/** What a product step did, in words: "Data Hub: deployed universe 3f2a9c1e…". */
export const productWords = (run, how) => {
    const found = PRODUCT_SCRIPTS[`${run.script}.sh`]?.verbs[run.verb];
    const name = PRODUCT_NAMES[run.product];
    if (!found)
        return `${name}: ${run.script} ${run.verb}`.trim();
    const what = run.subject ? [found.noun, run.subject].filter(Boolean).join(' ') : found.noun ? `${/^(?:[aeiou]|MCP\b)/i.test(found.noun) ? 'an' : 'a'} ${found.noun}` : '';
    const phrase = (verb) => [verb, what].filter(Boolean).join(' ');
    if (how === 'did')
        return `${name}: ${phrase(found.did)}`;
    if (how === 'doing')
        return `${name}: ${phrase(found.does)}…`;
    return `${name}: couldn't ${phrase(found.does)}`;
};
/**
 * The components a Marketplace install copied into the account, from its
 * output: after "Copied component IDs:", one "  <id> (v<version>)" line each.
 */
export const recipeComponents = (output) => {
    const at = output.indexOf('Copied component IDs:');
    if (at < 0)
        return [];
    return [...output.slice(at).matchAll(/^\s+([0-9a-f][0-9a-f-]{7,})\s+\(v(\d+|\?)\)\s*$/gim)].map(m => ({
        componentId: m[1],
        ...(m[2] && m[2] !== '?' ? { version: m[2] } : {}),
    }));
};
/** The run ID a `bdi-flow.sh run` response carries. */
export const bdiRunId = (output) => output.match(/"run_id"\s*:\s*"([^"]+)"/)?.[1];
/** A `bdi-flow.sh status <flow-id> <run-id>` in a command: Claude checking how a run went. */
export const bdiStatusChecks = (command) => [...command.matchAll(/bdi-flow\.sh\s+status\s+(?:'|")?([^\s'";&|]+)(?:'|")?\s+(?:'|")?([^\s'";&|]+)/g)].map(m => ({ flow: m[1], run: m[2] }));
/**
 * How a run went, from a status check's response: its status, and the
 * reason a failed one gives. BDI reports a cancelled run as failed with
 * "Run canceled"; that reads as cancelled. Undefined when the response
 * names no status.
 */
export const bdiRunReading = (output) => {
    let body;
    try {
        body = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
    }
    catch {
        return undefined;
    }
    const top = (body && typeof body === 'object' ? body : {});
    const run = (top.run && typeof top.run === 'object' ? top.run : top);
    const raw = run.status ?? run.run_status;
    if (typeof raw !== 'string' || !raw)
        return undefined;
    const reason = typeof run.error_description === 'string' && run.error_description ? run.error_description : undefined;
    const status = raw.toLowerCase();
    if (status === 'failed' && reason && /^run cancel+ed$/i.test(reason.trim()))
        return { status: 'canceled' };
    return reason ? { status, reason } : { status };
};
/**
 * A Data Hub status word as a state. The values aren't documented, so this
 * reads them leniently: anything naming success or completion is done,
 * anything naming failure or error failed, the rest still in progress.
 */
export const deployState = (status) => {
    if (!status)
        return undefined;
    if (/fail|error|cancel/i.test(status))
        return 'failed';
    if (/success|succeeded|complete|deployed|done/i.test(status))
        return 'ok';
    return 'pending';
};
/** A universe deploy's response: its deployment ID and status, in XML (mdm:) or JSON. */
export const datahubDeployReading = (output) => {
    const xml = (tag) => output.match(new RegExp(`<(?:mdm:)?${tag}>\\s*([^<\\s][^<]*?)\\s*</(?:mdm:)?${tag}>`))?.[1];
    const json = (key) => output.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1];
    const deploymentId = json('deploymentId') ?? xml('deploymentId') ?? json('id') ?? xml('id');
    const status = json('status') ?? xml('status');
    return { ...(deploymentId ? { deploymentId } : {}), ...(status ? { status } : {}) };
};
/** A `datahub-deployment.sh status <universe-id> <deployment-id>` in a command: Claude checking a deploy. */
export const datahubStatusChecks = (command) => [...command.matchAll(/datahub-deployment\.sh\s+status\s+(?:'|")?([^\s'";&|]+)(?:'|")?\s+(?:'|")?([^\s'";&|]+)/g)].map(m => ({ universe: m[1], deployment: m[2] }));
/**
 * A `datahub-quarantine.sh query --universe <id> [filter.xml]` in a command:
 * Claude looking at a universe's quarantine. Without a filter file it lists
 * every active entry, so its count is the universe's.
 */
export const quarantineChecks = (command) => [...command.matchAll(/datahub-quarantine\.sh\s+query\b([^;&|\n]*)/g)].flatMap(m => {
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    const at = words.indexOf('--universe');
    const universe = at >= 0 ? words[at + 1]?.replace(/^['"]|['"]$/g, '') : undefined;
    if (!universe)
        return [];
    const rest = words.filter((w, i) => i !== at && i !== at + 1);
    return [{ universe, isAll: !rest.some(w => /\.xml['"]?$/.test(w)) }];
});
/** A quarantine query's response: its entries, from the Repository API's XML. Undefined when it isn't one. */
export const quarantineReading = (output) => {
    if (!/<(?:\w+:)?QuarantineQueryResponse\b|<(?:\w+:)?QuarantineEntry\b/.test(output))
        return undefined;
    return [...output.matchAll(/<(?:\w+:)?QuarantineEntry\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?QuarantineEntry>/g)].map(m => {
        const attrs = m[1];
        const body = m[2];
        const tag = (name) => body.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`))?.[1]?.trim();
        const entity = attrs.match(/sourceEntityId="([^"]*)"/)?.[1];
        const reason = tag('reason');
        return { cause: tag('cause') ?? 'UNKNOWN', ...(reason ? { reason } : {}), ...(entity ? { sourceEntityId: entity } : {}) };
    });
};
/** A quarantine's causes in a few words: "2 PARSE_FAILURE, 1 REQUIRED_FIELD". */
export const causeWords = (entries) => {
    const counts = new Map();
    for (const e of entries)
        counts.set(e.cause, (counts.get(e.cause) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([cause, n]) => `${n} ${cause}`).join(', ');
};
const textField = (o, ...keys) => {
    for (const key of keys) {
        const value = o[key];
        if (typeof value === 'string' && value)
            return value;
        if (typeof value === 'number')
            return String(value);
    }
    return undefined;
};
export const agentstudioReading = (output) => {
    const out = {};
    if (/^event:/m.test(output)) {
        out.sessionId = output.match(/"session_id"\s*:\s*"([^"]+)"/)?.[1];
        const error = output.match(/^event:\s*error\s*\n(?:data:\s*(.*))?/m);
        if (error) {
            const data = error[1] ?? '';
            out.error = data.match(/"(?:message|error|detail)"\s*:\s*"([^"]+)"/)?.[1] ?? (data.trim() || 'the agent replied with an error');
        }
        return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
    }
    let body;
    try {
        body = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
    }
    catch {
        return out;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
        return out;
    const top = body;
    const inner = top.data && typeof top.data === 'object' && !Array.isArray(top.data) ? top.data : {};
    const field = (...keys) => textField(top, ...keys) ?? textField(inner, ...keys);
    const found = {
        id: field('id'),
        name: field('name'),
        agentName: field('agent_name'),
        packageId: field('package_id'),
        deploymentId: field('deployment_id'),
        version: field('version', 'package_version', 'version_number'),
        sessionId: field('session_id'),
    };
    if (top.success === false) {
        const error = top.error ?? top.message ?? top.detail;
        found.error = typeof error === 'string' && error ? error : 'the response said success: false';
    }
    return Object.fromEntries(Object.entries(found).filter(([, v]) => v !== undefined));
};
