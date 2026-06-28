"""Monitor resolution shared by the CV detectors.

`--monitor auto` resolves to the monitor Dota 2 is currently on: locate the game
window via Win32, take its rectangle, and match the rect centre against the mss
monitor list. Falls back to the primary monitor when the window isn't found
(game not running yet). An explicit `--monitor N` skips all of this.
"""

import ctypes
import sys
from ctypes import wintypes

import mss

DOTA_PROCESS_NAME = "dota2.exe"
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _process_name(pid: int) -> str:
    # Имя exe процесса по его PID. Дота определяется именно по процессу
    # (dota2.exe), а не по заголовку окна — папка «Dota 2» в Проводнике
    # или вкладка браузера не дадут ложного совпадения.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(260)
        buf = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return ""
        # Полный путь → только имя файла: C:\...\dota2.exe → dota2.exe
        return buf.value.rsplit("\\", 1)[-1].lower()
    finally:
        kernel32.CloseHandle(handle)


def _find_dota_hwnd():
    # Перебираем все окна и возвращаем дескриптор (hwnd) того, что принадлежит
    # процессу dota2.exe. None — если Дота не запущена.
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    # GetWindowRect отдаёт физические пиксели только если процесс DPI-aware;
    # mss тоже работает в физических пикселях, так что приводим обе системы
    # координат к одной (иначе при масштабировании экрана центр окна уехал бы).
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [enum_proc, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL

    match: list[int] = []

    # Колбэк EnumWindows: вызывается на каждое окно. return True = продолжать
    # перебор, False = остановиться (нашли нужное).
    def _on_window(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value and _process_name(pid.value) == DOTA_PROCESS_NAME:
            match.append(hwnd)
            return False
        return True

    user32.EnumWindows(enum_proc(_on_window), 0)
    return match[0] if match else None


def _window_center(hwnd):
    # Центр прямоугольника окна (физические пиксели виртуального рабочего стола).
    # Берём центр, а не угол: окно, заехавшее краем на соседний экран, всё равно
    # отнесётся к монитору, где находится его бо́льшая часть.
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    return (rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2


def _primary_monitor(sct) -> int:
    # Основной монитор — тот, чей левый-верхний угол в начале координат (0, 0).
    for i, m in enumerate(sct.monitors[1:], 1):
        if m["left"] == 0 and m["top"] == 0:
            return i
    return 1


def find_dota_monitor(sct) -> int | None:
    """Индекс монитора mss (1-based), на котором сейчас окно Доты, либо None."""
    hwnd = _find_dota_hwnd()
    if not hwnd:
        return None
    center = _window_center(hwnd)
    if center is None:
        return None
    cx, cy = center
    # point-in-rectangle: ищем монитор, в чьи границы попадает центр окна.
    # sct.monitors[0] — это все экраны вместе, поэтому перебираем с [1:].
    # Индекс не привязан к позиции (его задаёт ОС), но он и не важен сам по себе —
    # это просто ключ в тот же список, из которого потом снимается скриншот.
    for i, m in enumerate(sct.monitors[1:], 1):
        if m["left"] <= cx < m["left"] + m["width"] and m["top"] <= cy < m["top"] + m["height"]:
            return i
    return None


def resolve_monitor(arg) -> int:
    """Превращает значение --monitor ('auto' или число) в конкретный индекс mss."""
    # Явный номер — ручной override, поиск окна пропускаем.
    if str(arg).lower() != "auto":
        return int(arg)
    with mss.mss() as sct:
        found = find_dota_monitor(sct)
        if found is not None:
            print(f"[screen] Dota 2 window on monitor {found}", file=sys.stderr)
            return found
        # Дота не запущена — снимать нечего, но возвращаем валидный индекс.
        primary = _primary_monitor(sct)
        print(f"[screen] Dota 2 window not found; using primary monitor {primary}", file=sys.stderr)
        return primary
