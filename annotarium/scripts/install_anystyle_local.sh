#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RBENV_ROOT="$ROOT_DIR/.local/rbenv"
LIBYAML_PREFIX="$ROOT_DIR/.local/libyaml"
SRC_DIR="$ROOT_DIR/.local/src"

mkdir -p "$SRC_DIR"

# Local libyaml is required so Ruby can build psych without system packages.
if [ ! -f "$LIBYAML_PREFIX/lib/libyaml.so" ]; then
  cd "$SRC_DIR"
  if [ ! -f yaml-0.2.5.tar.gz ]; then
    curl -fL -o yaml-0.2.5.tar.gz https://github.com/yaml/libyaml/releases/download/0.2.5/yaml-0.2.5.tar.gz
  fi
  rm -rf yaml-0.2.5
  tar -xzf yaml-0.2.5.tar.gz
  cd yaml-0.2.5
  ./configure --prefix="$LIBYAML_PREFIX"
  make -j"$(nproc)"
  make install
fi

if [ ! -d "$RBENV_ROOT" ]; then
  git clone https://github.com/rbenv/rbenv.git "$RBENV_ROOT"
fi
mkdir -p "$RBENV_ROOT/plugins"
if [ ! -d "$RBENV_ROOT/plugins/ruby-build" ]; then
  git clone https://github.com/rbenv/ruby-build.git "$RBENV_ROOT/plugins/ruby-build"
fi

export RBENV_ROOT
export PATH="$RBENV_ROOT/bin:$PATH"
eval "$(rbenv init - bash)"
export CPPFLAGS="-I$LIBYAML_PREFIX/include"
export LDFLAGS="-L$LIBYAML_PREFIX/lib"
export PKG_CONFIG_PATH="$LIBYAML_PREFIX/lib/pkgconfig"
export LD_LIBRARY_PATH="$LIBYAML_PREFIX/lib:${LD_LIBRARY_PATH:-}"

RUBY_VERSION="3.3.10"
RUBY_CONFIGURE_OPTS="--disable-install-doc --with-libyaml-dir=$LIBYAML_PREFIX" rbenv install -s "$RUBY_VERSION"
rbenv global "$RUBY_VERSION"

gem install anystyle anystyle-cli --no-document
rbenv rehash

anystyle --version
