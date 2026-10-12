#!/usr/bin/env python3
"""
组合晴雨表 · 渲染器
把 barometer.js 的输出 JSON 渲染成：
  ① 静态 PNG（1080×1920，可作 IG 单图 / Reel 封面）
  ② 带动效的 MP4（1080×1920，默认 20 秒，无声——口播和音乐在剪映里叠加）

用法：
  python3 render.py --data sample-output.json --obs "本周组合观察一句话" --out out
  可选：--seconds 20  --disc "教育分享 · 非投资建议"  --no-video

依赖：pip install playwright（并有 Chromium）；ffmpeg。
"""
import argparse, json, os, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = "file://" + os.path.join(HERE, "barometer-card.html")
W, H = 1080, 1920


def init_script(data, obs, disc, static):
    return (f"window.BAROMETER={json.dumps(data, ensure_ascii=False)};"
            f"window.OBS={json.dumps(obs, ensure_ascii=False)};"
            f"window.DISC={json.dumps(disc, ensure_ascii=False)};"
            f"window.STATIC={'true' if static else 'false'};"
            f"window.RENDERER=true;")


def open_page(pw, data, obs, disc, static):
    b = pw.chromium.launch()
    pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    pg.add_init_script(init_script(data, obs, disc, static))
    pg.goto(TEMPLATE, wait_until="networkidle")
    pg.evaluate("document.fonts.ready.then(()=>true)")
    pg.wait_for_timeout(300)
    return b, pg


def render_png(pw, data, obs, disc, out_png):
    b, pg = open_page(pw, data, obs, disc, True)
    pg.screenshot(path=out_png)
    b.close()


def render_mp4(pw, data, obs, disc, out_mp4, seconds, fps=30):
    """逐帧确定性渲染：每帧调用 renderAt(t) 后截图，帧时间与机器快慢无关。"""
    tmp = tempfile.mkdtemp()
    b, pg = open_page(pw, data, obs, disc, False)
    n = int(round(seconds * fps))
    for i in range(n):
        pg.evaluate(f"renderAt({i / fps:.5f})")
        pg.screenshot(path=os.path.join(tmp, f"f{i:05d}.jpg"), type="jpeg", quality=95)
    b.close()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                    "-i", os.path.join(tmp, "f%05d.jpg"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart",
                    out_mp4], check=True)
    shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--obs", required=True, help="组合观察（一句话，由 Claude 生成）")
    ap.add_argument("--out", default="out")
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--disc", default="教育分享 · 非投资建议")
    ap.add_argument("--no-video", action="store_true")
    a = ap.parse_args()
    data = json.load(open(a.data, encoding="utf-8"))
    os.makedirs(a.out, exist_ok=True)
    stem = f"barometer-{(data.get('week_ending') or 'week')}"
    with sync_playwright() as pw:
        render_png(pw, data, a.obs, a.disc, os.path.join(a.out, stem + ".png"))
        if not a.no_video:
            render_mp4(pw, data, a.obs, a.disc, os.path.join(a.out, stem + ".mp4"), a.seconds)
    print("done →", a.out)


if __name__ == "__main__":
    main()
