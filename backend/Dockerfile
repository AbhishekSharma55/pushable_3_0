FROM node:22-alpine

RUN npm install -g pnpm@10.26.2

# Install Python3 + scientific packages for agent code execution
RUN apk add --no-cache python3 py3-pip py3-numpy py3-scipy py3-pandas py3-matplotlib py3-sympy py3-pillow py3-requests py3-seaborn

# Install pure-Python packages for document/file generation
RUN pip3 install --break-system-packages --no-cache-dir fpdf2 openpyxl beautifulsoup4 python-docx tabulate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
RUN npm install -g @bitwarden/cli

COPY . .

EXPOSE 4000

CMD ["sh", "start.sh"]
