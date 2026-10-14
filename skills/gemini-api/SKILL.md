---
name: gemini-api
description: 通过 curl 调用 Google Gemini API(generateContent)做文本生成、翻译、问答。当用户要求"调用 Gemini"、"问一下 Gemini"、"用 Gemini 生成/翻译"或需要第二个模型的意见时使用。
---

# 调用 Gemini API

## 鉴权

- API Key 存放在环境变量 `GEMINI_API_KEY` 中。
- 绝对不要把 key 明文写进任何文件、命令输出或回复里;引用时一律用 `$GEMINI_API_KEY`。
- 若环境变量为空,提示用户先执行 `setx GEMINI_API_KEY "他的key"`(Windows)并完全重启 ZCode。

## 代理(本机需要)

- 本机直连 Google 不通,必须走代理。代理地址在环境变量 `GEMINI_PROXY` 中(当前为 `http://127.0.0.1:7897`,Clash Verge 混合端口)。
- 调用时加 `--max-time 60` 并按下方模板注入 `-x` 参数;若连接超时,先确认代理软件已启动,必要时让用户更新 `GEMINI_PROXY`。

## 端点与模型

- 端点:`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- 默认模型:`gemini-flash-latest`(可按用户要求换成其他模型名)

## 调用模板(Bash)

```bash
curl -s --max-time 60 ${GEMINI_PROXY:+-x "$GEMINI_PROXY"} \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent" \
  -H 'Content-Type: application/json' \
  -H "X-goog-api-key: $GEMINI_API_KEY" \
  -X POST \
  -d '{"contents":[{"parts":[{"text":"<提示词>"}]}]}'
```

- 提示词放进 `text` 字段,注意 JSON 转义(内部双引号用 `\"`,换行用 `\n`)。
- 多轮对话:在 `contents` 数组按顺序追加 `{"role":"user"|"model","parts":[{"text":"..."}]}`。

## 响应解析

- 生成的文本位于 `candidates[0].content.parts[0].text`,提取后整理输出,不要把原始 JSON 整段贴给用户。
- 报错时看 `error.message`:常见原因是 key 无效、额度用尽(429)、模型名不存在(404)。

## 注意

- 本技能只做"调用外部 Gemini",不影响 ZCode 自身使用的模型。
- key 失效或持续 429 时,提示用户到 Google AI Studio 检查 key 状态。
