# Development Setup

How to set up the project from scratch, even if you've never worked with Node.js.

## 1. Install nvm

[nvm](https://github.com/nvm-sh/nvm) (Node Version Manager) lets you install and switch Node.js versions easily.

**Linux / macOS / WSL:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

Then restart your terminal.

**Windows (native):**

Use [nvm-windows](https://github.com/coreybutler/nvm-windows/releases) — download and run the installer.

## 2. Install Node.js

The project has an `.nvmrc` file in the root, so:

```bash
nvm install
nvm use
```

Verify:
```bash
node -v   # should be v24.x
npm -v    # should be 10.x+
```

## 3. Install dependencies

```bash
npm install
```

## 4. Verify

```bash
npm run build   # compiles TypeScript
npm run dev     # starts dev server on http://localhost:6074
```
