#!/bin/sh
# One-command entry point: sets up .venv when needed, then runs `python -m dsamixer <args>`.
set -e
cd "$(dirname "$0")"
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
