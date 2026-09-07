# Harness image, not an agent runtime and not proof of sandbox isolation.
FROM oven/bun:1.4.2 AS build
WORKDIR /build
COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/dist /opt/wringer
RUN ln -s /opt/wringer/wring /usr/local/bin/wring && ln -s /opt/wringer/wringer-board /usr/local/bin/wringer-board && ln -s /opt/wringer/wringer-drive /usr/local/bin/wringer-drive
WORKDIR /workspace
USER 65532:65532
ENTRYPOINT ["wring"]
CMD ["--help"]
