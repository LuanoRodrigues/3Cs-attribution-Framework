#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RBENV_ROOT="$ROOT_DIR/.local/rbenv"
LIBYAML_PREFIX="$ROOT_DIR/.local/libyaml"

if [ ! -d "$RBENV_ROOT" ]; then
  echo "AnyStyle is not installed yet. Run: $ROOT_DIR/scripts/install_anystyle_local.sh" >&2
  exit 1
fi

export RBENV_ROOT
export PATH="$RBENV_ROOT/bin:$PATH"
export LD_LIBRARY_PATH="$LIBYAML_PREFIX/lib:${LD_LIBRARY_PATH:-}"

eval "$(rbenv init - bash)"

exec anystyle "$@"
