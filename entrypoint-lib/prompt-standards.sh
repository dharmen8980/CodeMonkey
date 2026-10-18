# Fixed tool policy and prompt fragments shared across every task type and phase.
# Sourced by /entrypoint.sh before any prompt is built.

# Allowed tools — no merge, no force push, no destructive git ops
# Support scoped .NET and Node validation commands for ordinary tasks. The
# acceptance pipeline's final evidence gate remains .NET/TRX specific.
# File-manipulation coreutils (touch/cp/tee/dd/install/echo/mkdir/mv/chmod) are
# allowed alongside cat: the model habitually reaches for these instead of
# Write/Edit for file creation, and the scope guard (assertTestsOnly/
# assertNoTestFiles) checks the resulting git diff, not which tool produced it —
# so there's no safety property lost by letting them through instead of
# stalling on an approval gate no one is watching in an unattended container.
ALLOWED_TOOLS="Bash(git commit*),Bash(git push*),Bash(git checkout*),Bash(git branch*),Bash(git add*),Bash(git mv*),Bash(git rm*),Bash(git diff*),Bash(git log*),Bash(git status*),Bash(glab mr create*),Bash(glab mr note*),Bash(glab mr view*),Read,Write,Edit,Grep,Glob,Bash(find*),Bash(grep*),Bash(ls*),Bash(cat*),Bash(touch*),Bash(cp*),Bash(tee*),Bash(dd*),Bash(install*),Bash(echo*),Bash(mkdir*),Bash(mv*),Bash(chmod*),Bash(dotnet build*),Bash(dotnet format*),Bash(dotnet test*),Bash(npm ci*),Bash(npm test*),Bash(npm run build*),Bash(npm run lint*),Bash(npm run check*)"

# Task/Agent (sub-agent spawning) is NOT gated by --allowedTools — it's available
# regardless of what's in that list, verified empirically. Block it explicitly:
# no visibility into a container spawning its own nested containers, and it's
# what turned the 2026-08-20 timeout incident into total wasted work (first
# sub-agent stalled after one progress ping; the parent spawned a duplicate
# instead of waiting, which then redid all the discovery from scratch).
DISALLOWED_TOOLS="Task,Agent"
