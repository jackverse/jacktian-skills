---
name: go-win-tray-exe
description: Go 单文件 Windows 托盘提醒 EXE 的完整管线：getlantern/systray 托盘（必须钉 v1.2.2，ClickedCh 通道无 Click 回调）+ go-toast 定时 toast 通知 + embed 内嵌 Web 统计面板 + JSON 数据 mtime 热加载（人手/AI/工具三方协作不冲突），reg add 开机自启、运行时画 PNG 包 ICO 头免资源文件、端口抢占实现单实例+二次双击开面板，-H=windowsgui 构建无控制台单 EXE。触发场景：Windows 常驻托盘小工具、定时弹通知/toast 提醒、桌面/节点到期提醒、健康打卡轮询、备份提醒、开机自启注册表、单实例互斥、托盘图标 SetIcon、ICO 文件格式、单文件 EXE 打包、windowsgui 没有控制台日志丢失、JSON 数据文件被覆盖竞态、数据文件默认路径探测（exe 在仓库根/数据在子目录）、MenuItem.Click 编译报错、energye/systray、Git Bash curl 中文乱码、*.exe~ 残留、go-webview2、WebView2 原生窗口面板、WebView2Loader.dll 单文件加载、EBWebView 缓存目录、DataPath 污染工作区、runtime.LockOSThread 消息循环、GetInstalledVersion 运行时检测、剪贴板截图、Ctrl+V 贴图、ClipboardRead、clipboardData.items、attachments 落盘、双重前缀 404、任务详情 md、图片与 md 同目录、md 预览、零依赖 markdown 渲染、详情懒迁移、新建即编辑、一站式新建表单、占位 token、IMG_ 占位、textarea 序号递增、isComposing 229 输入法组合、node --check 检查内嵌 JS。凡"用 Go 写 Windows 托盘/桌面通知工具""打免运行时的单文件 EXE""面板不弹浏览器开原生窗口"均应参考。
---

# Go 单文件 Windows 托盘提醒 EXE 管线（go-win-tray-exe）

## 适用场景

Windows 上做「常驻托盘 + 定时弹通知 + 浏览器打开本地统计面板」的小工具：进度/节点到期提醒、健康打卡轮询、备份提醒、桌面巡检提示等。产物是**无需任何运行时的单个 EXE**——双击即用、可开机自启、拷给同事就能跑。已在 work-information 进度提醒工具上完整验证。

## 选型总览（结论先行）

| 关注点 | 选型 | 一句话理由 |
|--------|------|-----------|
| 托盘 | `github.com/getlantern/systray` **钉 v1.2.2** | API 是 `ClickedCh` 通道；新版/fork 的 `Click(fn)` 回调式 API 编不过（见坑 1） |
| 通知 | `github.com/go-toast/toast` | Win10/11 原生 toast，PowerShell 后端，免注册 AppID，`Message` 支持 `\n` 多行 |
| Web 面板 | `net/http` + `embed` 内嵌单文件 HTML | 前端零框架：原生 `<dialog>` 弹窗 + SVG/CSS 手绘图表，60 秒轮询保鲜 |
| 面板窗口 | `go-webview2` 原生 WebView2 窗口，浏览器 rundll32 仅缺运行时兜底 | 不弹浏览器、更像桌面应用；EXE 仍是单文件（见实现 9） |
| 数据 | 一份 JSON（RWMutex + `MarshalIndent` 落盘） | 每次公开方法先 `os.Stat` 比对 mtime 热加载——**人手改 / AI 改 / 工具自己写三方协作不冲突** |
| 开机自启 | `reg add HKCU\...\Run` | `exec` 调 reg.exe，零额外依赖，托盘菜单 checkbox 切换 |
| 托盘图标 | 运行时画 32x32 PNG 包 ICO 头 | 零资源文件，单 main.go 即可交付（见下文 ICO 字节布局） |
| 构建 | `-trimpath -ldflags "-s -w -H=windowsgui"` | 无控制台窗口、去符号、路径无关的单 EXE |

## 依赖与构建（可直接复制）

