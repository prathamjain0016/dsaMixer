#!/bin/sh
# One-command entry point: sets up .venv when needed, then runs `python -m dsamixer <args>`.
set -e
cd "$(dirname "$0")"
# Needs Python 3.10+ (macOS or Linux; on Windows use WSL).
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
  echo "dsaMixer needs Python 3.10 or newer (python3 not found or too old)." >&2
  exit 1
fi
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# (Re)install packages on first run and whenever requirements.txt has changed since the last install.
if [ ! -f .venv/.installed ] || [ requirements.txt -nt .venv/.installed ]; then
  .venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
  touch .venv/.installed
fi
[ $# -eq 0 ] && set -- serve
exec .venv/bin/python -m dsamixer "$@"
