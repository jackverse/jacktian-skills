---
name: study-quiz
project: D:\jack\self-knowledge-md
description: 维护与使用该笔记仓库的刷题工具 tools/study/（科目即目录的 JSONL 题库 + 间隔复习）。当用户要求出题、建题库、导入题目、组卷测验、查正确率，或需要重新打包/升级 study.exe 时使用。
---

# Skill: 刷题工具（study.py / study.exe）

**一句话**：题库是数据（`notes/kb/<科目>/questions.jsonl`），工具是代码（`tools/study/`）。出题不改代码，加科目只建目录，改题不用重新打包。

## 何时用

- 用户说"出题""搞套题""刷题""复习错题""看正确率""把这个知识点做成题"
- 新建/扩充知识库后配练习（如 `notes/kb/network/` 建好就配题库）
- 工具要改功能、换版本、重新打包 exe

## 命令速查

```bash
python tools/study/study.py                     # 交互菜单（exe 双击同效）
python tools/study/study.py list                # 科目/题量/已练/错题
python tools/study/study.py <科目> quiz -n 10    # 抽题
python tools/study/study.py <科目> quiz -c 01   # 只抽某章（模糊匹配）
python tools/study/study.py <科目> quiz --wrong # 刷未掌握错题
python tools/study/study.py <科目> review       # 复习今日到期
python tools/study/study.py <科目> import f.jsonl
python tools/study/study.py <科目> stats
```

exe：`tools/study/app/study.exe`（onedir，已入库，免装 Python）。

## 出题规范（生成题库必须遵守）

1. **id**：`<科目缩写>-NNN`（三位补零、全局唯一），如 `nt-011`；`import` 按 id 自动去重
2. **chapter**：与知识库文件名保持一致（`01-带宽与单位`），同章同一字符串，便于 `-c` 组卷
3. **每题 4 个选项**，干扰项要"像对的"（常见误解就是最好的干扰项）
4. **解析一句话**，说清对在哪/错在哪，不写长篇
5. **一题一考点**
6. 从 `.md` 生成：先读文件，按小节各出 1~2 题；有公式/数字的必须给具体值（如"1000 Mbps → 125 MB/s"）
7. 禁止：`以上都对/都不对`、与题干无关的选项、重复考点

## 标准流程

1. 读目标 `notes/kb/<科目>/*.md`（没有就先建知识库）
2. 生成临时题库（如 `.build/bank-<科目>.jsonl`），一行一题
3. `python tools/study/study.py <科目> import <文件>`（校验 JSON、id 去重）
4. `python tools/study/study.py <科目> stats` 验证题量与章节分布
5. 报数：新增 N 题、跳过重复 M 题、章节分布

## 打包与维护

- 改功能才动 `study.py`：改 → 同步 `__version__` → `powershell -File tools/study/build.ps1` → 提交 `app/`
- **app/ 已入库**（用户要求 exe 便携）：每次重建给 git 历史再加约 20MB，只在功能真变时重建提交；发版频繁再考虑 Git LFS / Release 附件
- 数据（`questions.jsonl`、`review.json`）跟着 `notes/kb/` 走；`review.json` 由工具写，**不要手改**

## 踩坑（可直接复用到别的打包项目）

| 坑 | 表现 | 解法 |
|----|------|------|
| exe 移动位置后找错目录 | 放进 `app/` 子目录后题库定位到仓库外 | 路径**逐级向上查找** `notes/kb`，不要写死 `parents[N]`；并支持 `--root` / 环境变量 |
| 中文 Windows 控制台崩 | `print("✅")` → `UnicodeEncodeError: 'gbk' codec` | 输出符号改 `√/×` 等 GBK 安全字 + `sys.stdout.reconfigure(errors="replace")` |
| 双击闪退看不到结果 | 跑完即关窗 | 只"无参数"时 `input("按回车退出...")`，命令行调用不打扰 |
| `-F` 单文件不稳 | 每次启动解压 `%TEMP%`，慢、易误报、受限环境起不来 | 用 **onedir**，整个 `app/` 目录一起拷 |
| PS 5.1 读中文脚本报语法错 | `build.ps1` 无 BOM 被按 ANSI 读 | 构建脚本存 **UTF-8 with BOM**（`[IO.File]::WriteAllText(..., UTF8Encoding($true))`） |

## 铁律

- **不碰 `review.json`**：那是用户的学习进度，除非用户明确要求重置
- **不删既有题目**：修正改 `analysis` 或新增替代题；删行会让复习进度错位
- 新增/改题后跑一次 `stats`，确认章节名没写错
- 出题数量按用户要求，不要"顺手"造上百题

---

# GUI 版：tools/hub（超级 exe）

同一套题库/进度，外面包了一层 tkinter 窗口：`tools/hub/`，产物 `tools/hub/app/hub.exe`（onedir、--windowed、约 28.5MB）。六页全部懒加载：首页 / 笔记 / **健身** / 刷题 / 错题本 / 统计。

**「健身」页是派生视图，不是新数据源**：只读解析 `notes/daily-log.md` 的月度表格（认表头不认列位置、`—`=未报、剥 `**加粗**`），算出连续记录/训练休息/打卡率/体重曲线(7 日均线)/30 天热力格/部位分布。要加指标只给日报**加列**，往期补 `—`，**不要新建 md**——用户明确说过不愿增加维护成本。

```bash
python tools/hub/hub.py --page quiz      # home|notes|quiz|wrong|stats
python tools/hub/hub.py --root D:\other\repo
python tools/hub/hub.py --selftest       # 构建全部页面后退出（回归自检）
```

**懒加载机制**：`hub.py` 的 `PAGES` 只存模块名，点击时才 `importlib.import_module`，Frame 缓存复用；状态栏显示"已加载页面"便于验证。新增页面 = 加一个 `pages/xxx.py`（导出 `make()`）+ 在 `PAGES` 登记 + 在 `build.ps1` 加 `--hidden-import pages.xxx`。

## GUI 打包的三个坑（通用）

| 坑 | 现象 | 解法 |
|----|------|------|
| 动态 import 扫不到 | exe 里点第二页 `ModuleNotFoundError` | `build.ps1` 逐页 `--hidden-import` |
| 一次静态 import 拖来半个生态 | 包从 28MB 涨到 71MB | 开发用依赖（如 `PIL.ImageGrab` 截图）改用 `__import__` 动态导入 + `--exclude-module numpy/PIL/...` |
| `--windowed` 没有 stdout | `print` 弹错误框、进程挂死 | 自检结果写文件（环境变量传路径），`print` 包 try/except |

验证打包版：`cmd /c start "" app\hub.exe` 分离启动后查窗口标题；或用 `HUB_SELFTEST_OUT=<文件>` 跑 `--selftest` 再读文件。**不要用 `Start-Process -Wait`**（windowed 进程会被等挂）。

