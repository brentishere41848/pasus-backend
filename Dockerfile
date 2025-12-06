FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Build TS -> dist
RUN npm run build

ENV PORT=4000
EXPOSE 4000
CMD ["npm","run","start"]
