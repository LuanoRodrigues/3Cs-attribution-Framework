#!/usr/bin/env bash
set -euo pipefail

sudo cp -f /etc/wsl.conf "/etc/wsl.conf.bak.codex.$(date +%s)" 2>/dev/null || true
sudo cp -f /etc/resolv.conf "/etc/resolv.conf.bak.codex.$(date +%s)" 2>/dev/null || true

cat <<'EOF' | sudo tee /etc/wsl.conf >/dev/null
[network]
generateResolvConf = false
EOF

cat <<'EOF' | sudo tee /etc/resolv.conf >/dev/null
nameserver 1.1.1.1
nameserver 8.8.8.8
options timeout:2 attempts:2 rotate
EOF

echo "Applied:"
sudo cat /etc/wsl.conf
echo
sudo cat /etc/resolv.conf
echo
echo "Now restart WSL from Windows PowerShell:"
echo "  wsl --shutdown"
echo "Then re-open this project and rerun coding."
