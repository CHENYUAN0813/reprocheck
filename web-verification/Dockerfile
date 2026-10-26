FROM node:24.14.0-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /opt/browser
RUN npm install --ignore-scripts --no-audit --no-fund playwright@1.64.0 && npx playwright install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/* /root/.npm
RUN mkdir /evidence && chown node:node /evidence
COPY browser.mjs /opt/browser/browser.mjs
COPY planner-browser.mjs /opt/browser/planner-browser.mjs
USER node
CMD ["node", "/opt/browser/browser.mjs"]
