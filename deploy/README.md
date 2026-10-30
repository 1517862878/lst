# 云主机部署手册（上云 = 第 8.1 项）

> 面向：第一次把这台机器上的项目搬到一台公网 Linux 云主机的人。
> 目标：一个域名下同时提供前端静态页、`/api` 接口和 `/images` 图片，全程 HTTPS。
> 本地 Windows 开发环境继续看 `项目交接说明.md`；这份只管云主机。

---

## 0. 先确认三件外部条件（代码解决不了的）

| # | 条件 | 说明 |
|---|---|---|
| 1 | **云主机** | 2 vCPU / 4 GB / 40 GB 起；Ubuntu 22.04 或 24.04 LTS。记下公网 IP 与 SSH 账号 |
| 2 | **域名** | 一条 A 记录指向公网 IP。Caddy 会自动申请 Let's Encrypt 证书，**前提是 80/443 已放通且域名已解析** |
| 3 | **ICP 备案** | 主机在中国大陆则 **必须**（1–3 周，工信部要求），否则 80/443 会被阻断。用香港/海外主机可跳过，但访问速度下降 |

还需要（都可后补，但缺了对应功能会直接拒绝启动或不可用，见 `server/src/lib/config.ts`）：

| 变量 | 缺失后果 |
|---|---|
| `IP_HASH_SECRET` ≥32 字符 | **生产直接启动失败**（`openssl rand -base64 48`） |
| `TRUSTED_ORIGINS` | **生产直接启动失败** |
| `SMS_PROVIDER=aliyun` + 阿里云四个值 | **生产直接启动失败**；不配就没人能注册 |
| `TURNSTILE_SECRET` + 构建期 `VITE_TURNSTILE_SITE_KEY` | 生产默认启用 Turnstile，缺 secret 启动失败；缺 site key 则注册/登录拿不到人机验证 token |
| 强密码替换 `pgdev1234` / `appdev1234` | 可启动，但等于把数据库交给全网 |

> 落地顺序建议：**先备案**（最慢）→ 同时把云主机、域名、短信、Turnstile 都申请好 → 再按下面步骤执行。整机部署本身只要约 20 分钟。

---

## 1. 装系统依赖

```bash
sudo apt update && sudo apt install -y curl git build-essential postgresql-17 postgresql-client-17

# Node 22（项目 engines 要求 >=20.19）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm

# Caddy（官方 apt 源，自带 systemd 单元与自动 HTTPS）
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 2. 建服务账号与目录

```bash
sudo useradd --system --create-home --home-dir /srv/gongke --shell /bin/bash gongke
sudo mkdir -p /srv/gongke /srv/gongke/images /srv/gongke/backups /etc/gongke /var/log/caddy
sudo chown -R gongke:gongke /srv/gongke
sudo chmod 750 /etc/gongke
```

把代码放上去（二选一）：

```bash
# A. 从 GitHub 拉（需要仓库访问权）
sudo -u gongke git clone https://github.com/1517862878/lst.git /srv/gongke
# B. 从本地 rsync（不经过 GitHub）
rsync -av --delete --exclude node_modules --exclude .git --exclude dist \
  "E:/项目一 网站开发/" root@<公网IP>:/srv/gongke/
```

## 3. 建库与角色

```bash
sudo -u postgres psql <<'SQL'
alter user postgres with password '换成强密码';
create database gongke encoding 'UTF8' template template0;
SQL
```

**顺序很重要**：先建应用角色、再跑迁移。迁移链里的每一个文件都假设 `app_user` 已存在
（函数上要 `grant execute ... to app_user`），仓库里没有任何一个迁移会创建它——顺序反了
第一个迁移文件就会失败。`app_user` 必须是**非超级用户**——超级用户会完全绕过 RLS。

```bash
cd /srv/gongke
# 3.1 建应用角色。必须带 -v app_password='<口令>'：缺了这个变量脚本会直接报错
#     「必须通过 -v app_password=<口令> 传入 app_user 的口令」。
#     注意：app_user 是集群级共享角色——如果这台 PostgreSQL 上已经跑着服务，
#     必须沿用现有口令（否则旧服务全部 28P01 连不上）。
sudo -u postgres psql -d gongke -v app_password='app_user强密码' -f supabase/create-app-role.sql

# 3.2 迁移（幂等，可重复执行；每个文件一个事务，失败即回滚该文件并停止）
PGPASSWORD='postgres强密码' node scripts/apply-migrations.mjs

