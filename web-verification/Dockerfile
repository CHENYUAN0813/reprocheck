FROM node:24.14.0-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /opt/browser
RUN npm install --ignore-scripts --no-audit --no-fund playwright@1.64.0 && npx playwright install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/* /root/.npm
RUN mkdir /evidence && chown node:node /evidence
COPY browser.mjs /opt/browser/browser.mjs
COPY planner-browser.mjs /opt/browser/planner-browser.mjs
COPY rumor-browser.mjs /opt/browser/rumor-browser.mjs
LABEL org.reprocheck.rumor-acceptance="1"
COPY npm-browser.mjs /opt/browser/npm-browser.mjs
LABEL org.reprocheck.npm-acceptance="1"
USER node
CMD ["node", "/opt/browser/browser.mjs"]

LABEL org.reprocheck.services="1"
