FROM docker.m.daocloud.io/node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies)
RUN npm config set registry https://registry.npmmirror.com && \
    npm install

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM docker.m.daocloud.io/node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm config set registry https://registry.npmmirror.com && \
    npm install --production

# Install curl for health check
RUN apk add --no-cache curl

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 6002

# Start the application
CMD ["node", "dist/index.js"]
