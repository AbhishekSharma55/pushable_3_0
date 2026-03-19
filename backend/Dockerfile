FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.26.2 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
RUN npm install -g @bitwarden/cli

COPY . .

EXPOSE 4000

CMD ["sh", "start.sh"]
