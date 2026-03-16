# build.spec — PyInstaller spec for LiveStocksTracker
# Run: pyinstaller build.spec

import os
from PyInstaller.utils.hooks import collect_all, collect_data_files

block_cipher = None
here = os.path.abspath(".")

# Collect all data files, binaries, and hidden imports for tricky packages
_extras_datas = []
_extras_binaries = []
_extras_hiddenimports = []

for pkg in ["certifi", "curl_cffi", "yfinance", "pytz", "dateutil"]:
    try:
        d, b, h = collect_all(pkg)
        _extras_datas += d
        _extras_binaries += b
        _extras_hiddenimports += h
    except Exception:
        pass

a = Analysis(
    ["server.py"],
    pathex=[here],
    binaries=_extras_binaries,
    datas=[
        ("index.html", "."),
        ("styles.css", "."),
        ("app.js", "."),
        ("local_model.py", "."),
    ] + _extras_datas,
    hiddenimports=[        "local_model",        "yfinance",
        "pandas",
        "numpy",
        "requests",
        "urllib3",
        "certifi",
        "charset_normalizer",
        "idna",
        "beautifulsoup4",
        "bs4",
        "soupsieve",
        "curl_cffi",
        "frozendict",
        "peewee",
        "platformdirs",
        "multitasking",
        "pytz",
        "dateutil",
        "protobuf",
    ] + _extras_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "PIL"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="LiveStocksTracker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    icon=None,
)
