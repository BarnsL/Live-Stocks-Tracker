#!/usr/bin/env bash
# Live Stocks Tracker — Linux launcher
# Usage: chmod +x run-linux.sh && ./run-linux.sh

set -e
cd "$(dirname "$0")"

if ! command -v python3 &>/dev/null; then
  echo "Python 3 is required. Install with: sudo apt install python3 python3-venv python3-pip"
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "Installing dependencies..."
pip install -q -r requirements.txt

echo "Starting Live Stocks Tracker..."
python3 server.py
