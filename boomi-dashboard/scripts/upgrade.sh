#!/usr/bin/env bash
# Upgrades a mod that Claude Code loads straight from a git checkout (the
# README's install: a clone of ClaudeMods whose mod folder is listed in
# CLAUDE_CODE_PLUGIN_DIRS). The checkout is the install, so upgrading is a
# fast-forward of it and rolling back is checking out the recorded commit.
#
#   upgrade.sh check    <mod folder>           fetch origin, then report (changes nothing)
#   upgrade.sh install  <mod folder> <commit>  safety checks, validate and test the
#                                              fetched code in a temporary worktree,
#                                              then fast-forward to <commit>
#   upgrade.sh rollback <mod folder>           check out the commit recorded before
#                                              the last install
#
# Its only network call is `git fetch origin`, in check. It never resets,
# stashes, rebases or forces, and from the fetched code it runs only
# `claude plugin validate` and `claude plugin test`. Output is `KEY: value`
# lines for /bc-dashboard upgrade to read, then plain lines; an `ERROR:` line
# and a non-zero exit when it stops.
set -uo pipefail

die() { echo "ERROR: $*"; exit "${2:-1}"; }

# Hides anything shaped like a credential before it's printed.
mask() {
  sed -E 's/(glc_|sk-)[A-Za-z0-9_-]+/\1****/g; s/eyJ[A-Za-z0-9._-]+/eyJ****/g; s/(Bearer|Basic) [A-Za-z0-9+\/=._~-]+/\1 ****/g'
}

sub="${1:-}"
root="${2:-}"
[[ -n "$sub" && -n "$root" ]] || die "usage: upgrade.sh check|install|rollback <mod folder> [commit]"
[[ -d "$root" ]] || die "no mod folder at $root"
root=$(cd "$root" && pwd -P)
[[ -f "$root/.claude-plugin/plugin.json" ]] || die "$root has no .claude-plugin/plugin.json"

top=$(git -C "$root" rev-parse --show-toplevel 2>/dev/null) || die "$root isn't in a git checkout, so there's nothing to upgrade from. Install it as the README says."
top=$(cd "$top" && pwd -P)
g() { git -C "$top" "$@"; }
rel="${root#"$top"/}"
[[ "$root" == "$top" ]] && rel="."
g remote get-url origin >/dev/null 2>&1 || die "the checkout at $top has no origin remote"
gitdir=$(g rev-parse --absolute-git-dir)
record="$gitdir/bc-dashboard-upgrade"

