# build.spec — PyInstaller spec for LiveStocksTracker
# Run: pyinstaller build.spec

import os

block_cipher = None
here = os.path.abspath(".")

a = Analysis(
    ["server.py"],
    pathex=[here],
    binaries=[],
    datas=[
        ("index.html", "."),
        ("styles.css", "."),
        ("app.js", "."),
    ],
    hiddenimports=[
        "yfinance",
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
    ],
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