```bash
# 国内网络全程带代理
export GOPROXY=https://goproxy.cn,direct

go mod init toolname
go get github.com/getlantern/systray@v1.2.2   # 必须钉 v1.2.2，勿 @latest 升级
go get github.com/go-toast/toast
go mod tidy                                   # go get @latest 之后必须 tidy，否则 build 报缺依赖

# 构建无控制台单文件 EXE
go build -trimpath -ldflags "-s -w -H=windowsgui" -o toolname.exe .
```

`.gitignore` 除常规项外**必须加 `*.exe~`**（见坑 6）。

## 关键实现

### 1. 托盘菜单：v1.2.2 是 ClickedCh 通道，没有 Click 回调

```go
func onReady() {
	systray.SetIcon(pngToIco(drawTrayPNG()))
	systray.SetTooltip("进度提醒")

	mShow := systray.AddMenuItem("打开面板", "浏览器打开统计面板")
	mAuto := systray.AddMenuItemCheckbox("开机自启", "", isAutostartEnabled())
	mExit := systray.AddMenuItem("退出", "")

	// v1.2.2 没有 mShow.Click(func(){...})——那是 fork energye/systray 的 API，
	// AI 生成代码常写成回调式，编译报错即此因。正确姿势：goroutine 里 select 各通道。
	go func() {
		for {
			select {
			case <-mShow.ClickedCh:
				openPanel()
			case <-mAuto.ClickedCh:
				on := toggleAutostart()
				if on { mAuto.Check() } else { mAuto.Uncheck() }
			case <-mExit.ClickedCh:
				systray.Quit()
			}
		}
	}()
}
```

### 2. 单实例 + 二次双击打开面板：先抢端口、后加载数据

固定端口 `net.Listen` 一举两得：既是单实例互斥锁，又是 Web 面板的 listener。第二个实例抢不到端口 → 替用户 `rundll32` 打开面板后直接退出。

```go
const addr = "127.0.0.1:56780" // 选一个冷门端口，固定不动

func main() {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// 端口被占 = 已有实例在跑：同步弹原生面板窗口，窗口关闭（Run 返回）后本进程再退出
		//（见实现 9；缺 WebView2 运行时时其内部回退 rundll32 开浏览器）。
		// 本路径不读写数据文件——仍是"先抢端口、后碰数据"。
		runPanelWindow("http://" + addr)
		return
	}

	// —— 顺序不能反：先抢端口成功，才允许加载数据 ——
	// 若反过来，第二个实例会在退出前加载+可能写一次数据文件，
	// 与第一个实例/外部编辑产生覆盖竞态（实测踩过）。
	store := OpenStore(dataPath())
	startPanel(ln, store) // go http.Serve(ln)
	go reminderLoop(store)
	systray.Run(onReady, onExit)
}
```

### 3. JSON 数据热加载：mtime 比对，三方协作不冲突

数据文件可能被三方写：工具自己、人手用编辑器改、AI 助手改。做法：**每个公开方法（读和写都一样）开头先 `os.Stat` 比对 mtime，变了就重载**。

```go
type Store struct {
	mu    sync.RWMutex
	path  string
	mtime time.Time
	data  Data
}

func (s *Store) refresh() { // 所有公开方法第一行调用
	fi, err := os.Stat(s.path)
	if err == nil && !fi.ModTime().Equal(s.mtime) {
		if b, err := os.ReadFile(s.path); err == nil {
			var d Data
			if json.Unmarshal(b, &d) == nil {
				s.mtime, s.data = fi.ModTime(), d
			}
		}
	}
}

func (s *Store) Save() {
	s.mu.Lock(); defer s.mu.Unlock()
	b, _ := json.MarshalIndent(s.data, "", "  ")
	os.WriteFile(s.path, b, 0644)
	if fi, err := os.Stat(s.path); err == nil {
		s.mtime = fi.ModTime() // 落盘后同步 mtime，避免下次误判"外部改过"
	}
}
```

