#!/usr/bin/env bash
# startup 项目本地服务管理：admin / task / pub 后端 + admin-web / pub-web 前端
# 由 0X-SKILLS/projects/startup/dev-services 维护，经 sync.ps1 junction 到项目 .zcode/skills/dev-services。
# 项目 .zcode/ 已被 gitignore，本脚本与日志不会进 startup 仓库。
# 用法: dev-services.sh <start|stop|restart|status|build|log|wait|help> [admin|task|pub|admin-web|pub-web|all ...]
set -u

ROOT="D:/code/startup"
LOG_DIR="$ROOT/.zcode/dev-services-logs"
M2="$HOME/.m2/repository/com/wondersgroup"
MVN_WRAPPER="$ROOT/.zcode/skills/maven-build/scripts/mvn-install.mjs"

# spring-boot:run 时 startup-common 从本地仓库 jar 加载，RelativePathParser 推不出工作区根，
# dev yml 里的 `$\doc\xdb\...` 前缀原样返回导致 pub 启动失败（缺 ip2region Searcher bean）。
# 用系统属性覆盖（优先级高于 yml），效果与 IDE 解析结果一致；IDE 重启无需此参数。
JVM_ARGS="-Dregion.file.path=$ROOT/doc/xdb/ip_merge_20240226_final.xdb -Dlocal.file.path=$ROOT/upload"

ALL_SERVICES="admin task pub admin-web pub-web"

port_of() {
  case "$1" in
    admin)     echo 8080 ;;
    task)      echo 8089 ;;
    pub)       echo 8090 ;;
    admin-web) echo 8001 ;;
    pub-web)   echo 18090 ;;
    *)         echo "" ;;
  esac
}

url_of() {
  case "$1" in
    admin)     echo "http://localhost:8080/startup-admin" ;;
    task)      echo "http://localhost:8089/startup-task" ;;
    pub)       echo "http://localhost:8090/startup-pub" ;;
    admin-web) echo "http://localhost:8001" ;;
    pub-web)   echo "http://localhost:18090" ;;
    *)         echo "" ;;
  esac
}

is_backend() { case "$1" in admin|task|pub) return 0 ;; *) return 1 ;; esac; }

# 端口存活探测：curl TCP 探测，拿到 HTTP 响应（退出码 0）才算就绪。
# 坑1：ZCode 沙箱里 netstat/Get-NetTCPConnection 看不到 LISTENING 条目（只出 PID 0 假行）。
# 坑2：杀进程后的过渡态 TCP 能连上但立刻断（退出码 56），非 0 严格判定可避免假监听误判"已在运行"。
port_listening() {
  local port="$1" rc
  curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$port/" 2>/dev/null
  rc=$?
  [ "$rc" -eq 0 ]
}

# 按 进程名 + 命令行通配 杀进程（taskkill /T 连带子树）。
# 必须带 Name 过滤：否则 powershell 自身命令行含模式串会自杀。
# 坑：本沙箱 netstat 拿不到真实监听 PID，杀进程只能走命令行匹配。
kill_by_cmdline() {
  local name_filter="$1" pattern="$2"
  # 坑1：PS 5.1 内联 taskkill /PID $_.Id 展开有问题；坑2：Win32_Process 的属性是 ProcessId（没有 .Id，取到 null）
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='$name_filter'\" | Where-Object { \$_.CommandLine -like '*$pattern*' } | ForEach-Object { \$id = \$_.ProcessId; taskkill /F /T /PID \$id }" >/dev/null 2>&1
}

# 杀一个服务的全部相关进程：mvn launcher + boot fork（后端）/ vite node（前端）
kill_service_procs() {
  case "$1" in
    admin|task|pub)
      local app="com.wondersgroup.startup.${1^}Application"
      kill_by_cmdline "java.exe" "-pl startup-$1 spring-boot:run"
      kill_by_cmdline "java.exe" "$app"
      ;;
    admin-web) kill_by_cmdline "node.exe" "startup-admin-web*vite" ;;
    pub-web)   kill_by_cmdline "node.exe" "startup-pub-web*vite" ;;
  esac
}

