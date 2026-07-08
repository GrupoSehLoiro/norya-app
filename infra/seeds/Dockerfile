FROM node:20-alpine
WORKDIR /seeds

COPY package.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "seed-all.js"]