**数据文件默认路径探测**：`-data` 默认值不要写死 exe 同级 `data/`——当 exe 放在仓库根、数据在子目录的仓库布局下会找不到文件。应做候选列表探测，按顺序取第一个**已存在**的；都不存在才落第一个（首次运行自动新建便携布局）：

```go
func defaultDataPath() string { // -data 未显式指定时的默认值
	exe, _ := os.Executable()
	exeDir := filepath.Dir(exe)
	cands := []string{
		filepath.Join(exeDir, "data", "tasks.json"),             // 便携单目录模式
		filepath.Join(exeDir, "进度管理", "data", "tasks.json"), // exe 在仓库根的仓库布局
	}
	for _, c := range cands {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return cands[0]
}
```

### 4. 提醒循环：3 秒首查 + Ticker 轮询 + 不打扰原则

```go
func reminderLoop(store *Store) {
	time.Sleep(3 * time.Second) // 启动后 3 秒先查一次
	checkAndNotify(store, false)
	t := time.NewTicker(N * time.Minute) // N 分钟轮询
	defer t.Stop()
	for range t.C {
		checkAndNotify(store, false)
	}
}

func checkAndNotify(store *Store, manual bool) {
	items := store.DueItems() // 汇总"逾期/临近"列表
	if len(items) == 0 && !manual {
		return // 空且非手动触发 → 不弹通知，不打扰
	}
	lines := make([]string, 0, len(items))
	for _, it := range items {
		lines = append(lines, it.Line()) // "名称：逾期 3 天" 等
	}
	toast.Notification{
		AppID:   "进度提醒", // AppID 带空格没问题，无需注册
		Title:   fmt.Sprintf("有 %d 条节点需要关注", len(items)),
		Message: strings.Join(lines, "\n"), // \n 换行多行文案
	}.Push()
}
```

托盘菜单里放一项「立即检查」调 `checkAndNotify(store, true)`，空列表也弹"暂无到期项"，给用户确定性反馈。

### 5. 开机自启：reg add HKCU Run（零依赖）

```go
const runKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

func setAutostart(on bool) {
	exe, _ := os.Executable()
	if on {
		exec.Command("reg", "add", runKey, "/v", appName,
			"/t", "REG_SZ", "/d", `"`+exe+`"`, "/f").Run()
	} else {
		exec.Command("reg", "delete", runKey, "/v", appName, "/f").Run()
	}
}

func isAutostartEnabled() bool { // 决定 checkbox 初始态
	return exec.Command("reg", "query", runKey, "/v", appName).Run() == nil
}
```

只写 `HKCU`（当前用户），不需要管理员权限；路径带空格要整体加引号（如上 `/d` 参数）。

### 6. 托盘图标零资源文件：运行时画 PNG 包 ICO 头

不往仓库塞 .ico/.syso：用 `image` 标准库运行时画 32x32 PNG，手工包 ICO 头后喂 `SetIcon`。**Vista+ 允许 ICO 内嵌 PNG**，无需转 BMP：

```
ICO = 6 字节 ICONDIR + 16 字节 ICONDIRENTRY + PNG 原始字节
ICONDIR:      reserved=0(2B), type=1(2B, 图标), 图像数=1(2B)            → {0,0,1,0,1,0}
ICONDIRENTRY: 宽(1B)=32, 高(1B)=32, 调色板数(1B)=0, 保留(1B)=0,
              planes(2B)=1, bitCount(2B)=32, 数据长度(4B)=len(png), 数据偏移(4B)=22
```

```go
func pngToIco(png []byte) []byte {
	ico := []byte{0, 0, 1, 0, 1, 0}      // ICONDIR
	ico = append(ico, 32, 32, 0, 0)      // 宽、高、0、0
	ico = append(ico, 1, 0, 32, 0)       // planes=1, bitCount=32
	n := uint32(len(png))
	ico = append(ico, byte(n), byte(n>>8), byte(n>>16), byte(n>>24))
	ico = append(ico, 22, 0, 0, 0)       // 偏移 = 6+16 = 22
	return append(ico, png...)
}
// drawTrayPNG(): image.NewRGBA(32x32) 画底色+图案 → png.Encode
```

