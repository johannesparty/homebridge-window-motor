#!/usr/bin/env bash
#
# Updates the homebridge-window-motor plugin on the homebridge host and
# restarts Homebridge.
#
# Default behavior (no arguments): build the plugin from this checkout,
# pack a tarball, scp it to the homebridge host, install it, and restart
# Homebridge. No npm registry, no npm login, no version bumps required.
# This is the fast path for iterating on local changes.
#
# Usage:
#   ./scripts/update-homebridge.sh                  # build local + install (default)
#   ./scripts/update-homebridge.sh beta             # install @beta from npm registry
#   ./scripts/update-homebridge.sh latest           # install @latest from npm
#   ./scripts/update-homebridge.sh 0.7.7-beta.4     # install exact version from npm
#
# Environment variables:
#   HOMEBRIDGE_SSH    SSH target (default: root@192.168.5.33).
#                     Set to e.g. "johannes@192.168.5.33" with SUDO=sudo
#                     if you don't have root SSH set up.
#   SUDO              "" by default (root SSH needs no sudo prefix).
#                     Set to "sudo" if connecting as non-root.

set -euo pipefail

HOMEBRIDGE_SSH="${HOMEBRIDGE_SSH:-root@192.168.5.33}"
SUDO="${SUDO:-}"
PACKAGE="homebridge-window-motor"

cyan()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
red()   { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

# Run the install + restart sequence on the remote host. $1 is the npm install
# argument (either a registry spec like "homebridge-window-motor@beta" or a
# tarball path like "/tmp/foo.tgz").
remote_install_and_restart() {
  local install_spec="$1"

  ssh -o BatchMode=yes "${HOMEBRIDGE_SSH}" "bash -s" <<EOF
set -euo pipefail

echo "→ Installing ${install_spec}..."
${SUDO} npm install -g "${install_spec}"

echo
echo "→ Installed version:"
${SUDO} npm ls -g "${PACKAGE}" --depth=0 2>/dev/null || true

echo
echo "→ Restarting Homebridge..."
${SUDO} hb-service restart

sleep 3

echo
echo "→ Service status:"
${SUDO} systemctl status homebridge --no-pager 2>/dev/null | head -8 || true
EOF
}

# --- Mode selection -----------------------------------------------------------

if [ $# -gt 0 ]; then
  # Install from npm registry.
  TAG="$1"
  cyan "→ Installing ${PACKAGE}@${TAG} from npm registry on ${HOMEBRIDGE_SSH}..."
  remote_install_and_restart "${PACKAGE}@${TAG}"
  green "→ Done."
  exit 0
fi

# Default: build local checkout, pack, scp, install.
cd "$(dirname "$0")/.."

cyan "→ Building local checkout (tsc + UI lib copy)..."
npm run build >/dev/null

cyan "→ Packing tarball..."
TARBALL="$(npm pack 2>/dev/null | tail -1)"
if [ ! -f "${TARBALL}" ]; then
  red "npm pack did not produce a tarball; aborting."
  exit 1
fi
green "  Packed: ${TARBALL}"

cleanup_local() {
  rm -f "${TARBALL}"
}
trap cleanup_local EXIT

cyan "→ Copying tarball to ${HOMEBRIDGE_SSH}:/tmp/${TARBALL}..."
scp -q "${TARBALL}" "${HOMEBRIDGE_SSH}:/tmp/${TARBALL}"

cyan "→ Installing on ${HOMEBRIDGE_SSH}..."
remote_install_and_restart "/tmp/${TARBALL}"

# Best-effort cleanup of the tarball on the remote box.
ssh -o BatchMode=yes "${HOMEBRIDGE_SSH}" "rm -f /tmp/${TARBALL}" || true

green "→ Done."
