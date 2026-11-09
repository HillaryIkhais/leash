#!/bin/sh
# LEASH installer — from a fresh checkout to a runnable app.
#
# Reconciles the dependency manifest with package.json in one step: the
# committed pnpm-lock.yaml pins every version, so a frozen install is
# byte-for-byte the reviewed set. No `latest` fetches, no local paths.
set -eu

REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MIN="22.22.0"

# 1) Node >= 22.22 (engines requirement) — musl and glibc both fine.
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node.js >= $REQUIRED_NODE_MIN (https://nodejs.org)" >&2
  exit 1
fi
NODE_VER=$(node -p 'process.versions.node')
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "error: node $NODE_VER is too old; LEASH needs >= $REQUIRED_NODE_MIN" >&2
  exit 1
fi
echo "[1/3] node $NODE_VER ok"

# 2) pnpm via corepack (version pinned by package.json#packageManager).
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[2/3] enabling corepack pnpm"
  corepack enable
  corepack prepare pnpm@10.29.1 --activate
else
  echo "[2/3] pnpm $(pnpm --version) ok"
fi

# 3) Frozen install — the lockfile IS the dependency manifest.
echo "[3/3] installing pinned dependency set"
pnpm install --frozen-lockfile

# 4) Verify the security core offline (no build required).
pnpm test

echo "LEASH_INSTALL_DONE — run 'pnpm dev' (app) or 'pnpm demo' (enforcement demo)"