# The branch the install follows: origin's default branch.
branch=$(g symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
branch="${branch#origin/}"
[[ -n "$branch" ]] || branch=main
current=$(g symbolic-ref --quiet --short HEAD 2>/dev/null)
[[ -z "$current" || "$current" == "$branch" ]] || die "the checkout is on branch $current, not $branch; switch it back yourself first"

manifest() { [[ "$rel" == "." ]] && echo ".claude-plugin/plugin.json" || echo "$rel/.claude-plugin/plugin.json"; }
version_at() {
  local json
  if [[ "$1" == "live" ]]; then json=$(cat "$root/.claude-plugin/plugin.json"); else json=$(g show "$1:$(manifest)" 2>/dev/null); fi
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$json" | head -1
}

# The mods Claude Code loads from this checkout: this one first, then any
# other folder of it named in CLAUDE_CODE_PLUGIN_DIRS.
mods() {
  local seen=" $rel " out="$rel" dir path
  IFS=':' read -r -a dirs <<<"${CLAUDE_CODE_PLUGIN_DIRS:-}"
  for dir in "${dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    path=$(cd "$dir" && pwd -P)
    [[ "$path" == "$top" || "$path" == "$top/"* ]] || continue
    [[ -f "$path/.claude-plugin/plugin.json" ]] || continue
    local r="${path#"$top"/}"
    [[ "$path" == "$top" ]] && r="."
    [[ "$seen" == *" $r "* ]] && continue
    seen+="$r "
    out+=" $r"
  done
  echo "$out"
}

dirty() { g status --porcelain --untracked-files=no | wc -l | tr -d ' '; }
upstream() { g rev-parse --verify --quiet "refs/remotes/origin/$branch"; }
# Commits that would be left behind: on the local branch or HEAD, not on origin.
ahead() {
  local up="$1" n=0
  if g rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then n=$(g rev-list --count "$up..refs/heads/$branch"); fi
  local h
  h=$(g rev-list --count "$up..HEAD")
  echo $(( n > h ? n : h ))
}

case "$sub" in
  check)
    if ! fetched=$(GIT_TERMINAL_PROMPT=0 g -c core.sshCommand='ssh -oBatchMode=yes -oConnectTimeout=15' fetch --quiet origin 2>&1); then
      printf '%s\n' "$fetched" | mask | sed 's/^/FETCH: /'
      die "couldn't fetch from origin (offline, or no access); nothing changed"
    fi
    target=$(upstream) || die "origin has no $branch branch; nothing changed"
    head=$(g rev-parse HEAD)
    echo "ROOT: $top"
    echo "MOD: $rel"
    echo "ORIGIN: $(g remote get-url origin | sed -E 's#//[^/@]*@#//#')"
    echo "BRANCH: $branch"
    echo "HEAD: $head"
    echo "DETACHED: $([[ -z "$current" ]] && echo yes || echo no)"
    echo "TARGET: $target"
    echo "INSTALLED: $(version_at live)"
    echo "LATEST: $(version_at "$target")"
    echo "BEHIND: $(g rev-list --count "HEAD..$target")"
    echo "AHEAD: $(ahead "$target")"
    echo "DIRTY: $(dirty)"
    echo "MODS: $(mods)"
    [[ -f "$record" ]] && echo "PREVIOUS: $(sed -n 's/^PREVIOUS_VERSION=//p' "$record") $(sed -n 's/^PREVIOUS_COMMIT=//p' "$record")"
    g log --format='COMMIT: %h %s' "HEAD..$target" | mask
    g diff --name-status "HEAD" "$target" | mask | sed 's/^/FILE: /'
    log="CHANGELOG.md"
    [[ "$rel" != "." ]] && log="$rel/CHANGELOG.md"
    g show "$target:$log" 2>/dev/null | mask | sed 's/^/CHANGELOG: /'
    ;;

  install)
    want="${3:-}"
    [[ -n "$want" ]] || die "install needs the commit the check reported"
    target=$(upstream) || die "no origin/$branch yet: run the check first"
    want=$(g rev-parse --verify --quiet "$want^{commit}") || die "$3 isn't a commit in this checkout: run the check again"
    [[ "$want" == "$target" ]] || die "origin/$branch changed since the check; run the check again to see what's new"
    if [[ $(g rev-parse HEAD) == "$target" && -n "$current" ]]; then
      echo "UP-TO-DATE: $(version_at live) at $(g rev-parse --short HEAD)"
      exit 0
    fi

    # 1. Nothing of the person's may be lost or moved.
    (( $(dirty) == 0 )) || die "the checkout at $top has uncommitted changes. Commit or put them aside yourself, then run the upgrade again. Nothing was changed." 2
    (( $(ahead "$target") == 0 )) || die "the checkout has commits that are not on origin/$branch. Push or move them yourself, then run the upgrade again. Nothing was changed." 2
    # 2. Fast-forward only.
    g merge-base --is-ancestor HEAD "$target" || die "HEAD isn't an ancestor of origin/$branch, so this isn't a fast-forward. Nothing was changed." 2
    if g rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then
      g merge-base --is-ancestor "refs/heads/$branch" "$target" || die "$branch can't fast-forward to origin/$branch. Nothing was changed." 2
    fi

    # 3. Validate and test the fetched code before it goes live, in a worktree of its own.
    command -v claude >/dev/null || die "the claude command isn't on PATH, so the fetched code can't be validated and tested. Nothing was changed."
    wt=$(mktemp -d "${TMPDIR:-/tmp}/bc-upgrade.XXXXXX") || die "couldn't make a temporary folder"
    cleanup() { g worktree remove --force "$wt" >/dev/null 2>&1; rm -rf "$wt"; g worktree prune >/dev/null 2>&1; }
    trap cleanup EXIT
    g worktree add --quiet --detach "$wt" "$target" >/dev/null 2>&1 || die "couldn't check out $target to test it. Nothing was changed."
    for mod in $(mods); do
      dir="$wt/$mod"
      [[ "$mod" == "." ]] && dir="$wt"
      [[ -d "$dir" ]] || continue
      for step in validate test; do
        if ! out=$(claude plugin "$step" "$dir" 2>&1); then
          echo "TESTS-FAILED: $mod ($step)"
          printf '%s\n' "$out" | tail -n 60 | mask
          die "the new version's $step failed for $mod, so it wasn't installed. You're still on $(version_at live)." 3
        fi
        echo "PASSED: $mod ($step)"
      done
    done

    # 4. Record where it was, then install: the fast-forward is the install.
    previous=$(g rev-parse HEAD)
    {
      echo "PREVIOUS_COMMIT=$previous"
      echo "PREVIOUS_VERSION=$(version_at live)"
      echo "PREVIOUS_REF=${current:-detached}"
      echo "RECORDED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$record"
    if [[ -z "$current" ]]; then
      g switch --quiet "$branch" 2>&1 | mask || die "couldn't switch back to $branch"
    fi
    g merge --ff-only --quiet "$target" 2>&1 | mask
    [[ $(g rev-parse HEAD) == "$target" ]] || die "the fast-forward didn't land; the checkout is at $(g rev-parse --short HEAD). /bc-dashboard upgrade --rollback goes back to $(sed -n 's/^PREVIOUS_VERSION=//p' "$record")."

    # 5. Smoke check: the installed version reads back as the one tested.
    now=$(version_at live)
    echo "INSTALLED-NOW: $now"
    [[ "$now" == "$(version_at "$target")" ]] || die "the version reads back as $now, not $(version_at "$target")"
    claude plugin validate "$root" >/dev/null 2>&1 || die "the installed mod doesn't validate; /bc-dashboard upgrade --rollback goes back"
    echo "PREVIOUS: $(sed -n 's/^PREVIOUS_VERSION=//p' "$record") $previous"
    ;;

  rollback)
    [[ -f "$record" ]] || die "No previous version recorded: rollback works after an upgrade made with /bc-dashboard upgrade."
    previous=$(sed -n 's/^PREVIOUS_COMMIT=//p' "$record")
    was=$(sed -n 's/^PREVIOUS_VERSION=//p' "$record")
    g cat-file -e "$previous^{commit}" 2>/dev/null || die "the recorded commit $previous isn't in the checkout any more"
    (( $(dirty) == 0 )) || die "the checkout at $top has uncommitted changes. Commit or put them aside yourself, then roll back. Nothing was changed." 2
    if up=$(upstream); then
      (( $(g rev-list --count "$up..HEAD") == 0 )) || die "HEAD has commits that are not on origin/$branch; rolling back would leave them behind. Nothing was changed." 2
    fi
    if [[ $(g rev-parse HEAD) == "$previous" ]]; then
      echo "INSTALLED-NOW: $(version_at live)"
      echo "ALREADY: at the recorded version $was"
      exit 0
    fi
    g switch --quiet --detach "$previous" 2>&1 | mask
    [[ $(g rev-parse HEAD) == "$previous" ]] || die "couldn't check out $previous"
    echo "INSTALLED-NOW: $(version_at live)"
    echo "ROLLED-BACK: $was at $(g rev-parse --short HEAD); $branch still holds the newer version, and /bc-dashboard upgrade returns to it"
    ;;

  *) die "unknown subcommand $sub: check, install or rollback" ;;
esac
