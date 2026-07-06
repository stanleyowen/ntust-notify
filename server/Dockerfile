# Use the slim, secure Alpine-based Node image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# We copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Reproducible production-only install from the lockfile (skips nodemon)
RUN npm ci --omit=dev

# Bundle app source (secrets excluded via .dockerignore)
COPY . .

# Drop root privileges — the app only needs to bind a port and make
# outbound requests.
USER node

# Your app binds to 3000 by default (per your code)
EXPOSE 3000

# Run the app
CMD [ "npm", "start" ]