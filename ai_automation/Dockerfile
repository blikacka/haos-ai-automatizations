# syntax=docker/dockerfile:1

# Multi-arch Home Assistant base image (Alpine 3.22 ships Node.js 22).
# Supervisor >= 2026.04.0 no longer passes BUILD_FROM, so the default is used;
# older Supervisors pass the per-arch image from build.yaml.
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.22
ARG CODEX_VERSION=0.154.0

# ---------------------------------------------------------------------------
# Stage 1: build the Node.js application (TypeScript server, tool and web UI)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS app-build

WORKDIR /build

COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY app/ ./
RUN npm run build \
    && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2: runtime tools (node, git, codex CLI) on the Home Assistant base
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM} AS runtime-base

ARG CODEX_VERSION

RUN apk add --no-cache \
        bash \
        ca-certificates \
        curl \
        git \
        jq \
        nodejs \
        npm \
        openssh-client \
        tzdata \
        usbutils \
    && npm install -g --no-audit --no-fund "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force \
    && codex --version \
    && git config --system --add safe.directory '*'

# ---------------------------------------------------------------------------
# Stage 3: final add-on image
# ---------------------------------------------------------------------------
FROM runtime-base

ARG BUILD_ARCH
ARG BUILD_VERSION

WORKDIR /opt/ai_automation

COPY --from=app-build /build/package.json ./package.json
COPY --from=app-build /build/node_modules ./node_modules
COPY --from=app-build /build/dist ./dist
COPY --from=app-build /build/agent ./agent
COPY --from=app-build /build/bin ./bin
COPY rootfs /

RUN chmod 755 /usr/bin/run.sh /opt/ai_automation/bin/* \
    && ln -sf /opt/ai_automation/bin/haos-tool /usr/local/bin/haos-tool

LABEL \
    io.hass.name="AI automatizace" \
    io.hass.description="AI assistant for Home Assistant configuration powered by OpenAI Codex" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.version="${BUILD_VERSION}" \
    maintainer="blikacka"

CMD ["/usr/bin/run.sh"]