ensure_backend_deps() {
  if [ ! -f "$M2/startup-common/6.0.0/startup-common-6.0.0.jar" ] || [ ! -f "$M2/startup-database/6.0.0/startup-database-6.0.0.jar" ]; then
    echo "[$1] 本地仓库缺 startup-common/startup-database，先执行: dev-services.sh build $1"
    return 1
  fi
}

start_one() {
  local name="$1" log="$LOG_DIR/$1.log" port
  port=$(port_of "$name")
  if port_listening "$port"; then
    echo "[$name] 已在运行（端口 $port），跳过"
    return 0
  fi
  mkdir -p "$LOG_DIR"
  case "$name" in
    admin|task|pub)
      ensure_backend_deps "$name" || return 1
      ( cd "$ROOT" && nohup mvn -pl "startup-$name" spring-boot:run "-Dspring-boot.run.jvmArguments=$JVM_ARGS" >> "$log" 2>&1 & )
      echo "[$name] 启动中，日志: $log"
      echo "[$name] 后端就绪约需 3~5 分钟（git 阶段 + 190MB xdb 载入），可用 wait $name 阻塞等待"
      ;;
    admin-web)
      ( cd "$ROOT/startup-admin-web" && nohup npm run "admin dev" >> "$log" 2>&1 & )
      echo "[$name] 启动中，日志: $log（冷启动约 2~4 分钟，可用 wait $name 阻塞等待）"
      ;;
    pub-web)
      ( cd "$ROOT/startup-pub-web" && nohup npm run "startup-dev" >> "$log" 2>&1 & )
      echo "[$name] 启动中，日志: $log（vite 配置 open:true，会自动弹浏览器标签页）"
      ;;
    *) echo "未知服务: $name"; return 1 ;;
  esac
}

stop_one() {
  local name="$1" port
  port=$(port_of "$name")
  if ! port_listening "$port"; then
    kill_service_procs "$name"   # 兜底清扫监听不可见但进程残留的情况
    echo "[$name] 未在运行"
    return 0
  fi
  # 注意：按命令行匹配会杀掉同端口/同项目的任何实例，包括 IDE 里手工启动的
  kill_service_procs "$name"
  # 轮询确认端口已停止应答 HTTP（杀完有过渡态，立即探测会假监听）
  local i=0
  while port_listening "$port" && [ "$i" -lt 6 ]; do
    sleep 2
    i=$((i + 1))
  done
  if port_listening "$port"; then
    echo "[$name] 端口 $port 仍在响应 HTTP，请人工处理（按端口查进程 taskkill）"
    return 1
  fi
  echo "[$name] 已停止"
}

restart_one() {
  stop_one "$1" || return 1
  sleep 1
  start_one "$1"
}

wait_one() {
  local name="$1" timeout="${2:-300}" port elapsed=0
  port=$(port_of "$name")
  while true; do
    if port_listening "$port"; then
      echo "[$name] 端口 $port 已监听（等待 ${elapsed}s）✓"
      return 0
    fi
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "[$name] 等待超时（${timeout}s），查看日志: dev-services.sh log $name"
      return 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    [ $((elapsed % 30)) -eq 0 ] && echo "[$name] ... ${elapsed}s"
  done
}

status_one() {
  local name="$1" port
  port=$(port_of "$name")
  if port_listening "$port"; then
    echo "[RUNNING] $name  端口 $port  $(url_of "$name")"
  else
    echo "[STOPPED] $name  端口 $port  $(url_of "$name")"
  fi
}

build_one() {
  case "$1" in
    admin|task|pub)
      node "$MVN_WRAPPER" "$1"
      ;;
    admin-web|pub-web)
      echo "[$1] 前端无需后端构建（依赖安装走 admin-web-install skill）"
      ;;
  esac
}

