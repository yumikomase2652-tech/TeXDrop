FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs latexmk texlive-luatex texlive-lang-japanese texlive-latex-extra \
    texlive-fonts-recommended \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin compiler
WORKDIR /app
COPY --chown=compiler:compiler services/compiler-api/server.mjs ./server.mjs

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    COMPILER_RUNTIME=native \
    MAX_CONCURRENT=2

USER compiler
EXPOSE 10000
CMD ["node", "server.mjs"]