### 7. Web 面板：embed 单文件 HTML + 原生 dialog + 60 秒轮询

HTTP 层与 HTML 与窗口宿主无关：浏览器标签页或 WebView2 原生窗口（见实现 9，现役方案）打开的都是这同一套 `/` + `/api/*`。

```go
//go:embed panel.html
var panelHTML []byte

func startPanel(ln net.Listener, store *Store) {
	http.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(store.Snapshot())
	})
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(panelHTML)
	})
	go http.Serve(ln) // 复用单实例抢来的 listener
}
```

panel.html 前端零框架纪律：弹窗用原生 `<dialog>`（`showModal()`/`close()`，不需要任何库）；图表 SVG/CSS 手绘；`setInterval(refresh, 60_000)` 60 秒轮询 `/api/state` 保持新鲜；写操作 POST 后立即拉一次 state。

### 8. 日志重定向：windowsgui 没有控制台

`-H=windowsgui` 构建出的 EXE **没有 stdout/stderr**，`log` 默认输出无处可去，出问题无从排查。初始化最前面重定向到数据目录下的日志文件：

```go
func initLog() {
	f, err := os.OpenFile(filepath.Join(dataDir(), "tool.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err == nil {
		log.SetOutput(f)
	}
	// panic 也要能看见：recover 时把堆栈写进日志再退出
}
```

### 9. 原生窗口面板（不弹浏览器，go-webview2）

面板不必弹浏览器：用 WebView2 原生窗口做面板宿主，HTTP 层（实现 7）原样复用，体验更像桌面应用。已在 PMTracker 实测：浏览器访问方式整个移除，全部走原生窗口。

**依赖仍是单文件**：`github.com/jchv/go-webview2`（纯 Go 无 CGO）。其 `webviewloader` 已 `go:embed` 各架构 `WebView2Loader.dll` 并经 go-winloader 从内存加载——**EXE 仍不用带 DLL**。

```bash
go get github.com/jchv/go-webview2   # 之后照例 go mod tidy
```

**统一入口 `runPanelWindow(u)`，阻塞到窗口关闭**。托盘「打开面板」用 `go runPanelWindow(u)`（独立 goroutine）；二次双击 exe（端口已占）路径同步调用——窗口关闭后本进程再退出。

```go
import (
	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
)

var panelMu   sync.Mutex
var panelOpen bool

func runPanelWindow(u string) {
	panelMu.Lock() // 单窗口防重开
	if panelOpen {
		panelMu.Unlock()
		return
	}
	panelOpen = true
	panelMu.Unlock()
	defer func() { // 防创建期 panic 带崩整个托盘进程
		recover()
		panelOpen = false
	}()

	runtime.LockOSThread() // Win32 窗口必须独占线程跑消息循环
	defer runtime.UnlockOSThread()

	// 运行时检测：老系统缺 WebView2 运行时 → 回退 rundll32 浏览器打开
	if _, err := webviewloader.GetInstalledVersion(); err != nil {
		panelOpen = false
		exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
		return
	}

	// DataPath 必须指到 %LOCALAPPDATA%\<AppName>（先 MkdirAll 再传入）；
	// 否则库默认在 exe 目录生成 <exe名>.WebView2 缓存文件夹，污染工作区/仓库
	dp := filepath.Join(os.Getenv("LOCALAPPDATA"), appName)
	os.MkdirAll(dp, 0o755)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		DataPath:  dp,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title: "进度提醒", Width: 960, Height: 640, Center: true, IconId: 2,
		},
	})
	if w == nil { // 返回 nil 即创建失败 → 兜底浏览器
		panelOpen = false
		exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
		return
	}
	defer w.Destroy()

	w.Navigate(u) // 复用 embed HTML + /api/* 的本地面板服务
	w.Run()       // 阻塞消息循环；窗口 X 关闭后返回 → panelOpen 复位，进程继续驻留托盘
}
```

