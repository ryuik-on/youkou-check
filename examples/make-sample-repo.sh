#!/bin/sh
# デモ用に、わざと不備を入れた見本の提出リポジトリを作る。
# 使い方：sh examples/make-sample-repo.sh /tmp/sample-submission
#
# 入れてある不備（やんばる学生ハッカソン 2026 の要項に対して）
#   - 開発期間（11/1 10:00〜）より前のコミットがある
#   - API キーを一度コミットし、あとで消している（履歴には残る）
#   - LICENSE が無い
#   - README に動かし方が無い
#   - 生成 AI を使ったのに README に書いていない
set -eu
dir=${1:?作る場所を指定してください}
rm -rf "$dir"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "見本 太郎"
git config user.email "sample@example.com"

commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -qm "$2"; }

cat > bus.js <<'EOF'
// バスの時刻表を読む（ハッカソンの前に書いた試作）
export function nextBus(times, now) {
  return times.find((t) => t > now);
}
EOF
git add bus.js
commit "2026-10-28T21:00:00+09:00" "試作：次のバスを探す"

cat > README.md <<'EOF'
# やんばるバスナビ

やんばる地域のバスの、次の便が分かるアプリです。
バスの本数が少ない地域で、待ち時間を短くするために作りました。
EOF
git add README.md
commit "2026-11-01T10:30:00+09:00" "README を書く"

printf 'ANTHROPIC_API_KEY=sk-ant-api03-%s\n' "ThisIsAFakeKeyForTheDemoOnly0000000000000000" > .env
cat > app.js <<'EOF'
import { nextBus } from "./bus.js";
// 時刻表の説明文は Claude に書いてもらった
console.log(nextBus(["08:10", "12:40", "17:05"], "09:00"));
EOF
git add .env app.js
commit "2026-11-02T14:00:00+09:00" "アプリの入口を作る"

git rm -q --cached .env
rm .env
commit "2026-11-02T14:05:00+09:00" "鍵を消す"

echo "見本のリポジトリを作りました：$dir"
