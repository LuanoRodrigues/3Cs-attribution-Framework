# AnyStyle in annotarium

This project uses a local Ruby runtime (no sudo) under `annotarium/.local` for AnyStyle.

## Install

```bash
cd annotarium
./scripts/install_anystyle_local.sh
```

This installs:
- `rbenv` at `annotarium/.local/rbenv`
- local `libyaml` at `annotarium/.local/libyaml`
- Ruby `3.3.10`
- gems: `anystyle` and `anystyle-cli`

## Use

```bash
cd annotarium
./scripts/anystyle.sh --help
./scripts/anystyle.sh --version
```

Parse references from a text file:

```bash
cd annotarium
./scripts/anystyle.sh --stdout -f json parse /path/to/references.txt
```

Notes:
- `anystyle parse` expects file input (not raw inline string).
- For inline testing, write one reference per line to a temp file first.
