FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs latexmk texlive-luatex texlive-lang-japanese texlive-latex-extra \
    texlive-fonts-recommended \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/tex-cache /tmp/texmf-var /tmp/texmf-config /tmp/xdg-cache \
  && HOME=/tmp TEXMFVAR=/tmp/texmf-var TEXMFCONFIG=/tmp/texmf-config \
     TEXMFCACHE=/opt/tex-cache XDG_CACHE_HOME=/tmp/xdg-cache \
     luaotfload-tool --update --force \
  && rm -rf /tmp/texmf-var /tmp/texmf-config /tmp/xdg-cache

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin compiler
WORKDIR /app
COPY --chown=compiler:compiler services/compiler-api/server.mjs ./server.mjs

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    COMPILER_RUNTIME=native \
    TEX_CACHE_SEED=/opt/tex-cache \
    MAX_CONCURRENT=2

USER compiler
EXPOSE 10000
CMD ["node", "server.mjs"]
