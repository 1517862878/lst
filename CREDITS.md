# 素材版权登记（CREDITS）

> 规则（ROADMAP §9.3）：仓库中每一张非自摄图片必须在此登记一行；来源不明的图片一律不得进入仓库。
> 字体等二进制素材同样须登记。

## 字体

| 文件 | 来源 | 作者/出处 | 许可 | 备注 |
| --- | --- | --- | --- | --- |
| `public/fonts/fusion-pixel-12px-zh_hans.woff2` | [TakWolf/fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font) v2026.10.25 | TakWolf | **OFL 1.1**（见 `public/fonts/OFL-fusion-pixel.txt`） | 中文像素字体，简体中文子集，685 KB；由 ark-pixel / cubic-11 / galmuri 等字体融合而来，各来源许可文本随包附带 |

> 说明：OFL 允许随软件分发与嵌入网页（`@font-face`），要求保留许可文本且不得单独售卖字体文件。
> 本项目为 MIT 开源代码 + OFL 字体，两者兼容。若将来替换字体，请同步更新本表与 `src/styles/tokens.css` 的 `@font-face`。

## 演示示例图片

当前演示版（第一期）未包含任何真实图片文件：作品缩略图由前端根据作品 ID
生成纯色占位块（`src/features/photos/PhotoThumb.tsx`），不含第三方素材。

| 文件 | 来源 | 作者/出处 | 许可 | 备注 |
| --- | --- | --- | --- | --- |
| （暂无） | — | — | — | 演示版全部为前端生成的占位色块 |

## 教程示例图片（S7 起）

| 文件 | 来源 | 作者/出处 | 许可 | 备注 |
| --- | --- | --- | --- | --- |
| （暂无） | — | — | — | 上线前所有教程配图必须为自摄或 CC0/Unsplash/Pexels，并逐行登记 |

## 第三方素材来源优先级（ROADMAP §9.3）

1. **自己拍摄**（最佳，保留 RAW 与拍摄记录）
2. Unsplash / Pexels（免费商用，须登记来源）
3. Wikimedia Commons（多为 CC BY-SA，须署名 + 同协议共享 + 链接许可原文）
4. CC0 图库（Openverse 筛选 CC0，可用，须登记）

**禁止**：搜索引擎图片、带水印图、电商图、社交媒体截图、来源不明的 AI 生成图。
