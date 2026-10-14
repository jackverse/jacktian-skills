---
name: credentials-manager
description: 集中管理个人 skill 中心里所有 API 密钥/接口链接的生命周期。当用户提到添加/更新/查看 API key、token、密钥,或任何 API 调用报 401/403/key 无效/额度用尽/链接过期,或问"某个接口还能不能用""key 是不是过期了"时使用;其他 skill 调用外部 API 鉴权失败时也应联动本 skill 做失效标记。
---

# 密钥管理(credentials-manager)

管理仓库 `D:\code\0X-SKILLS` 中所有 API 密钥的生命周期:登记 → 临期提醒 → 失效标记 → 废弃/重新启用。

## 核心文件

- 登记表:`D:\code\0X-SKILLS\credentials\registry.md`(只存元数据,提交到 git)
- 密钥值:只存在于环境变量或 `D:\code\0X-SKILLS\credentials\.env.local`(已 gitignore)

## 安全红线

- 密钥值绝不写入任何会提交到 git 的文件,也绝不在回复中明文展示;引用一律用环境变量名(如 `$GEMINI_API_KEY`)。
- 登记表里只记录:名称、关联 skill、环境变量名、签发/到期日期、状态、续期方式。

## 每次触发先体检

被触发时,先读登记表,用当前日期对照"到期日期"列:

- 已过期 → 状态改 `expired`,告知用户并走「失效处理」
- 30 天内到期 → 状态改 `expiring`,主动提醒续期,给出该条目的续期方式
- 其余保持 `active`,无需打扰用户

## 各场景流程

### 新增密钥

1. 问清:用途/关联 skill、环境变量名、有效期、续期入口(网址或命令)。
2. 指导用户把值写入环境变量(Windows:`setx 变量名 "值"`,提醒完全重启 ZCode 生效),或追加到 `.env.local`。
3. 在登记表追加一行,状态 `active`,并在"维护记录"里记一笔。

### 失效处理(API 报 401/403/key 无效/过期)

1. 把登记表中该条状态改为 `expired`,维护记录里写明日期和报错现象。
2. 告诉用户续期方式,拿到新 key 后走「续期」。

### 废弃(用户确认不再续期,或接口本身下线)

1. 登记表状态改 `deprecated`,维护记录注明原因。
2. 禁用关联 skill:把 `D:\code\0X-SKILLS\skills\<skill名>\SKILL.md` 重命名为 `SKILL.md.disabled`(ZCode 发现不了它,即完成禁用;junction 链接无需动)。
3. 提交 git,commit message 说明废弃原因。

### 重新启用(拿到新 key / 接口恢复)

1. 指导用户更新环境变量,实测一次调用确认可用。
2. 若 skill 被禁用,把 `SKILL.md.disabled` 改回 `SKILL.md`。
3. 登记表更新签发/到期日期,状态改回 `active`,维护记录记一笔。
4. 提交 git。

### 续期(key 还有效,只是换新)

更新环境变量 → 更新登记表的签发/到期日期 → 维护记录记一笔 → 提交 git。

## 提交规范

涉及登记表的改动,提交时只含元数据;提交前用 `git status` 确认没有把 `.env.local` 之类的密钥文件加入暂存区。
