#!/usr/bin/env python3
"""用本机 Chrome 截取静态 HTML 架构图，并在截图前检查容器溢出。

示例：
  python render_html_diagram.py diagram.html diagram.png
  python render_html_diagram.py diagram.html diagram.png \
      --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe" \
      --check "#diagram .chips"

默认检查 #diagram、#diagram .layer、#diagram .card，2 倍设备像素截图。
存在溢出时退出码为 2 且不截图；其他运行错误由 Playwright 抛出。
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_CHECKS = ["#diagram", "#diagram .layer", "#diagram .card"]


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("html", help="本地单文件 HTML")
    parser.add_argument("output", help="输出 PNG")
    parser.add_argument("--selector", default="#diagram", help="截图元素，默认 #diagram")
    parser.add_argument("--check", action="append", default=None,
                        help="溢出检查选择器，可重复；设置后替换默认检查组")
    parser.add_argument("--chrome", help="本机 Chrome 可执行文件路径；缺省用 channel=chrome")
    parser.add_argument("--scale", type=float, default=2.0, help="设备像素比，默认 2")
    parser.add_argument("--viewport-width", type=int, default=1600)
    parser.add_argument("--viewport-height", type=int, default=1000)
    parser.add_argument("--report", help="可选：将测量结果写入 JSON 文件")
    args = parser.parse_args()

    html = Path(args.html).resolve()
    output = Path(args.output).resolve()
    if not html.is_file():
        parser.error("HTML 不存在：%s" % html)
    if args.scale <= 0:
        parser.error("--scale 必须大于 0")
    output.parent.mkdir(parents=True, exist_ok=True)

    launch_options = {"headless": True}
    if args.chrome:
        launch_options["executable_path"] = args.chrome
    else:
        launch_options["channel"] = "chrome"

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options)
        try:
            page = browser.new_page(
                viewport={"width": args.viewport_width, "height": args.viewport_height},
                device_scale_factor=args.scale,
            )
            page.goto(html.as_uri(), wait_until="load")
            page.evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")
            locator = page.locator(args.selector)
            if locator.count() != 1:
                raise RuntimeError("截图选择器应恰好匹配 1 个元素：%s" % args.selector)

            checks = args.check or DEFAULT_CHECKS
            measurements = page.evaluate(
                """selectors => selectors.flatMap(selector =>
                    Array.from(document.querySelectorAll(selector)).map((el, index) => ({
                        selector,
                        index,
                        tag: el.tagName.toLowerCase(),
                        text: (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 100),
                        scrollWidth: el.scrollWidth,
                        clientWidth: el.clientWidth,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight,
                        overflowX: el.scrollWidth > el.clientWidth,
                        overflowY: el.scrollHeight > el.clientHeight
                    })))""",
                checks,
            )
            missing = [s for s in checks
                       if not any(m["selector"] == s for m in measurements)]
            overflows = [m for m in measurements if m["overflowX"] or m["overflowY"]]
            report = {
                "html": str(html),
                "deviceScaleFactor": args.scale,
                "missingSelectors": missing,
                "overflows": overflows,
                "measurements": measurements,
            }
            print(json.dumps(report, ensure_ascii=False, indent=2))
            if args.report:
                report_path = Path(args.report).resolve()
                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_path.write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
            if missing or overflows:
                raise SystemExit(2)

            locator.screenshot(path=str(output), animations="disabled", scale="device")
            print("saved: %s" % output)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
