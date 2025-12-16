# syntax = docker/dockerfile:1

# Ajustar NODE_VERSION según se desee
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

# Instalar las dependencias de sistema requeridas por 'canvas'
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        libwebp-dev \
        # Estas son dependencias comunes para 'canvas'
        libpng-dev

# Node.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Instalar dependencias
COPY package.json ./
# Asegurarse de que npm install se ejecute DESPUÉS de instalar las dependencias nativas
RUN npm install

# Copiar código de la aplicación
COPY . .

# Iniciar el servidor por defecto
EXPOSE 3000
CMD [ "npm", "run", "start" ]
