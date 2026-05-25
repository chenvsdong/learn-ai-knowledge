# AI Agent Web Book

这是《AI Agent 开发：从大模型原理到工程化落地》的内容驱动静态站点。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建前会自动执行 `scripts/build-content.mjs`，读取：

- `content/book.json`
- `content/chapters/*.md`

然后生成前端可渲染的数据文件。后续新增章节时，只需要维护 Markdown 内容和目录元数据，不需要改前端代码。

## 新增章节

推荐流程：

1. 在 `content/book.json` 中新增章节条目，填写 `id`、`title`、`source`、`summary` 等信息。
2. 在 `content/chapters/` 下新增对应 Markdown 文件。
3. 执行 `npm run build` 检查是否能正常生成页面。

如果只新增了 Markdown 文件但还没写入 `content/book.json`，构建脚本也会把它放到“自动发现的章节”分组中，方便先写内容再整理目录。

## GitHub Pages 部署

仓库已经包含 `.github/workflows/deploy.yml`。推送到 `main` 分支后，GitHub Actions 会：

1. 安装 Node 依赖。
2. 生成内容数据。
3. 构建静态页面。
4. 发布到 GitHub Pages。

首次使用时，需要在 GitHub 仓库设置里打开 Pages，并将 Source 选择为 GitHub Actions。
