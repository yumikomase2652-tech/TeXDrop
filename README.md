# TeXdrop MVP

ブラウザへ貼り付けた1ファイルのLaTeXをLuaLaTeXでPDFに変換するWebアプリです。フロントはNext.js、コンパイルAPIは独立したDockerサービスです。ログイン、DB、ファイル保存はありません。

## 構成

- `app/`: VercelへデプロイするNext.js UI
- `app/api/compile`: ブラウザとCompiler APIの間のサーバー側プロキシ
- `app/api/health`: WebとCompiler APIをまとめて確認するヘルスチェック
- `services/compiler-api/`: Compiler API本体
- `services/compiler-api/Dockerfile`: Render向けのNode.js + TeX Liveイメージ
- `services/compiler-api/Dockerfile.texlive`: ローカルのリクエスト単位Docker実行に使うTeXイメージ

ローカルではCompiler APIがリクエストごとに隔離Dockerコンテナを起動します。本番ではRenderのDockerコンテナ自体を境界にし、非rootユーザーで`latexmk`を実行します。

## ローカル起動（従来方式）

必要なものはNode.js 20.9以上と、起動済みのDocker Desktopです。

```bash
npm install
npm run tex-image
```

ターミナルを2つ開きます。

```bash
npm run dev:api
```

```bash
npm run dev
```

`COMPILE_API_URL`が未設定の場合、Next.jsは`http://127.0.0.1:4000/compile`を使います。<http://localhost:3000> を開いてください。

スタック全体をDocker Composeで起動することもできます。この場合、Compiler APIは本番と同じコンテナ内実行方式です。

```bash
docker compose up --build
```

## Compiler APIをRenderへデプロイ（最短）

このリポジトリをGitHubへpushしたうえで、次のどちらかを使います。

### Blueprintを使う方法

1. Render Dashboardで **New > Blueprint** を選ぶ
2. このGitHubリポジトリを接続する
3. ルートの`render.yaml`を選択して適用する
4. `ALLOWED_ORIGINS`にVercelの公開Originを設定する
   - 例: `https://texdrop.example.vercel.app`
   - 複数指定: カンマ区切り
5. デプロイ完了後、表示された`onrender.com` URLを控える

### Web Serviceを手動作成する方法

| 設定 | 値 |
|---|---|
| Runtime | Docker |
| Dockerfile Path | `services/compiler-api/Dockerfile` |
| Docker Build Context | `.`（リポジトリルート） |
| Health Check Path | `/health` |
| `COMPILER_RUNTIME` | `native` |
| `HOST` | `0.0.0.0` |
| `MAX_CONCURRENT` | `2` |
| `ALLOWED_ORIGINS` | VercelのOrigin |

`PORT`はRenderが注入します。Start CommandはDockerfileの`CMD ["node", "server.mjs"]`を使うため、Render側では空欄にします。

確認:

```bash
curl https://YOUR-COMPILER.onrender.com/health
```

`{"ok":true,"service":"texdrop-compiler",...}`が返れば準備完了です。

## Compiler APIをFly.ioへデプロイ（egress制御向け）

外部通信をプラットフォーム側でも制限したい場合はFly.ioを使います。Fly Network PolicyはFly Proxy経由の受信には影響せず、Machineからのegressを制御できます。

1. `fly.toml`の`app`を世界で一意の名前へ変更する
2. Fly CLIでログインし、アプリを作成する

```bash
fly auth login
fly apps create YOUR-UNIQUE-APP-NAME
fly secrets set ALLOWED_ORIGINS=https://YOUR-APP.vercel.app
fly deploy
```

3. `<https://fly.io/docs/machines/guides-examples/network-policies/>`の公式手順に従い、対象アプリのegressをdefault-denyにするNetwork Policyを作成する
4. Policy適用後にMachineを再起動または再デプロイする
5. `https://YOUR-UNIQUE-APP-NAME.fly.dev/health`を確認する

Network Policyは「egressルールを1つ定義すると、それ以外がdeny」になる方式です。許可する宛先がない構成では、Fly APIの最新スキーマを確認してallowルールを空にするか、運用上必要な通信だけを明示的に許可してください。

## Next.jsをVercelへデプロイ

1. Vercelで **Add New > Project** から同じGitHubリポジトリをImportする
2. Framework Presetは **Next.js**、Root Directoryはリポジトリルートのままにする
3. Production / Previewの環境変数を追加する

| 環境変数 | 例 |
|---|---|
| `COMPILE_API_URL` | `https://YOUR-COMPILER.onrender.com/compile` |

4. Deployを実行する
5. Vercelの公開URLが決まったら、Renderの`ALLOWED_ORIGINS`をそのOriginに更新して再デプロイする
6. `https://YOUR-APP.vercel.app/api/health`へアクセスし、WebとCompilerの両方が`ok: true`になることを確認する

ブラウザは同一Originの`/api/compile`を呼び、Vercel Functionが外部Compiler APIへ転送します。`COMPILE_API_URL`はサーバー側変数なのでブラウザへ公開されません。

## 本番用環境変数

### Vercel

- `COMPILE_API_URL`: Compiler APIの完全な`/compile` URL

### Compiler API

- `PORT`: 待受ポート。ローカル既定値は`4000`
- `HOST`: ローカル既定値は`127.0.0.1`、Renderでは`0.0.0.0`
- `COMPILER_RUNTIME`: ローカルは`docker`、Renderは`native`
- `MAX_CONCURRENT`: 1インスタンスあたりの同時コンパイル数。既定値`2`
- `ALLOWED_ORIGINS`: CORSで許可するOriginのカンマ区切り一覧
- `TEX_IMAGE`: `docker`方式で使うローカルTeXイメージ名
- `WORK_ROOT`: 作業領域の親ディレクトリ。未設定時はOSの一時ディレクトリ

## セキュリティと制限

- ローカルDocker方式: リクエストごとにネットワークなし、read-only root、非root、CPU・メモリ・PID制限付きコンテナを作成
- Render方式: TeX Live入りDockerコンテナを非rootで実行し、コンパイルは固定引数のみ
- 両方式: shell-escape禁止、45秒タイムアウト、同時実行数制限
- 作業ディレクトリとTeX/font cacheはリクエストごとに作成し、成功・失敗にかかわらず削除
- 本番イメージはフォントDBの雛形をビルド時に生成し、各リクエストの一時キャッシュへコピーすることで無料枠の初回メモリ負荷を抑制
- クラウド保存、DB、ログインなし

Render方式ではAPIコンテナはHTTPを受けるためネットワークを持ちますが、TeXから外部コマンドを実行できないよう`-no-shell-escape`を強制します。LuaTeXの`--safer`は`luaotfload`と両立せず、日本語コンパイルを停止させるため使用しません。OSレベルのegress制御が必要な本番ではFly Network Policy、または専用VM上のリクエスト単位Docker方式を選んでください。

## 最小疎通用LaTeX

```tex
\documentclass[a4paper,11pt]{bxjsarticle}
\usepackage{amsmath}
\begin{document}
こんにちは。$E=mc^2$。
\end{document}
```

`bxjsarticle`でエンジンと日本語モードが省略された場合、APIはLuaLaTeX向けに`lualatex,ja=standard`を補完します。

## 注意点

- Vercel Functionsのrequest/response payload上限は4.5 MBです。PDFはJSON内でBase64化されるため、公開MVPでは実質的に約3 MB前後が目安です。
- Renderの無料インスタンスを使う場合、スリープ解除後の最初のコンパイルは遅くなることがあります。
- まずは1ファイルの`.tex`貼り付けだけに対応しています。
