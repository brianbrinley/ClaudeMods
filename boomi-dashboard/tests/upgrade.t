#!/usr/bin/env bash
# Tests scripts/upgrade.sh against a throwaway bare repo and two clones: a
# publisher that pushes new versions, and an install the way the README sets
# one up (a checkout whose mod folder Claude Code loads). A fake `claude` on
# PATH stands for `claude plugin validate` and `claude plugin test`: it fails
# when the folder it's given holds a file named FAIL. Run: prove boomi-dashboard/tests
set -u
script="$(cd "$(dirname "$0")/.." && pwd)/scripts/upgrade.sh"
n=0
fails=0
ok() { n=$((n + 1)); if eval "$2"; then echo "ok $n - $1"; else echo "not ok $n - $1"; fails=$((fails + 1)); fi; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL="$work/gitconfig"
git config --file "$GIT_CONFIG_GLOBAL" init.defaultBranch main
git config --file "$GIT_CONFIG_GLOBAL" advice.detachedHead false

mkdir -p "$work/bin"
cat > "$work/bin/claude" <<'EOF'
#!/usr/bin/env bash
echo "claude $*" >> "$CLAUDE_LOG"
if [[ -e "$3/FAIL" ]]; then echo "1 fail: token sk-abc123 leaked in a test name" >&2; exit 1; fi
echo "$2 passed for $3"
EOF
chmod +x "$work/bin/claude"
export PATH="$work/bin:$PATH"
export CLAUDE_LOG="$work/claude.log"

# A fresh origin with one release, a publisher clone and an install clone.
setup() {
  rm -rf "$work/origin.git" "$work/pub" "$work/install"
  : > "$CLAUDE_LOG"
  git init -q --bare "$work/origin.git"
  git clone -q "$work/origin.git" "$work/pub" 2>/dev/null
  release 0.1.0 "first"
  git -C "$work/pub" push -q origin main 2>/dev/null
  git -C "$work/origin.git" symbolic-ref HEAD refs/heads/main
  git clone -q "$work/origin.git" "$work/install" 2>/dev/null
  export CLAUDE_CODE_PLUGIN_DIRS="$work/install/boomi-dashboard"
}

# Commits a new version in the publisher: plugin.json and a changelog entry.
release() {
  mkdir -p "$work/pub/boomi-dashboard/.claude-plugin" "$work/pub/boomi-runtime/.claude-plugin"
  printf '{ "name": "boomi-dashboard", "version": "%s" }\n' "$1" > "$work/pub/boomi-dashboard/.claude-plugin/plugin.json"
  printf '{ "name": "boomi-runtime", "version": "0.3.0" }\n' > "$work/pub/boomi-runtime/.claude-plugin/plugin.json"
  local log="$work/pub/boomi-dashboard/CHANGELOG.md"
  { echo "# Changelog"; echo; echo "## $1"; echo; echo "- $2"; [[ -f "$log" ]] && tail -n +2 "$log"; } > "$log.new"
  mv "$log.new" "$log"
  git -C "$work/pub" add -A
  git -C "$work/pub" commit -q -m "boomi-dashboard $1: $2"
}

publish() { release "$@"; git -C "$work/pub" push -q origin main 2>/dev/null; }

root() { echo "$work/install/boomi-dashboard"; }
version() { sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$work/install/boomi-dashboard/.claude-plugin/plugin.json"; }
head_of() { git -C "$work/install" rev-parse HEAD; }
field() { sed -n "s/^$1: //p" <<<"$out" | head -1; }

# --- Behind by 2 commits, tests pass ---
setup
publish 0.2.0 "second"
publish 0.3.0 "third"
before=$(head_of)
out=$(bash "$script" check "$(root)" 2>&1); code=$?
ok 'check succeeds when behind' '[[ $code -eq 0 ]]'
ok 'check reports the installed and latest versions' '[[ $(field INSTALLED) == 0.1.0 && $(field LATEST) == 0.3.0 ]]'
ok 'check counts the commits behind' '[[ $(field BEHIND) == 2 ]]'
ok 'check lists each commit' '[[ $(grep -c "^COMMIT: " <<<"$out") -eq 2 ]]'
ok 'check lists the changed files' 'grep -q "^FILE: M	boomi-dashboard/.claude-plugin/plugin.json" <<<"$out"'
ok 'check carries the latest changelog' 'grep -q "^CHANGELOG: ## 0.3.0" <<<"$out" && grep -q "^CHANGELOG: - second" <<<"$out"'
ok 'check names the mods it would touch' '[[ $(field MODS) == boomi-dashboard ]]'
ok 'check changes nothing' '[[ $(head_of) == "$before" && $(version) == 0.1.0 ]]'
target=$(field TARGET)
out=$(bash "$script" install "$(root)" "$target" 2>&1); code=$?
ok 'install succeeds' '[[ $code -eq 0 ]]'
ok 'install ran validate and test on the fetched code, not the live folder' 'grep -q "claude plugin validate .*bc-upgrade" "$CLAUDE_LOG" && grep -q "claude plugin test .*bc-upgrade" "$CLAUDE_LOG"'
ok 'the version reads back as the new one' '[[ $(field INSTALLED-NOW) == 0.3.0 && $(version) == 0.3.0 ]]'
ok 'the checkout fast-forwarded to the target' '[[ $(head_of) == "$target" ]]'
ok 'the previous commit is recorded' 'grep -q "^PREVIOUS_COMMIT=$before" "$(git -C "$work/install" rev-parse --absolute-git-dir)/bc-dashboard-upgrade"'
ok 'the temporary worktree is gone' '[[ -z $(git -C "$work/install" worktree list | sed 1d) ]]'

# --- Rollback restores the previous version ---
out=$(bash "$script" rollback "$(root)" 2>&1); code=$?
ok 'rollback succeeds' '[[ $code -eq 0 ]]'
ok 'rollback restores the previous version' '[[ $(version) == 0.1.0 && $(head_of) == "$before" && $(field INSTALLED-NOW) == 0.1.0 ]]'
ok 'rollback leaves main as it was' '[[ $(git -C "$work/install" rev-parse main) == "$target" ]]'
out=$(bash "$script" check "$(root)" 2>&1)
ok 'after a rollback, check sees the newer version again' '[[ $(field LATEST) == 0.3.0 && $(field BEHIND) == 2 ]]'
out=$(bash "$script" install "$(root)" "$(field TARGET)" 2>&1); code=$?
ok 'an upgrade after a rollback goes back to main' '[[ $code -eq 0 && $(version) == 0.3.0 && $(git -C "$work/install" symbolic-ref --short HEAD) == main ]]'

# --- Up to date ---
out=$(bash "$script" check "$(root)" 2>&1); code=$?
ok 'up to date: says so' '[[ $code -eq 0 && $(field BEHIND) == 0 && $(field INSTALLED) == $(field LATEST) ]]'
before=$(head_of)
out=$(bash "$script" install "$(root)" "$before" 2>&1); code=$?
ok 'up to date: install changes nothing' '[[ $code -eq 0 && $(head_of) == "$before" ]] && grep -q "^UP-TO-DATE" <<<"$out"'

# --- Dirty working tree ---
setup
publish 0.2.0 "second"
echo "my edit" >> "$work/install/boomi-dashboard/CHANGELOG.md"
before=$(head_of)
out=$(bash "$script" check "$(root)" 2>&1)
ok 'check reports a dirty tree' '[[ $(field DIRTY) == 1 ]]'
out=$(bash "$script" install "$(root)" "$(field TARGET)" 2>&1); code=$?
ok 'dirty tree: install refuses' '[[ $code -ne 0 ]] && grep -q "uncommitted changes" <<<"$out"'
ok 'dirty tree: nothing changed' '[[ $(head_of) == "$before" && $(version) == 0.1.0 ]] && grep -q "my edit" "$work/install/boomi-dashboard/CHANGELOG.md"'
ok 'dirty tree: no tests ran' '[[ ! -s "$CLAUDE_LOG" ]]'
git -C "$work/install" checkout -q -- .
out=$(bash "$script" rollback "$(root)" 2>&1); code=$?
ok 'rollback with nothing recorded says so' '[[ $code -ne 0 ]] && grep -q "No previous version" <<<"$out"'

# --- A local commit not on origin ---
echo "local" > "$work/install/local.txt"
git -C "$work/install" add local.txt
git -C "$work/install" commit -q -m local
before=$(head_of)
out=$(bash "$script" check "$(root)" 2>&1)
target=$(field TARGET)
ok 'check reports local commits' '[[ $(field AHEAD) == 1 ]]'
out=$(bash "$script" install "$(root)" "$target" 2>&1); code=$?
ok 'diverged history: install refuses' '[[ $code -ne 0 ]] && grep -q "not on origin" <<<"$out"'
ok 'diverged history: nothing changed' '[[ $(head_of) == "$before" ]]'

# --- Not a fast-forward, without local commits on the branch: origin rewrote history ---
setup
publish 0.2.0 "second"
git -C "$work/install" pull -q --ff-only 2>/dev/null
git -C "$work/pub" reset -q --hard HEAD~1
publish 0.2.1 "rewritten"
git -C "$work/pub" push -q --force origin main 2>/dev/null
before=$(head_of)
out=$(bash "$script" check "$(root)" 2>&1)
out=$(bash "$script" install "$(root)" "$(field TARGET)" 2>&1); code=$?
ok 'rewritten origin: install refuses' '[[ $code -ne 0 ]] && grep -Eq "fast-forward|not on origin" <<<"$out"'
ok 'rewritten origin: nothing changed' '[[ $(head_of) == "$before" && $(version) == 0.2.0 ]]'

# --- Tests fail on the fetched code ---
setup
release 0.2.0 "broken"
touch "$work/pub/boomi-dashboard/FAIL"
git -C "$work/pub" add -A && git -C "$work/pub" commit -q -m "boomi-dashboard 0.2.0: broken" && git -C "$work/pub" push -q origin main 2>/dev/null
before=$(head_of)
out=$(bash "$script" check "$(root)" 2>&1)
out=$(bash "$script" install "$(root)" "$(field TARGET)" 2>&1); code=$?
ok 'failing tests: install refuses' '[[ $code -ne 0 ]] && grep -q "^TESTS-FAILED" <<<"$out"'
ok 'failing tests: the failing output is printed' 'grep -q "1 fail" <<<"$out"'
ok 'failing tests: the current version stays' '[[ $(head_of) == "$before" && $(version) == 0.1.0 ]]'
ok 'failing tests: nothing is recorded' '[[ ! -e "$(git -C "$work/install" rev-parse --absolute-git-dir)/bc-dashboard-upgrade" ]]'
ok 'failing tests: the temporary worktree is gone' '[[ -z $(git -C "$work/install" worktree list | sed 1d) ]]'

# --- A target that moved since the check ---
setup
publish 0.2.0 "second"
out=$(bash "$script" check "$(root)" 2>&1)
stale=$(field TARGET)
publish 0.3.0 "third"
git -C "$work/install" fetch -q origin 2>/dev/null
out=$(bash "$script" install "$(root)" "$stale" 2>&1); code=$?
ok 'install refuses a target that is no longer the latest' '[[ $code -ne 0 ]] && grep -q "changed since" <<<"$out" && [[ $(version) == 0.1.0 ]]'

# --- Other mods from the same checkout ---
setup
publish 0.2.0 "second"
export CLAUDE_CODE_PLUGIN_DIRS="$work/install/boomi-dashboard:$work/install/boomi-runtime:/elsewhere/other-mod"
out=$(bash "$script" check "$(root)" 2>&1)
ok 'check names every loaded mod from this checkout, and only those' '[[ $(field MODS) == "boomi-dashboard boomi-runtime" ]]'
out=$(bash "$script" install "$(root)" "$(field TARGET)" 2>&1)
ok 'install tests each of them' 'grep -q "claude plugin test .*/boomi-runtime$" "$CLAUDE_LOG" && grep -q "claude plugin test .*/boomi-dashboard$" "$CLAUDE_LOG"'

# --- Offline ---
setup
git -C "$work/install" remote set-url origin "$work/nowhere.git"
before=$(head_of)
out=$(bash "$script" check "$(root)" 2>&1); code=$?
ok 'offline: check says it could not fetch, and changes nothing' '[[ $code -ne 0 ]] && grep -q "couldn.t fetch" <<<"$out" && [[ $(head_of) == "$before" ]]'

# --- No network beyond fetching origin ---
# (ssh appears once, as the transport git fetch uses, never prompting.)
ok 'the script calls no network tool but git fetch' '! grep -v "core.sshCommand" "$script" | grep -Eq "\b(curl|wget|nc|ssh) " && ! grep -Eq "(^|[^#].*)\bg(it)? [^|]*\b(push|pull|clone|ls-remote|remote add)\b" "$script"'

echo "1..$n"
exit $(( fails > 0 ))