# 3.3 结构自检（这个脚本自带期望值，会核对表/触发器/RLS 策略数量）
PGPASSWORD='postgres强密码' psql -h 127.0.0.1 -U postgres -d gongke -f supabase/verify-schema.sql
```

> ⚠️ `grant-app-role.sql` 是早期「一把梭」授权脚本，**不要**用它引导新集群——它的授权面
> 与 create-app-role.sql + 各迁移里的逐函数 grant 不一致，重复执行会覆盖权限面，
> 迁移照跑、运行时行为不一致。
>
> 迁移必须用**和开发机同一批文件**。`supabase/migrations/` 里的文件是按文件名排序执行的，
> `00000000000000_` 那个兼容层必须最先跑，`apply-migrations.mjs` 已经替你排好序。

## 4. 写服务配置

```bash
sudo cp deploy/api-env-example.txt /etc/gongke/api.env
sudo chmod 600 /etc/gongke/api.env
sudo editor /etc/gongke/api.env       # 按文件内注释逐项填
# 最少要改：PGPASSWORD、IP_HASH_SECRET、TRUSTED_ORIGINS、IMAGE_ROOT、阿里云四个值、TURNSTILE_SECRET
```

`IP_HASH_SECRET` 生成：

```bash
openssl rand -base64 48 | tr -d '\n'
```

## 5. 装 systemd 服务

```bash
sudo cp deploy/gongke-api.service /etc/systemd/system/gongke-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now gongke-api
systemctl status gongke-api --no-pager
curl -s http://127.0.0.1:3001/api/health      # 必须看到 "isSuperuser":false
```

`isSuperuser` 若是 `true`，说明 `PGUSER` 配成了 `postgres`，**RLS 全部失效**，立刻改回 `app_user`。

## 6. 配 Caddy（自动 HTTPS）

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo editor /etc/caddy/Caddyfile     # 把默认的 example.com 换成真实域名（或用 DOMAIN 环境变量）
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

若用了 Turnstile，注意 Caddyfile 里 `script-src` 需要放行 `https://challenges.cloudflare.com`
（文件内已留注释）。域名未解析或 80/443 未放通时，证书申请会失败，`journalctl -u caddy -n 50` 能看到原因。

## 7. 首次部署与验收

```bash
cd /srv/gongke
sudo -u gongke env PGPASSWORD='postgres强密码' DOMAIN=你的域名 \
  VITE_TURNSTILE_SITE_KEY=你的sitekey bash deploy/deploy.sh
```

`deploy.sh` 会依次做：装依赖 → 构建前端（`VITE_DATA_SOURCE=api` + 同源 + 根路径）→ 构建后端 →
跑迁移 → 重启 API → 冒烟检查本地 health 与公网首页。

**人工验收清单**（脚本查不到的部分）：

1. 浏览器打开 `https://域名/`，地址栏是锁；`/gallery` 显示的是**数据库里的真实作品**（不是 mock 的示例数据）。
2. 注册一个账号：能收到短信验证码、Turnstile 通过、注册后自动登录。
3. 登录后发布一件作品（传图），图片能在 `/images/...` 打开。
4. `https://域名/api/health` 返回 200，且 `isSuperuser: false`。
5. 退出登录后 `https://域名/api/me/profile` 返回 401（不是 200）。
6. 从公网 `curl -I https://域名/` 能看到 `strict-transport-security`。

## 8. 备份

```bash
sudo -u postgres bash /srv/gongke/deploy/backup.sh    # 先手工验证一次
sudo crontab -u postgres -e
# 加一行：
# 30 3 * * * /usr/bin/env bash /srv/gongke/deploy/backup.sh >> /var/log/gongke-backup.log 2>&1
```

只在本机留备份的机器，磁盘坏了备份和数据一起没了。上生产前请至少接一个异地目标
（`deploy/backup.sh` 末尾有 rclone 到阿里云 OSS 的示例）。

## 9. 日常更新

```bash
cd /srv/gongke && sudo -u gongke git pull
sudo -u gongke env PGPASSWORD='postgres强密码' DOMAIN=你的域名 \
  VITE_TURNSTILE_SITE_KEY=你的sitekey bash deploy/deploy.sh
```

回滚：`sudo -u gongke git checkout <上一个提交> && bash deploy/deploy.sh`。
数据库迁移是**只往前**的（幂等、不删数据），回滚代码不会自动回滚 schema。

---

## 与 GitHub Pages 演示站的关系

GitHub Pages 上的 <https://1517862878.github.io/lst/> 是**纯静态 mock 演示**（数据只存在浏览器里，
没有真后端、也没有真的登录注册）。自建服务器上线后它会继续存在，两者互不影响：

| | GitHub Pages | 自建服务器 |
|---|---|---|
| 数据源 | `VITE_DATA_SOURCE=mock`（默认） | `VITE_DATA_SOURCE=api` |
| 接口地址 | 无（走内存 mock） | 同源 `/api` |
| 构建方式 | `.github/workflows/deploy.yml`（自动） | `deploy/deploy.sh`（手动/脚本） |
| 登录注册 | 仅界面演示 | 真实可用 |

## 常见故障

| 现象 | 原因与处理 |
|---|---|
| 服务起不来，日志说「生产环境必须设置 IP_HASH_SECRET」 | `api.env` 没被读到：确认 `EnvironmentFile` 路径、权限 600、无多余引号 |
| `isSuperuser: true` | `PGUSER` 写成了 `postgres`，改回 `app_user` 并重建服务 |
| 公网 502 | Caddy 起来了但 API 挂了：`systemctl status gongke-api` + `journalctl -u gongke-api -n 80` |
| 证书申请失败 | 域名未解析、80/443 未放通（云厂商安全组也要开）、或大陆主机未备案 |
| 登录后立刻掉线 | `TRUSTED_ORIGINS` 与访问域名不一致；或没走 HTTPS（`__Host-` Cookie 要求 Secure） |
| 限流把所有人当成一个人 | 少了 `TRUST_PROXY=1`，Caddy 后面拿到的都是 127.0.0.1 |
| 迁移报「函数已存在」 | 用了 `create function` 而不是 `create or replace`。迁移必须可重放 |
