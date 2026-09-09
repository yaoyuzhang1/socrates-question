# 游戏排行榜与评论

游戏继续通过 GitHub Pages 发布。社区投稿使用这个仓库的公开 Issues，由玩家自己登录 GitHub、核对草稿并点击提交。浏览排行榜不需要登录。游戏不会代玩家发布内容，也不在浏览器保存 GitHub 令牌。

## 玩家体验

- 两关各自排名，同一 GitHub 账号每关只取仍公开的最高成绩。相同分数并列，名次采用 1、1、3；不以阅读速度决定名次。
- 每题首次答对计 100，重试后答对计 60，看提示后完成计 30，总分为各题平均分四舍五入。旧存档缺少完整答题记录时，仍可阅读结局、评论，需重新开始才能上传可比较的成绩。
- 这些是玩家自报成绩。检查记录格式和重新计算分数不能证明玩家确实按记录游玩，不用于正式考核。
- 提交显示名、评论和星级是自愿的；公开后会显示 GitHub 账号、填写内容和来源帖链接。评论为纯文本，不执行 HTML。
- 用户关闭自己的投稿，或管理员关闭投稿后，对应成绩和评论会在下次快照更新后撤回。如果该账号还有先前未关闭的成绩或评论，相应的最高成绩／最近评论会重新显示。GitHub 帖子本身仍遵循 GitHub 的保留规则。
- 榜单列出前 100 名及完整参加人数，每关显示每个账号最近一次仍公开的评论，最多 30 条。

## 维护

`.github/workflows/community.yml` 在投稿创建、编辑、关闭、重新打开、删除、标签变化和社区程序更新时运行。也可在 Actions 的 **Update game leaderboard** 页面手动运行。每次都读取当前公开 Issues，校验记录并重新生成 `community.json`。

首次发布无需提交预造的榜单文件。工作流发现 `community.json` 尚不存在时，会从真实投稿列表生成它；无人投稿时生成明确的空榜。这样可检验真实读取与写入权限，同时不创建测试玩家或测试评论。

工作流只拥有本仓库 `contents: write` 与 `issues: read`，不创建投稿、不向玩家发送机器人消息。它只从可信的 main 分支读取代码；用户帖子只作为 JSON 数据处理，不插入 shell 脚本或执行。

`sync.mjs --publish` 使用 Actions 自动提供的仓库令牌，通过 Contents API 更新固定文件 `community.json`。每次更新检查旧文件 SHA；遇到并发编辑，会重新读取投稿和旧文件再尝试。解析、联网或容量检查失败时保留上次有效快照，不发布部分榜单。无数据变化时不产生新提交。

机器人提交不会自动触发 GitHub Pages 的分支构建，因此客户端从以下固定地址读取最新快照，而不是依赖 Pages 构建：

[共享快照](https://raw.githubusercontent.com/yaoyuzhang1/socrates-question/main/community.json)

GitHub Actions 排队和 CDN 缓存可能使更新延迟。客户端应显示数据更新时间、加载失败和手动刷新，不能把失败伪装成空榜。关闭或撤回也需要等待同一更新过程完成。

## 评论管理

在来源 Issue 中处理内容。关闭帖子可撤回；需要暂时保留讨论但隐藏榜单／评论，可给帖子添加 `community-hidden` 标签。重新打开或移除该标签将使有效记录再次进入下次快照。无需另外设置公开管理接口。

## 本地验证

```sh
node --test community/community.test.mjs
node community/sync.mjs
```

第二条命令只读取公开 Issues 并写本地 `community.json`，不会发布或创建帖子。真实提交成功、浏览器跨域读取和工作流发布仍需结合在线验收；测试文件中的数据不写入公开榜单。

## 已核对的官方文档

- [通过 URL 预填 Issue，权限和 URL 长度限制](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)
- [GitHub REST API 的跨域读取](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)
- [未认证 API 请求速率限制](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Issues 工作流触发事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [防止脚本注入](https://docs.github.com/en/actions/concepts/security/script-injections)
- [GITHUB_TOKEN 提交不触发 Pages 构建](https://docs.github.com/en/actions/concepts/security/github_token)

工作流固定使用官方 action 的完整提交 SHA。2026-09-09 通过官方仓库 tags API 核对：

- [actions/checkout v6](https://github.com/actions/checkout/commit/d23441a48e516b6c34aea4fa41551a30e30af803)
- [actions/setup-node v6](https://github.com/actions/setup-node/commit/249970729cb0ef3589644e2896645e5dc5ba9c38)
