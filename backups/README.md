# backups/ —— 本地数据库备份

> 这个目录**不进版本库**（`.gitignore` 已忽略，只保留本文件作为说明）。

## 为什么需要它

项目自托管 PostgreSQL（见 `docs/deploy.md`）。对数据库做删除类操作（清理演示数据、
删除账号、重跑迁移）之前，应当先导出一份完整快照 —— 出错时才有退路。

## 现有备份

| 文件 | 内容 | 生成时间 |
|---|---|---|
| `gongke-before-cleanup.dump` | 清理演示作品与虚拟教程**之前**的 `gongke` 全库快照（custom format） | 2026-11-01 |

## 怎么恢复

```bash
# 1) 停后端（避免恢复过程中有连接在写）
# 2) 恢复（-c 会先清空目标库里的对象再导入）
PGPASSWORD=pgdev1234 /d/PostgreSQL/17/bin/pg_restore.exe \
  -h 127.0.0.1 -U postgres -d gongke -c backups/gongke-before-cleanup.dump
```

## 怎么新建一份

```bash
PGPASSWORD=pgdev1234 /d/PostgreSQL/17/bin/pg_dump.exe \
  -h 127.0.0.1 -U postgres -d gongke -Fc \
  -f backups/gongke-$(date +%Y%m%d-%H%M).dump
```

> ⚠️ 备份里有真实用户数据（手机号、密码哈希）。**不要提交、不要上传到任何公开位置**，
> 用完及时删除。`.gitignore` 已挡住这个目录，但 `git add -f` 仍能绕过 —— 别这么做。
