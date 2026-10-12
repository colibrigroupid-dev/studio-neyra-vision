#!/bin/sh
# Вызов партнёра-агента без диалога, из корня репозитория.
#   tools/partner.sh codex  "текст задания"          — Codex читает репо, пишет только в proverki/ (sandbox workspace-write)
#   tools/partner.sh codex-ro "вопрос"               — Codex только читает (sandbox read-only)
#   tools/partner.sh claude "текст задания"          — Claude Code без диалога (claude -p)
#   tools/partner.sh proverka NN codex|claude        — проверка задачи NN по PROVERKA.md, результат в proverki/NN-<кто>.md
# Ключи и логины берутся из приложений ChatGPT (Codex) и Claude на этом маке. Платные генерации не запускать.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
[ -x "$CODEX" ] || CODEX="$(command -v codex || true)"
cd "$ROOT"
exec < /dev/null   # иначе codex exec ждёт stdin и висит при запуске в фоне
who="$1"; shift || true
case "$who" in
  codex)
    "$CODEX" exec --sandbox workspace-write --skip-git-repo-check -C "$ROOT" "Прочитай AGENTS.md. $*" ;;
  codex-ro)
    "$CODEX" exec --sandbox read-only --skip-git-repo-check -C "$ROOT" "Прочитай AGENTS.md. $*" ;;
  claude)
    claude -p --permission-mode acceptEdits "Прочитай AGENTS.md. $*" ;;
  proverka)
    NN="$1"; by="$2"
    [ -n "$NN" ] && [ -n "$by" ] || { echo "usage: tools/partner.sh proverka NN codex|claude"; exit 2; }
    task="$(grep -E "^\| $NN " ZADACHI.md | head -1)"
    prompt="Ты — проверяющий партнёр. Задача с доски ZADACHI.md: $task
Проверь её строго по PROVERKA.md: открой файлы задачи, прочитай код и тексты, при возможности запусти локально. Ничего в зоне владельца не правь. Запиши результат в proverki/$NN-$by.md по форме: Что проверял · Чем · Находки (файл и строка) · Вердикт «принять» или «доработать». Пиши по-русски, коротко, без лести. Платные генерации не запускать."
    if [ "$by" = "codex" ]; then
      "$CODEX" exec --sandbox workspace-write --skip-git-repo-check -C "$ROOT" "$prompt"
    else
      claude -p --permission-mode acceptEdits "$prompt"
    fi ;;
  *) echo "usage: tools/partner.sh codex|codex-ro|claude \"задание\"  |  tools/partner.sh proverka NN codex|claude"; exit 2 ;;
esac
