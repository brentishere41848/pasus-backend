FROM node:20-alpine
WORKDIR /app

# Install dependencies (dev deps needed for TypeScript build)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build TS -> dist
RUN npm run build && npm prune --production

ENV PORT=4000
EXPOSE 4000
CMD ["npm","run","start"]