**与托盘共存**：主 goroutine 跑 `systray.Run`，面板窗口在自己 LockOSThread 的 goroutine 里跑消息循环，互不阻塞。托盘「打开面板」即 `go runPanelWindow(panelURL)`。

**窗口 X = 收起不是退出**：`Run` 返回只代表窗口关闭，进程继续驻留托盘，托盘菜单可随时重开（`panelOpen` 已复位）；真正退出走托盘「退出」→ `systray.Quit()`。二次双击 exe 走实现 2 的端口检测，同步调 `runPanelWindow` 弹窗再退出，同样遵守"先抢端口、后碰数据"。

**本节独有坑**：

| 坑 | 正解 |
|----|------|
| 不设 `DataPath` | 默认在 exe 目录产生 `<exe名>.WebView2` 缓存文件夹，污染工作区/仓库；必须设 `%LOCALAPPDATA%\<AppName>` 并先 `os.MkdirAll` |
| 忘 `runtime.LockOSThread()` | Win32 消息循环必须独占线程，跑在随机线程会创建失败/行为异常 |
| 创建期 panic 无 recover | 老系统/环境异常时 panic 会带崩整个托盘进程；goroutine 里 `defer recover` 兜底 |
| 把窗口 X 当退出 | `Run` 返回 = 收起；误在 Run 返回后调用 os.Exit 会导致托盘一起消失 |

**无头环境验证**（远程/CI 无法肉眼看窗口时）：

```powershell
# 进程存在且主窗口标题非空 = 窗口创建成功
Get-Process toolname | Select-Object MainWindowTitle
# WebView2 用户数据目录已生成（注意在 %LOCALAPPDATA% 下，不在 exe 目录）
Test-Path "$env:LOCALAPPDATA\<AppName>\EBWebView"
```

### 10. 面板贴图与附件落盘

面板里直接 Ctrl+V 贴微信/QQ 截图 → 后端解码落盘 → `<img>` 回显，已在 PMTracker 实测。

**前端双通道收图**：`jchv/go-webview2` 在 `NewWithOptions` 时已默认 `SetPermission(ClipboardRead, Allow)`，`navigator.clipboard.read()` 可直接用（读图片 blob，适合"粘贴"按钮主动拉取）；更通用的兜底是 document 级 `paste` 事件读 `e.clipboardData.items`——微信/QQ 截图后的 Ctrl+V 都走这里。两个都实现，**粘贴事件只在命中图片时 `preventDefault()`，别挡文字粘贴**：

```js
document.addEventListener('paste', e => {
  const it = [...e.clipboardData.items].find(i => i.kind === 'file' && i.type.startsWith('image/'));
  if (!it) return;                    // 未命中图片不拦截，文字粘贴照常
  e.preventDefault();
  const fr = new FileReader();
  fr.onload = () => postJSON('/api/add', { text: curText, image: fr.result }); // readAsDataURL → dataURL 直传
  fr.readAsDataURL(it.getAsFile());
});
```

**Go 侧解码与落盘**：`decodeImageData` 剥 `data:...;base64,` 前缀再 `StdEncoding` 解码；附件目录 = 数据文件同级 `attachments/<任务id>/`，文件名 `newID()+ext`（日期+随机 hex，防同毫秒冲突）：

```go
func decodeImageData(s string) ([]byte, error) {
	if i := strings.Index(s, ";base64,"); i >= 0 {
		s = s[i+len(";base64,"):]
	}
	return base64.StdEncoding.DecodeString(s)
}
// saveAttachment：MkdirAll(attachDir()/<任务id>) → WriteFile(attachDir()/<任务id>/<newID()><ext>)
// attachDir() = filepath.Join(filepath.Dir(dataPath()), "attachments")
```

**坑：静态文件路由双重前缀 404（实测踩过）**。存储的相对路径若已含 `attachments/` 前缀，而 `http.StripPrefix("/files/")` 挂的又是 attachments 目录，会拼出 `attachments/attachments/...` 全部 404。约定：**存库路径相对 attachments 目录**（如 `<任务id>/xxx.png`），路由剥 `/files/` 后直接挂 attachments 目录，前端 `<img src="/files/<相对路径>">`：

