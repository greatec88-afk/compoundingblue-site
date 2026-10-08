# Compounding Blue — 网站（Astro）

美股 / 组合策略内容站 `compoundingblue.com` 的前端项目。
品牌：深色 + 钢蓝；内容走 Markdown；部署在 Cloudflare Pages。

---

## 一、本地运行

需要 **Node 18+**（建议 20）。

```bash
npm install        # 安装依赖
npm run dev        # 本地开发，默认 http://localhost:4321
npm run build      # 生产构建，输出到 dist/
npm run preview    # 本地预览构建结果
```

---

## 二、目录说明

```
src/
  content/
    config.ts            文章字段定义（frontmatter schema）
    posts/               文章 Markdown —— 新增文章就加在这里
      four-pillars.md        示例：四支柱框架（首篇）
      portfolio-teardown.md  示例：组合拆解
  layouts/
    BaseLayout.astro     全站骨架：head / 字体 / 页眉页脚 / SEO
  components/
    Header.astro / Footer.astro
  pages/
    index.astro          首页（hero + 文章列表）
    about.astro          关于页（简介 + 社交链接，兼 Linktree）
    posts/[...slug].astro 文章页模板（自动挂免责声明 + 关注 CTA）
  styles/
    global.css           品牌 tokens（颜色 / 字体）与全局样式
public/
  favicon.svg  robots.txt
astro.config.mjs         站点域名与 sitemap 配置
```

---

## 三、怎么发一篇新文章

在 `src/content/posts/` 下新建一个 `.md` 文件，顶部写好 frontmatter：

```markdown
---
title: 文章标题
description: 一句话摘要（用于列表与 SEO）
pubDate: 2026-10-10
author: Compounding Blue
pillar: 估值纪律          # 栏目 / 支柱，可留空
tags: [美股, 估值]
draft: false             # true = 不发布（人工闸门）
---

正文用 Markdown 书写。免责声明由文章模板自动添加，无需在正文里写。
```

- 文件名即网址 slug：`valuation.md` → `/posts/valuation/`。
- `draft: true` 的文章不会出现在站点上——这正是 **AI Agent 起草 → 你审核** 的开关：
  Agent 先以 `draft: true` 提交 PR，你看过没问题，改成 `false` 合并即发布。

---

## 四、部署到 Cloudflare Pages

1. 把本项目推到你的 GitHub 仓库。
2. Cloudflare 控制台 → **Workers & Pages → Create → Pages → 连接 Git** → 选这个仓库。
3. 构建设置：
   - **Framework preset**：Astro
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - **环境变量**：`NODE_VERSION` = `20`
4. 首次部署成功后，在 **Custom domains** 绑定 `compoundingblue.com`（和第二个域名），
   Cloudflare 会自动签发 HTTPS 证书。
5. 以后每次 `git push`，Pages 自动重新构建发布。

> 发布域名改了的话，记得同步改 `astro.config.mjs` 里的 `site` 和 `public/robots.txt` 里的 sitemap 地址。

---

## 五、下一步（对应架构文档的阶段二）

本项目是 MVP（静态站 + 半手动内容）。进入阶段二时，在此基础上加：

- `functions/`（Cloudflare Pages Functions）或独立 Worker + Cron：Agent 拉数据 → 调 Claude 起草 → 生成配图 → 用 GitHub API 开 `draft: true` 的 PR。
- D1 / R2 / KV：选题库、发布日志、配图存储。
- 所有 API key 放 **Cloudflare 环境变量 / Secrets**，绝不进仓库（`.env` 已在 `.gitignore`）。

详见《compoundingblue 全云架构设计文档》。
