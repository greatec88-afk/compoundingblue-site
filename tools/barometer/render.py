#!/usr/bin/env python3
"""
组合晴雨表 · 渲染器
把 barometer.js 的输出 JSON 渲染成：
  ① 静态 PNG（1080×1920，可作 IG 单图 / Reel 封面）
  ② 带动效的 MP4（1080×1920）
     - 给了 --audio：画面跟着配音走（自动从配音的停顿里测出 5 段的起点），音频直接合进 MP4
     - 没给 --audio：默认 25 秒无声版（按默认节奏，可在剪映里对着配音）

用法：
  python3 render.py --data sample-output.json --obs "组合观察一句话" --out out
  python3 render.py --data sample-output.json --obs "..." --audio voice.wav --out out
  可选：--cues 0,3,7,11,15,19.5（手动指定 6 段起点，覆盖自动检测）
        --seconds 25（无配音时的时长） --disc "教育分享 · 非投资建议"  --no-video

配音要求：一条完整音频，6 段（①钩子 ②进攻 ③基石 ④长寿 ⑤收益 ⑥看点+免责）之间各停顿约 0.5–0.8 秒。

依赖：pip install playwright（并有 Chromium）；ffmpeg。
"""
import argparse, json, os, re, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = "file://" + os.path.join(HERE, "barometer-card.html")
W, H = 1080, 1920
DEFAULT_CUES = [0, 3.0, 7.0, 11.0, 15.0, 19.5]
DEFAULT_SECONDS = 25
N_SEG = len(DEFAULT_CUES)
TAIL = 1.2          # 配音结束后画面多停留的秒数


def audio_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", path], capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def detect_cues(path, total):
    """找配音里最长的 N_SEG-1 个停顿 → 各段起点。找不到就按默认节奏等比缩放。"""
    log = subprocess.run(["ffmpeg", "-i", path, "-af", "silencedetect=noise=-38dB:d=0.3", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    gaps = [(e - s, s, e) for s, e in zip(starts, ends) if 0.8 < s and e < total - 0.5]
    if len(gaps) >= N_SEG - 1:
        top = sorted(sorted(gaps, reverse=True)[:N_SEG - 1], key=lambda g: g[1])
        return [0.0] + [round(g[2] - 0.05, 2) for g in top], "auto"
    k = total / DEFAULT_SECONDS
    return [round(c * k, 2) for c in DEFAULT_CUES], "scaled"


def init_script(data, obs, disc, static, cues=None, duration=None):
    js = (f"window.BAROMETER={json.dumps(data, ensure_ascii=False)};"
          f"window.OBS={json.dumps(obs, ensure_ascii=False)};"
          f"window.DISC={json.dumps(disc, ensure_ascii=False)};"
          f"window.STATIC={'true' if static else 'false'};"
          f"window.RENDERER=true;")
    if cues:
        js += f"window.CUES={json.dumps(cues)};window.DURATION={duration};"
    return js


def open_page(pw, script):
    b = pw.chromium.launch()
    pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    pg.add_init_script(script)
    pg.goto(TEMPLATE, wait_until="networkidle")
    pg.evaluate("document.fonts.ready.then(()=>true)")
    pg.wait_for_timeout(300)
    return b, pg


def render_png(pw, data, obs, disc, out_png):
    b, pg = open_page(pw, init_script(data, obs, disc, True))
    pg.screenshot(path=out_png)
    b.close()


def render_mp4(pw, data, obs, disc, out_mp4, seconds, cues=None, audio=None, fps=30):
    """逐帧确定性渲染：每帧调用 renderAt(t) 后截图，帧时间与机器快慢无关。"""
    tmp = tempfile.mkdtemp()
    b, pg = open_page(pw, init_script(data, obs, disc, False, cues, seconds))
    n = int(round(seconds * fps))
    for i in range(n):
        pg.evaluate(f"renderAt({i / fps:.5f})")
        pg.screenshot(path=os.path.join(tmp, f"f{i:05d}.jpg"), type="jpeg", quality=95)
    b.close()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", os.path.join(tmp, "f%05d.jpg")]
    if audio:
        cmd += ["-i", audio, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out_mp4]
    subprocess.run(cmd, check=True)
    shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--obs", required=True, help="组合观察（一句话，由文案模型生成）")
    ap.add_argument("--out", default="out")
    ap.add_argument("--seconds", type=float, default=DEFAULT_SECONDS)
    ap.add_argument("--audio", help="完整配音（wav/mp3/m4a），6 段之间留停顿")
    ap.add_argument("--cues", help="手动指定 6 段起点，如 0,3,7,11,15,19.5")
    ap.add_argument("--disc", default="教育分享 · 非投资建议")
    ap.add_argument("--no-video", action="store_true")
    a = ap.parse_args()
    data = json.load(open(a.data, encoding="utf-8"))
    os.makedirs(a.out, exist_ok=True)
    stem = f"barometer-{(data.get('week_ending') or 'week')}"

    cues, seconds = None, a.seconds
    if a.audio:
        dur = audio_duration(a.audio)
        seconds = round(dur + TAIL, 2)
        if a.cues:
            cues, how = [float(x) for x in a.cues.split(",")], "manual"
        else:
            cues, how = detect_cues(a.audio, dur)
        print(f"配音 {dur:.2f}s → 视频 {seconds:.2f}s；{N_SEG} 段起点（{how}）：{cues}")
    elif a.cues:
        cues = [float(x) for x in a.cues.split(",")]
    if cues and len(cues) != N_SEG:
        raise SystemExit(f"cues 必须是 {N_SEG} 个数")

    with sync_playwright() as pw:
        render_png(pw, data, a.obs, a.disc, os.path.join(a.out, stem + ".png"))
        if not a.no_video:
            render_mp4(pw, data, a.obs, a.disc, os.path.join(a.out, stem + ".mp4"), seconds, cues, a.audio)
    print("done →", a.out)


if __name__ == "__main__":
    main()
