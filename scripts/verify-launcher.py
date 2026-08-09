#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动器验收脚本（规范见 docs/LAUNCHER-CHECKLIST.md 第 4 节）

用法:  python scripts/verify-launcher.py
前置:  3000-3009 端口必须全部空闲。脚本启动前会检查，若有占用直接中止，
       避免误碰用户正在运行的实例。
退出码: 全部 PASS 为 0，任何 FAIL 为 1。

实现要点（都是踩过的坑，勿改）:
- HTTP 探测用 curl 访问 localhost，不用 urllib 连 127.0.0.1
  （Vite 只绑定 IPv6 [::1]，IPv4 探测会永远失败）。
- 启动器以"附加控制台"方式拉起（不用 DETACHED_PROCESS），
  与真实双击场景一致；分离模式下 PowerShell 行为会失真。
- 设 PV_NO_BROWSER=1 跳过自动开浏览器分支。
- 停止用 taskkill /T /F 杀整棵进程树，并在结束后确认无残留监听。
"""
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BAT = ROOT / "启动图片批注查看器.bat"
LOCK = Path(os.environ["TEMP"]) / "pv_launcher.lock"

RESULTS = []


def report(name, ok, detail=""):
    RESULTS.append((name, ok))
    suffix = f"  ({detail})" if detail else ""
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{suffix}")


def listeners():
    """返回 [(port, pid), ...]，仅看 3000-3009 的 LISTENING。"""
    out = subprocess.run(["netstat", "-ano"], capture_output=True).stdout.decode("gbk", "ignore")
    return re.findall(r":(300\d)\s+\S+\s+LISTENING\s+(\d+)", out)


def curl_ok(port):
    try:
        r = subprocess.run(
            ["curl", "-s", "-o", "NUL", "-w", "%{http_code}", f"http://localhost:{port}/"],
            capture_output=True, timeout=5,
        )
        return r.stdout == b"200"
    except Exception:
        return False


def start_launcher():
    env = dict(os.environ, PV_NO_BROWSER="1")
    return subprocess.Popen(
        ["cmd", "/c", str(BAT)], cwd=str(ROOT), env=env, stdin=subprocess.DEVNULL
    )


def kill_tree(pid):
    subprocess.run(["cmd", "/c", f"taskkill /PID {pid} /T /F"], capture_output=True)


def wait_up(timeout=30):
    """等待任意 300x 端口可 curl 通，返回 (port, 秒数) 或 (None, timeout)。"""
    for i in range(timeout):
        for port, _pid in listeners():
            if curl_ok(port):
                return port, i + 1
        time.sleep(1)
    return None, timeout


def byte_checks():
    d = BAT.read_bytes()
    report("字节自检: 全部 CRLF，无裸 LF", d.count(b"\n") == d.count(b"\r\n"))
    bad_ctrl = [b for b in d if b < 0x20 and b not in (0x09, 0x0D, 0x0A)]
    report("字节自检: 无控制字符（如 \\x0b）", not bad_ctrl, f"发现 {bad_ctrl[:5]}" if bad_ctrl else "")
    try:
        d.decode("cp936")
        report("字节自检: GBK 可完整解码", True)
    except UnicodeDecodeError as e:
        report("字节自检: GBK 可完整解码", False, str(e))
    report("字节自检: 无 /dev/null 篡改", b"/dev" + b"/null" not in d)


def scenario_a():
    """正常启动：服务就绪、锁与端口文件正确、停止后端口释放。"""
    shutil.rmtree(LOCK, ignore_errors=True)  # 每个场景从干净锁状态开始
    proc = start_launcher()
    try:
        port, secs = wait_up()
        report("场景A: 正常启动且页面可访问", port is not None, f"{secs}s, port={port}")
        if not port:
            return
        report("场景A: 锁目录已创建", LOCK.is_dir())
        port_file = LOCK / "port"
        content = port_file.read_text().strip() if port_file.exists() else ""
        report("场景A: 锁内端口记录与实际一致", content == port, f"锁={content} 实际={port}")
    finally:
        kill_tree(proc.pid)
        time.sleep(1.5)
    report("场景A: 停止后端口全部释放", not listeners())


def scenario_b():
    """重复启动：检测到已在运行、不启动第二个服务。"""
    shutil.rmtree(LOCK, ignore_errors=True)  # 清理上一场景强杀留下的残留锁
    proc_a = start_launcher()
    try:
        port, _ = wait_up()
        if not port:
            report("场景B: 前置实例启动", False)
            return
        env = dict(os.environ, PV_NO_BROWSER="1")
        r = subprocess.run(
            ["cmd", "/c", str(BAT)], cwd=str(ROOT), env=env,
            input=b"\n", capture_output=True, timeout=60,
        )
        out = r.stdout.decode("gbk", "ignore")
        report("场景B: 重复启动被拦截并提示已在运行", "已在运行" in out and "正在启动服务" not in out)
        report("场景B: 仍只有一个服务实例", len(listeners()) == 1, f"listeners={listeners()}")
    finally:
        kill_tree(proc_a.pid)
        time.sleep(1.5)


def scenario_c():
    """残留锁：强制关闭（锁未清理）后重启，能识别并清理残留锁正常启动。"""
    # 此时锁是上一步强制 kill 留下的（设计如此：窗口被关时 bat 没机会清理）
    if LOCK.is_dir():
        old = time.time() - 120  # 老化时间戳，跳过"刚启动"保护期
        os.utime(LOCK, (old, old))
    proc = start_launcher()
    try:
        port, secs = wait_up()
        report("场景C: 残留锁被清理并正常启动", port is not None, f"{secs}s, port={port}")
    finally:
        kill_tree(proc.pid)
        time.sleep(1.5)
        shutil.rmtree(LOCK, ignore_errors=True)


def main():
    print("=" * 50)
    print(" 启动器验收  scripts/verify-launcher.py")
    print("=" * 50)

    if not BAT.exists():
        print(f"未找到启动器: {BAT}")
        return 1
    busy = listeners()
    if busy:
        print(f"中止: 3000-3009 存在占用 {busy}，请先关闭相关实例再验收（避免误碰）。")
        return 1
    shutil.rmtree(LOCK, ignore_errors=True)

    byte_checks()
    scenario_a()
    scenario_b()
    scenario_c()

    failed = [n for n, ok in RESULTS if not ok]
    print("-" * 50)
    print(f"结果: {len(RESULTS) - len(failed)}/{len(RESULTS)} 通过" + (f"，失败: {failed}" if failed else ""))
    leftovers = listeners()
    if leftovers:
        print(f"警告: 验收后仍有端口占用 {leftovers}，请手工清理！")
        return 1
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
