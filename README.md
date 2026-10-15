# jacktian-skills

个人 Skill 中心:集中管理我的 ZCode / Agent skills,Git 版本管理,GitHub 多机同步。

## 目录结构

```
skills/
  <skill-name>/
    SKILL.md          # 必需:YAML frontmatter (name, description) + 正文
    references/       # 可选:按需加载的详细文档
    scripts/          # 可选:辅助脚本
    assets/           # 可选:模板、示例等
tools/
  sync.ps1            # Windows 同步脚本(推荐)
  sync.sh             # Git Bash 同步脚本
credentials/
  registry.md         # 密钥/接口登记表(只存元数据,不含密钥值)
  .env.local          # 本地密钥值(已 gitignore,不入库)
```

## 密钥管理

所有 API 密钥/链接的生命周期由 `credentials-manager` skill 统一管理,登记在 `credentials/registry.md`:

- **密钥值绝不入库**,只放环境变量或本地 `.env.local`
- **临期提醒**:30 天内到期主动提醒续期
- **失效 → 废弃**:API 失效后标记 `expired`;确认不再续期则标记 `deprecated` 并禁用关联 skill(SKILL.md → SKILL.md.disabled)
- **重新启用**:拿到新 key 后更新环境变量、恢复 skill、更新登记表

## 使用方式

**本机已生效**:`skills/` 下每个 skill 通过 junction 链接到 `~/.zcode/skills/`,在仓库里直接编辑即生效,无需拷贝。

**新机器初始化**:

```powershell
git clone git@github.com:jackverse/jacktian-skills.git
cd jacktian-skills
powershell -ExecutionPolicy Bypass -File tools/sync.ps1
```

**新增 skill**:在 `skills/` 下新建目录并编写 `SKILL.md`(可用 ZCode 的 skill-creator 辅助),然后跑一次同步脚本建立链接,提交推送即可。

## Skills 列表

| Skill | 说明 |
|-------|------|
| [credentials-manager](skills/credentials-manager/SKILL.md) | 集中管理 API 密钥生命周期:登记、临期提醒、失效标记、废弃/重新启用 |