```go
mux := http.NewServeMux()
mux.Handle("/files/", http.StripPrefix("/files/", http.FileServer(http.Dir(attachDir()))))
mux.HandleFunc("/api/add", handleAdd) // 解码 → saveAttachment → 存相对路径
mux.HandleFunc("/", handlePanel)      // embed 面板；ServeMux 最长前缀优先，"/files/" 与 "/" 共存没问题
```

`net/http` 服务端默认不限制 body 大小，大截图 base64 直传可行（若自行加 `http.MaxBytesReader` 记得留足余量）。

**无头冒烟**（不起窗口验证整链路）：用 1x1 PNG 的 base64（`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`）POST add → 从 `/api/state` 取 images 路径 → `GET /files/<路径>` 断言 200 且 body 长度 == 70 → delete 后断言磁盘文件连带删除。

**前端「记录」交互模式**：`<dialog>` 常开不自动关，保存成功后就地刷新列表，支持连续记录；待上传图用 `URL.createObjectURL(blob)` 做缩略图预览，弹窗关闭时 `revokeObjectURL` 释放。

### 11. 任务详情 = 独立 md + 截图同目录

**设计选型**：当用户要求「任务有详情、可编辑、图片和文字 md 同目录」时，不要继续把长详情塞进 JSON 记录，而是升级为**每任务一个 md 文件**：`tasksRoot/<任务id>/详情.md`。截图平铺在同一目录（不建 `images/` 子目录），md 内用 `![](文件名.png)` 相对引用——Typora、VSCode 或任意第三方 md 编辑器打开即可看图，人、AI、程序三方都可直接修改；JSON 只保留任务索引与元信息。

**tasksRoot 放在数据目录的同级，不是里面**：`filepath.Dir(filepath.Dir(store.file))` 先退出 `data/`，再拼 `tasks`。数据目录只放 JSON 和日志，任务详情则作为对人可见的内容独立管理。文档、前端提示和实际路径必须一致——PMTracker 踩过「文档写 `进度管理/tasks/`，代码却落在 `data/tasks/`」的错。

```go
func (s *Store) tasksRoot() string { return filepath.Join(filepath.Dir(filepath.Dir(s.file)), "tasks") }
mux.Handle("/taskfiles/", http.StripPrefix("/taskfiles/", http.FileServer(http.Dir(store.tasksRoot()))))
```

**API 与静态路由**：

| 接口 | 行为 |
|------|------|
| `GET /api/task/detail?id=<任务id>` | 返回 `{content, dir}`；`详情.md` 不存在时按模板自动创建，同时触发旧记录懒迁移 |
| `POST /api/task/detail/save` | 接收 `{taskID, content}`，全量写回 md |
| `POST /api/task/detail/image` | 图片解码后存入该任务详情目录，返回 `{file}`；前端 `insertAtCursor` 在光标处插入 `![](文件名)`，随后仍需保存 md |
| `POST /api/task/detail/open-folder` | `exec.Command("explorer", dir).Start()` 打开资源管理器 |

`/taskfiles/` 用 `StripPrefix + FileServer(Dir(tasksRoot))` 暴露任务目录；预览渲染相对图片时把 src 改写为 `/taskfiles/<taskid>/<file>`。任务 id 保持纯 ASCII，避免 URL 编码中文目录名。

```js
function insertAtCursor(el,text){
  const s=el.selectionStart||0,e=el.selectionEnd||0;
  el.value=el.value.slice(0,s)+text+el.value.slice(e);
}
function mdToHtml(md,taskId){ const blocks=String(md||'').split('```'); /* 奇数块代码、偶数块行级+inline */ }
```

**零依赖 md 预览**：单 HTML 内手写约 40 行 `mdToHtml` 即可覆盖中文项目文档：先按代码围栏（三个反引号）切块处理代码块，再逐行处理 `#` 标题、列表、引用、hr、段落，inline 处理图片、链接、`` `code` ``、`**粗体**`；文本先 HTML 转义。不引第三方库，离线可用。

