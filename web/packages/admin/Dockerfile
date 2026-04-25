FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV ADMIN_DASHBOARD_BASE_PATH=/admin-dashboard
ENV ADMIN_DASHBOARD_DIST_DIR=/app/dist
ENV ADMIN_DASHBOARD_PORT=8080

COPY dist ./dist
COPY server ./server

EXPOSE 8080

CMD ["node", "server/admin-dashboard-server.mjs"]
