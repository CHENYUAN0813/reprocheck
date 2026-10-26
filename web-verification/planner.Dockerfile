FROM node:24.14.0-bookworm-slim AS node
FROM python:3.12.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && useradd --create-home --uid 1000 runner
USER runner
WORKDIR /tmp
CMD ["sleep", "600"]
