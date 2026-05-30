# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Installation

```bash
yarn
```

## Local Development

```bash
yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

Using SSH:

```bash
USE_SSH=true yarn deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.

For GitHub Actions, the repository is configured to follow Docusaurus' recommended flow: pull requests to `main` run a build-only `test-deploy` check, and pushes to `main` publish the generated site to `gh-pages`. After enabling GitHub Pages to serve from the `gh-pages` branch, every push to `main` will update the site automatically.

If you prefer to deploy locally, use the npm scripts from this repo:

```bash
npm run build
npm run deploy
```
