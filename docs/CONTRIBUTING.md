# 贡献指南（CONTRIBUTING）

感谢你对工科影展的关注！本项目单人起步，欢迎任何形式的贡献。

## 如何贡献

1. **报告 Bug**：提交 Issue，附上复现步骤、环境（浏览器/系统）、截图。
2. **功能建议**：提交 Issue 描述需求与使用场景；重大功能先看 [ROADMAP.md](ROADMAP.md) 是否已计划。
3. **提交代码**：Fork 仓库 → 新建分支 → 修改 → PR。

## 提交 PR 前

```bash
pnpm lint        # 0 error 0 warning
pnpm test        # 全部通过
pnpm build       # 构建成功
```

## 代码约定

- TypeScript `strict` 模式；禁 `any`（用 `unknown` + zod）
- 组件不得直接引用 `data/mock` 或 `data/supabase`（走 hooks）
- 实体类型只在 `src/domain/types.ts` 定义
- 新增依赖须说明「为什么不能自己写 20 行」

## 教程内容投稿

暂不开放外部教程投稿（见 ROADMAP 附录 A Q-7）；如你有高质量教程想分享，请先开 Issue 讨论。

## 行为准则

友善、尊重、建设性。详见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)（如仓库未含此文件，参照 Contributor Covenant 2.1）。
