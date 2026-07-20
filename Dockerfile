FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
ENV DATABASE_URL=:memory: DATA_DIR=/tmp/telmi-build-data
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
RUN npm install --global @openai/codex@0.144.6
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/piper \
    && /opt/piper/bin/pip install --no-cache-dir piper-tts==1.4.2 \
    && mkdir -p /opt/piper/voices \
    && /opt/piper/bin/python -m piper.download_voices --data-dir /opt/piper/voices \
      fr_FR-gilles-low \
      fr_FR-mls-medium \
      fr_FR-mls_1840-low \
      fr_FR-siwis-low \
      fr_FR-siwis-medium \
      fr_FR-tom-medium \
      fr_FR-upmc-medium \
    && curl -fsSL https://raw.githubusercontent.com/DantSu/Telmi-Sync/master/extraResources/piper/voices/fr_FR-beatrice.onnx -o /opt/piper/voices/fr_FR-beatrice.onnx \
    && curl -fsSL https://raw.githubusercontent.com/DantSu/Telmi-Sync/master/extraResources/piper/voices/fr_FR-beatrice.onnx.json -o /opt/piper/voices/fr_FR-beatrice.onnx.json
ENV PIPER_PYTHON=/opt/piper/bin/python PIPER_VOICE_DIR=/opt/piper/voices CODEX_HOME=/data/codex-home
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --chown=nextjs:nodejs .agents/skills/imagegen /opt/telmi-skills/imagegen
COPY --chown=nextjs:nodejs .agents/skills/telmi-story-illustrator /opt/telmi-skills/telmi-story-illustrator
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
RUN mkdir -p /data && chown nextjs:nodejs /data
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0 DATABASE_URL=/data/telmi.db DATA_DIR=/data
CMD ["sh", "-lc", "mkdir -p \"$CODEX_HOME/skills\" && cp -R /opt/telmi-skills/imagegen /opt/telmi-skills/telmi-story-illustrator \"$CODEX_HOME/skills/\" && exec node server.js"]
