#!/bin/sh
# Brings up her screen, the web view of it, and then the runner itself.
set -e

if [ -z "$AVA_ADMIN_PASSWORD" ]; then
  echo "AVA_ADMIN_PASSWORD is not set. It protects the web view of her screen — which is"
  echo "a signed-in Google account — so the container refuses to start without one."
  exit 1
fi

mkdir -p /data
# A crashed Chrome leaves its lock behind in the profile, and the next Chrome refuses to
# open it. Nothing else is running yet, so any lock here is stale.
rm -f "$AVA_PROFILE_DIR/SingletonLock" "$AVA_PROFILE_DIR/SingletonSocket" "$AVA_PROFILE_DIR/SingletonCookie" 2>/dev/null || true

# Her screen.
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
sleep 1
fluxbox >/dev/null 2>&1 &

# The web view of it. VNC listens on localhost only; the only way in from outside is
# through websockify, which demands the admin password. Served over the host's HTTPS.
# -xkb: without it, capital letters and symbols typed through the web view come out
# wrong or not at all — noVNC sends key symbols, and on a non-US keyboard (French
# AZERTY here) Shift never reached Chrome, so a Google password could not be typed.
x11vnc -display :99 -localhost -forever -shared -nopw -quiet -rfbport 5900 -xkb -noxrecord -noxfixes -noxdamage >/dev/null 2>&1 &
websockify --web /usr/share/novnc \
  --auth-plugin websockify.auth_plugins.BasicHTTPAuth \
  --auth-source "ava:$AVA_ADMIN_PASSWORD" \
  --web-auth \
  "${PORT:-8080}" localhost:5900 >/dev/null 2>&1 &

echo "Her screen: https://<this-host>/vnc.html  (user: ava, password: AVA_ADMIN_PASSWORD)"

exec node watch.mjs
