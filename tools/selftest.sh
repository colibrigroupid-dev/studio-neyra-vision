#!/bin/sh
# Самопроверка инструментов Claude-зоны одной командой (для перекрёстной проверки Codex): sh tools/selftest.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
echo "1. generator selftest"; python3 tools/generator.py selftest
echo "2. razbivka на фикстуре"; cat > "$T/f.fountain" <<'F'
Title: ПРОБА

ИНТ. ЮРТА — НОЧЬ

Темно. У очага сидит АЙГУЛЬ (40), перебирает золу.

АЙГУЛЬ
Снег лёг на снег.

НАТ. СТЕПЬ — РАССВЕТ

АЙГУЛЬ идёт к горизонту. Ветер.
F
python3 tools/razbivka.py "$T/f.fountain" --out "$T/r" >/dev/null && python3 - "$T/r/razbivka.json" <<'PY'
import json,sys; d=json.load(open(sys.argv[1])); assert len(d["scenes"])==2 and d["characters"][0]["name"]=="АЙГУЛЬ" and d["characters"][0]["age"]==40, d; print("   сцен 2, героев 1 — ок")
PY
echo "3. kanon + raskadrovka (сухой прогон) на временном проекте"; P="$HOME/Documents/CODE/KINO-STANCIYA/PROEKTY/_selftest"; rm -rf "$P"; mkdir -p "$P/03-vizual/geroi/aygul" "$P/03-vizual/lokacii/yurta"
printf '{"slug":"_selftest","nazvanie":"Проба","tip":"Анимационный фильм","kod_komandy":"PROBA"}' > "$P/stranica.json"; printf '# Проба\n' > "$P/PROEKT.md"
printf -- '---\nimya: Айгуль\nrol: главная\n---\n# Айгуль\n\n**Промпт (черновик):**\n`A Kazakh woman, grey braid, felt coat. Yurt at night.`\n' > "$P/03-vizual/geroi/aygul/KARTOCHKA.md"
printf -- '---\nimya: Юрта\ntip: ИНТ\n---\n# Юрта\n\n**Промпт (черновик):** `Inside a felt yurt: hearth, shadows on the felt wall.`\n' > "$P/03-vizual/lokacii/yurta/KARTOCHKA.md"
python3 tools/kanon.py init _selftest >/dev/null && python3 tools/raskadrovka.py _selftest "$T/f.fountain" --sceny 1,2 | tail -1
python3 tools/kanon.py vernut _selftest 01-01 "слишком темно" --en "keep the hearth light on the face" --kto "тест" >/dev/null
python3 tools/raskadrovka.py _selftest "$T/f.fountain" --sceny 1 >/dev/null && grep -q "Director notes" "$P/03-vizual/raskadrovka/kadry/01-02.md" && echo "   правило из замечания попало в промпт — ок"
python3 tools/kanon.py reestr _selftest | tail -1
echo "4. export"; python3 tools/export-project.py _selftest --out "$T/e.zip" | tail -1
rm -rf "$P"
echo "selftest ok"