**旧数据懒迁移**：首次打开详情时把 JSON `records` 逐条追加成 `## 记录 <时间>` 小节，`os.Rename` 将旧图片移入详情目录并补相对引用，成功后清空 `records` 并落盘，避免重复迁移。删除任务只删 JSON 索引，**不删详情目录**，保留历史文件。

**无头冒烟顺序**：`GET detail` 断言 200 且自动建 md → `POST save` 原样写回并断言 ok → `POST image` 取得文件名 → `GET /taskfiles/<id>/<file>` 断言 200（70B 测试图）→ 清理测试图。

### 12. 新建即编辑（一站式表单）与 textarea md 编辑器增强

**新建实体时同步写详情/贴图，不用"先建再开编辑器"两步**：新增 `<dialog>` 里直接放 md textarea + 贴图区，保存一次完成建实体+落详情。难点：实现 11 的贴图要落 `tasksRoot/<任务id>/`，新建时还没有 id——用**占位 token 机制**：粘贴/选图时立即 `URL.createObjectURL(blob)` 本地预览，并在光标处插 `![](IMG_1)` 占位（计数器自增）；点保存时：先 POST 创建实体拿 id → 逐张上传待传队列换取真实文件名 → 字符串替换 `![](IMG_n)` → `![](<真实文件名>)` → 再 POST 保存详情 md；最后清理残留占位 `![](IMG_\d+)`（用户贴了又删图的情况）。从待传队列删除某张图时，同步从 textarea 移除对应 token，保持图文一致。

token 替换循环：

```js
// 保存时：先建实体拿 id → 逐张上传换真实文件名 → 替换 token → 再存详情 md
for (const p of pending) p.name = await uploadImage(p.blob, newId); // 返回落盘文件名
let md = ta.value.replace(/!\[IMG_(\d+)\]/g, (m, k) => {
  const p = pending.find(x => x.token === 'IMG_' + k);
  return p ? `![](${p.name})` : '';               // 队列里找不到 = 用户删过图，清掉占位
});
md = md.replace(/!\[IMG_\d+\]\s*/g, '');          // 兜底清理残留占位
await postJSON('/api/task/detail/save', { taskID: newId, content: md });
```

**paste 事件按对话框分发**：document 级监听（实现 10 的双通道照旧），入口先看哪个 `<dialog open>`：已存在实体的编辑弹窗 → 立即上传；新建表单 → 入占位队列。仍然**只命中图片才 `preventDefault()`**，不挡中文/文字粘贴。

**textarea 的 md 编辑器增强（零依赖 ~30 行 keydown）**：Enter 在 `1.`/`1、`/`)` 序号行自动递增续行（`2.`、`3.`…），`-`/`*` 列表与 `>` 引用自动延续；**空项上回车 = 清掉序号退出列表**（不做这条序号永远删不完）；Tab/Shift+Tab 对多行选区整体缩进/反缩进 2 空格；**必须先判 `e.isComposing || e.keyCode === 229` 跳过中文输入法组合期，否则拼音上屏会被吞**（实测注意点）；Shift+Enter 只换行不触发列表逻辑。

enhanceEditor 骨架：

```js
function enhanceEditor(ta) {
  ta.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;   // 中文输入法组合期，直接放行
    if (e.key === 'Enter' && !e.shiftKey) {           // Shift+Enter 已放行为纯换行
      const ln = curLine(ta), m = ln.match(/^(\s*)(\d+)([.、)])\s*/); // 1. / 1、 / 1)
      if (ln.trim() === m[0].trim()) { dropPrefix(ta); return e.preventDefault(); } // 空项回车=退出列表
      if (m) { ins(ta, `\n${m[1]}${+m[2] + 1}${m[3]} `); return e.preventDefault(); } // 序号+1 续行
      /* - 列表与 > 引用同理：非空延续前缀、空项清前缀退出 */
    }
    if (e.key === 'Tab') { indentSel(ta, e.shiftKey); return e.preventDefault(); } // 多行整体缩进/反缩进
  });
}
```

