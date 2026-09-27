# Ava's body, as a container: a real Google Chrome on a virtual screen, the runner that
# walks her into meetings, and a password-protected web view of that screen — which is
# how she is signed in once, and how you can watch her in a meeting.
#
# Runs anywhere Docker does. It needs roughly 2 vCPU and 4 GB of RAM, and a persistent
# volume at /data, or she is signed out every time the container restarts.

FROM node:22-bookworm-slim

# Google Chrome itself (not Chromium: Google trusts it, and Meet supports it fully), a
# virtual display for it to draw on, a minimal window manager, and the VNC + noVNC pair
# that turns that display into a web page.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget gnupg ca-certificates \
 && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      google-chrome-stable \
      xvfb x11vnc fluxbox \
      novnc python3-websockify \
      fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
      tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm install --no-save --no-audit --no-fund esbuild@0.25
COPY . .
# A checkout on Windows can hand this a start.sh with CRLF endings, which Linux then
# refuses to run ("bad interpreter"). Normalise it rather than rely on Git settings.
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh && node build.mjs

ENV DISPLAY=:99 \
    AVA_CONTAINER=1 \
    AVA_PROFILE_DIR=/data/chrome-profile \
    AVA_STATE_DIR=/data \
    PORT=8080

VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./start.sh"]