log_one() {
  local name="$1" lines="${2:-50}"
  local log="$LOG_DIR/$1.log"
  if [ ! -f "$log" ]; then
    echo "[$name] 无日志文件: $log"
    return 1
  fi
  echo "===== $log（末 $lines 行）===== "
  tail -n "$lines" "$log"
}

usage() {
  cat <<'EOF'
startup 本地服务管理
用法: dev-services.sh <命令> [服务...]
命令:
  start    启动（已运行则跳过）
  stop     停止（按进程命令行匹配杀，含 IDE 启动的实例）
  restart  先 stop 再 start
  status   查看运行状态与地址
  build    后端 install 到本地仓库（走 maven-build skill 的 mvn-install.mjs；前端无需）
  log      查看日志末 N 行（默认 50）: log admin 100
  wait     阻塞等端口就绪，默认 300s: wait admin 600
服务: admin(8080) task(8089) pub(8090) admin-web(8001) pub-web(18090)，all=全部五个
示例:
  dev-services.sh start all          # 全部启动
  dev-services.sh restart admin      # 重启 admin 后端
  dev-services.sh stop pub-web       # 停 pub 前端
  dev-services.sh status
  dev-services.sh start admin && dev-services.sh wait admin
说明:
  - 后端以 mvn -pl startup-<x> spring-boot:run 启动，自动带 region/local 路径系统属性
    （规避 spring-boot:run 下 `$` 前缀路径解析不了的问题，效果同 IDE）。
  - 首次使用或改了 common/database 后需要 build；pub 首启约 200s（xdb 190MB 载入内存）。
  - 日志目录: D:/code/startup/.zcode/dev-services-logs/<服务名>.log（追加写）
  - 端口探测用 curl TCP（沙箱内 netstat 看不到 LISTENING）；杀进程按进程名+命令行匹配。
EOF
}

valid_target() { case " $ALL_SERVICES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

main() {
  local cmd="${1:-help}"
  [ $# -gt 0 ] && shift
  local targets=("$@")
  [ ${#targets[@]} -eq 0 ] && targets=(all)

  local wait_timeout="${WAIT_TIMEOUT:-300}" lines="${LINES:-50}"
  # wait/log 的末尾纯数字参数：分别为超时秒数 / 日志行数
  local last="${targets[${#targets[@]}-1]}"
  if [[ "$last" =~ ^[0-9]+$ ]]; then
    if [ "$cmd" = "wait" ]; then wait_timeout="$last"; fi
    if [ "$cmd" = "log" ]; then lines="$last"; fi
    targets=("${targets[@]:0:$((${#targets[@]}-1))}")
    [ ${#targets[@]} -eq 0 ] && targets=(all)
  fi

  # 展开并校验
  local expanded=() t
  for t in "${targets[@]}"; do
    if [ "$t" = "all" ]; then
      expanded+=($ALL_SERVICES)
    elif valid_target "$t"; then
      expanded+=("$t")
    else
      echo "未知服务: $t（可选: $ALL_SERVICES all）"; exit 1
    fi
  done

  case "$cmd" in
    start)    for t in "${expanded[@]}"; do start_one "$t"; done ;;
    stop)     for t in "${expanded[@]}"; do stop_one "$t"; done ;;
    restart)  for t in "${expanded[@]}"; do restart_one "$t"; done ;;
    status)   for t in "${expanded[@]}"; do status_one "$t"; done ;;
    build)    for t in "${expanded[@]}"; do build_one "$t"; done ;;
    log)      log_one "${expanded[0]}" "$lines" ;;
    wait)     local rc=0; for t in "${expanded[@]}"; do wait_one "$t" "$wait_timeout" || rc=1; done; exit $rc ;;
    help|-h|--help|"") usage ;;
    *) echo "未知命令: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
