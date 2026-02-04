# Use Node.js LTS
FROM node:18-alpine

# Install dependencies for sharp (image processing)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p uploads output

# Expose port
EXPOSE 3000

# Set environment variable
ENV NODE_ENV=production
ENV PORT=3000

# Start the application
CMD ["node", "index.js"]
