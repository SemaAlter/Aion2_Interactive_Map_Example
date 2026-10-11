FROM node:22-alpine
WORKDIR /app
COPY dist ./dist
COPY server.mjs package.json ./
ENV HOST=0.0.0.0 PORT=4179 NODE_ENV=production
USER node
EXPOSE 4179
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4179/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
