# CodeMonkey + Harness Pro introduction

This folder is a standalone Next.js App Router application using Tailwind CSS 4 and shadcn/ui components. It introduces CodeMonkey and Harness Pro without starting either backend or copying Harness Pro source into this repository.

## Local development

From this folder:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Run `npm run lint` and `npm run build` before publishing. The production build exports a static `out/` directory.

## Vercel

Import the CodeMonkey GitHub repository as a **new Vercel project**. Set its **Root Directory** to `site`; Vercel should detect Next.js. Use the package scripts for install and build (`npm install` and `npm run build`). The site has no environment variables and does not proxy the orchestrator API.

The project cards and setup guides link to the CodeMonkey and Harness Pro GitHub repositories. The current clean CodeMonkey repository uses Claude Code workers in Docker; Harness Pro integration is described as a next step.