**Ctrl+S 保存**：document 级 keydown，目标 dialog 打开时 `e.preventDefault()` 并调保存函数（textarea 内 Ctrl+S 默认无操作，安全），对齐桌面软件的保存习惯。

**无头语法检查**：单文件 HTML 内嵌 JS 改完先过一遍语法检查再 go build，省一轮构建+手测：

```bash
sed -n '/<script>/,/<\/script>/p' panel.html | sed '1d;$d' > /tmp/panel.js && node --check /tmp/panel.js
```

**Git Bash curl 补充坑**：坑 5 的 GBK 乱码之外，`printf` 会把 `\n` 转成真实换行直接破坏 JSON 结构——无头冒烟的请求体**一律用纯 ASCII 字符串**（中文接口验证走浏览器操作，或请求体存成 UTF-8 文件后 `--data-binary @file`）。

## 坑速查（8 条）

| # | 坑 | 正解 |
|---|----|------|
| 1 | `getlantern/systray` API 对不上：AI 生成 `MenuItem.Click(fn)` 编译报错 | **钉 v1.2.2**，其 API 是 `ClickedCh chan struct{}` 通道，`Click(fn)` 回调是 fork `energye/systray` 的 API；onReady 里起 goroutine select 各菜单项的 ClickedCh |
| 2 | `go get @latest` 后 build 报缺依赖；国内网络拉不动 | `go get @latest` 后必须 `go mod tidy`；全程 `GOPROXY=https://goproxy.cn,direct` |
| 3 | 二次双击会起第二个实例；且若先加载数据再退出，会写一次数据文件覆盖外部修改（**实测踩过**） | 启动先 `net.Listen("tcp","127.0.0.1:固定端口")`，占用 → `rundll32 url.dll,FileProtocolHandler http://...` 打开面板后直接 return；**先抢端口、后加载数据** |
| 4 | windowsgui 模式没有控制台，出问题无从排查 | log 重定向到文件（数据目录下 `xxx.log`），见实现 8 |
| 5 | Git Bash 里 `curl -d '含中文的 JSON'` 服务端收到乱码（按 GBK 编码发出）；浏览器同源 fetch 不受影响 | 测试中文接口用 `curl --data-binary @utf8文件.json -H "Content-Type: application/json"`，请求体存成 UTF-8 文件 |
| 6 | Go build 替换**正在运行的旧 exe** 后目录里多出 `xxx.exe~`（**实测踩过**） | Windows 把旧文件改名 `*.exe~` 留在原地，`.gitignore` 必须加 `*.exe~`，否则残留文件混进 git |
| 7 | toast 文案换行 / AppID 是否要注册 | `Message` 直接支持 `\n` 换行多行文案；AppID 带空格没问题，go-toast 走 PowerShell 后端免注册 |
| 8 | 面板弹窗/保鲜要不要引前端库 | 都不用：原生 `<dialog>` 元素做弹窗；60 秒 `setInterval` 轮询 `/api/state` 保持新鲜 |

## 真实案例

2026-11 work-information（个人项目管理库）进度提醒工具（PMTracker）：单 main.go + panel.html，托盘（打开面板/立即检查/开机自启 checkbox/退出）+ 每日节点到期 toast + 统计面板（SVG 手绘图表、`<dialog>` 编辑弹窗）+ 单 JSON 存储三方热加载。坑 3（第二实例退出前写数据文件的覆盖竞态）与坑 6（`*.exe~` 混进目录）为实测踩过后定位；`go build` 产物 `-trimpath -ldflags "-s -w -H=windowsgui"`，单 EXE 约 8MB 级，双击即用。面板宿主已从浏览器升级为 go-webview2 原生窗口（实测验证：浏览器访问方式移除，EXE 保持单文件；`runPanelWindow` 统一托盘/二次双击两个入口，`GetInstalledVersion` 失败回退 rundll32；DataPath 指向 `%LOCALAPPDATA%` 后 exe 目录不再产生缓存文件夹）。
