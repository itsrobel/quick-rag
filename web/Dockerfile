FROM node:alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm install
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]

