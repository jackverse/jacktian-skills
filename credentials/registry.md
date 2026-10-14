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
| Gemini API Key | gemini-api | `GEMINI_API_KEY` | 待补充 | 待补充(约签发后 1 年) | active | 到 Google AI Studio 重新生成 key,然后 `setx GEMINI_API_KEY "新key"` 并重启 ZCode,最后更新本表 |

## 维护记录

- 2026-10-14:建立登记表,迁入 GEMINI_API_KEY。
