# 密钥/接口登记表

集中登记所有 API 密钥与链接的**元数据**。密钥值本身绝不写入本文件(只在环境变量或本地 `.env.local`)。

## 状态约定

| 状态 | 含义 |
|------|------|
| `active` | 正常使用中 |
| `expiring` | 30 天内到期,需尽快续期 |
| `expired` | 已过期,待处理 |
| `deprecated` | 已废弃:key 失效且确认不再可用,关联 skill 已禁用(SKILL.md → SKILL.md.disabled)。拿到新 key 后恢复 |

## 登记项

| 名称 | 关联 skill | 环境变量 | 签发日期 | 到期日期 | 状态 | 续期方式 |
|------|-----------|---------|---------|---------|------|---------|

## 维护记录

- 2026-10-14:建立登记表,迁入 GEMINI_API_KEY。
- 2026-10-14:用户提供新 Gemini key(AQ.Ab8RN6… 开头),实测返回 403 PERMISSION_DENIED("Your project has been denied access"),key 所属项目被 Google 拒绝访问。**未写入环境变量**,状态标记为 `expired`,待用户在 Google AI Studio 检查项目或重新生成可用 key 后走「重新启用」流程。
- 2026-10-15:用户决定放弃 Gemini API,`gemini-api` skill 已从仓库和 `~/.zcode/skills` 中删除,Gemini key 条目移除登记。
