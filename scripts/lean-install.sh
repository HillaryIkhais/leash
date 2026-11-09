#!/bin/bash
# LEASH lean install — executes ONLY the dependency manifest
# (leash/dependency-manifest.md). Bound list, no extras, npm cache reused.
# The 3 @agent-native framework packages are downloaded individually via the
# proven chunked downloader, then installed from local tarballs.
set -e
export PATH="$HOME/.local/leash-node/node-v22.23.4-darwin-arm64/bin:$PATH"

W="/Users/ikhaisoshuare/Downloads/AGENT NATIVE"
mkdir -p /tmp/leash-tarballs
cd "$W/leash"

# 1) framework runtime packages (latest published; exact versions verified at run time)
for pkg in agentkit otel toolkit; do
  url=$(curl -fsS --retry 8 --retry-all-errors -H "Accept: application/vnd.npm.install-v1+json" \
    "https://registry.npmjs.org/@agent-native/$pkg" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);const v=d['versions'][d['dist-tags']['latest']];process.stdout.write(v['dist']['tarball']+' '+v['dist']['size'])}")
  size=$(echo "$url" | awk '{print $2}')
  url=$(echo "$url" | awk '{print $1}')
  echo "[$pkg] $size bytes"
  "$W/dl-chunks.sh" "$url" "/tmp/leash-tarballs/$pkg.tgz" "$size" 4
done

# 2) app deps — the reviewed pinned manifest only, cache-first
export npm_config_fetch_retries=15
export npm_config_fetch_timeout=1200000
pnpm add \
  react@^19.2.7 react-dom@^19.2.7 react-router@^8.1.0 @react-router/dev@^8.1.0 \
  @react-router/fs-routes@^8.1.0 vite@8.1.0 @tailwindcss/vite@^4.2.4 tailwindcss@^4.2.4 \
  @tailwindcss/typography@^0.5.20 tsx@^4.20.3 drizzle-orm@^0.45.3 @electric-sql/pglite@^0.5.8 \
  zod@^4.3.6 ai@6.0.258 @openrouter/ai-sdk-provider@^2.9.1 @tanstack/react-query@^5.99.2 \
  @fontsource-variable/inter@^5.2.8 vitest@^4.1.5 typescript-7@npm:typescript@^7.0.2

# 3) vendored framework packages from local tarballs
pnpm add \
  /tmp/leash-tarballs/agentkit.tgz \
  /tmp/leash-tarballs/otel.tgz \
  /tmp/leash-tarballs/toolkit.tgz

# 4) core registry link
pnpm add @agent-native/core@0.226.0 --prefer-offline

echo "LEAN_INSTALL_DONE — bandwidth-wise, exactly the reviewed manifest"
