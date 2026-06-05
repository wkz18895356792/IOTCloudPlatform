# Device Gateway Service Dockerfile
# Unified MQTT Gateway + Protocol Adapter

FROM node:18-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY ../../common/shared-utils ./common/shared-utils
COPY ../../common/shared-types ./common/shared-types

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Expose port
EXPOSE 6010

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O- http://localhost:6010/health || exit 1

# Start the service
CMD ["npm", "start"]
