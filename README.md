# HelloWorld

いろいろなプログラミング言語で「Hello World」を出力する練習ができる Web アプリです。
本物そっくりの **擬似ターミナル** と **擬似エディタ (VS Code 風)** を使って、

1. ターミナルでファイルを作る (`touch hello.py` など)
2. エディタで Hello World のコードを書く
3. ターミナルでコンパイル・実行する

という流れを体験できます。正しく出力できると画面いっぱいに赤い○が表示されます。

対応言語: Python / Java / C

## 構成

- `index.html` / `css/` / `js/` … ビルド不要の静的サイト
- `js/languages.js` … 擬似 Python インタプリタ・javac/java・gcc (それっぽいエラーメッセージ付き)
- `js/app.js` … ターミナル・エディタ・画面遷移
- `version.js` … デプロイ時に GitHub Actions がバージョンとデプロイ時刻を書き込みます (画面右下に表示)

## デプロイ

`.github/workflows/deploy.yml` により、デフォルトブランチに push するたびに GitHub Pages へ自動デプロイされます。

初回のみ、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にしてください。

## ローカルで確認

`index.html` をブラウザで開くだけで動きます。

言語アイコン: Python / Java は [devicon](https://github.com/devicons/devicon) (MIT, `icons/lang/LICENSE-devicon.txt`)。各ロゴの商標は各権利者に帰属します。
