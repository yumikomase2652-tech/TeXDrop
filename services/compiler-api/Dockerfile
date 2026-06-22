FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
# bxjsarticle needs type1cm.sty, so extract that 7 KB file without installing
# texlive-latex-extra. Keep only the two Harano Aji faces used by the MVP.
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs latexmk texlive-luatex texlive-lang-japanese texlive-latex-recommended \
  && mkdir -p /tmp/type1cm /usr/local/share/texmf/tex/latex/type1cm \
  && cd /tmp/type1cm \
  && apt-get download texlive-latex-extra \
  && dpkg-deb --extract texlive-latex-extra_*.deb extracted \
  && cp extracted/usr/share/texlive/texmf-dist/tex/latex/type1cm/type1cm.sty \
       /usr/local/share/texmf/tex/latex/type1cm/ \
  && find /usr/share/texlive/texmf-dist/fonts/opentype/public/haranoaji \
       -type f ! -name HaranoAjiMincho-Regular.otf \
       ! -name HaranoAjiGothic-Medium.otf -delete \
  && mktexlsr /usr/local/share/texmf \
  && rm -rf /tmp/type1cm \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin compiler \
  && mkdir -p /opt/tex-cache /tmp/texmf-var /tmp/texmf-config /tmp/xdg-cache \
  && chown -R compiler:compiler /opt/tex-cache /tmp/texmf-var /tmp/texmf-config /tmp/xdg-cache
COPY --chown=compiler:compiler services/compiler-api/cache-warmup.tex /tmp/cache-warmup/main.tex

# Generate luaotfload's font database once while building the image. Runtime
# jobs receive a copy of this immutable seed. The warmup also precompiles the
# Harano Aji and Latin Modern font data used by the Japanese MVP document.
RUN HOME=/tmp TEXMFVAR=/tmp/texmf-var TEXMFCONFIG=/tmp/texmf-config \
     TEXMFCACHE=/opt/tex-cache XDG_CACHE_HOME=/tmp/xdg-cache \
     runuser -u compiler -- luaotfload-tool --update --force --prefer-texmf \
  && HOME=/tmp TEXMFVAR=/tmp/texmf-var TEXMFCONFIG=/tmp/texmf-config \
     TEXMFCACHE=/opt/tex-cache XDG_CACHE_HOME=/tmp/xdg-cache \
     runuser -u compiler -- latexmk -lualatex -interaction=nonstopmode \
       -halt-on-error -file-line-error -no-shell-escape \
       -outdir=/tmp/cache-warmup /tmp/cache-warmup/main.tex \
  && chown -R root:root /opt/tex-cache \
  && chmod -R u=rwX,go=rX /opt/tex-cache \
  && rm -rf /tmp/cache-warmup /tmp/texmf-var /tmp/texmf-config /tmp/xdg-cache
WORKDIR /app
COPY --chown=compiler:compiler services/compiler-api/server.mjs ./server.mjs

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    COMPILER_RUNTIME=native \
    TEX_CACHE_SEED=/opt/tex-cache \
    MAX_CONCURRENT=1

USER compiler
EXPOSE 10000
CMD ["node", "server.mjs"]
