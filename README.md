# Firewood

A browser-based firewood splitting simulator built with Next.js, Three.js, and
Cannon physics.

The project keeps the original chopping feel as the core interaction, then adds
light game systems around it: scoring, streaks, wood species, a stacked firewood
pile, and a winter transition with snowfall.

## Features

- Real-time 3D chopping scene powered by Three.js.
- Axe swing, log splitting, slice physics, and landing sounds.
- Score, accuracy, streak, and wood-species multipliers.
- Firewood pile that collects completed split pieces.
- Winter mode after enough successful splits, or immediately with `?winter=1`.
- Snowfall, frosted grass, winter lighting, and a fixed campfire scene element.
- Chinese in-game UI.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Three.js
- Cannon ES
- @wolffo/three-fire

## Getting Started

Install dependencies:

```bash
pnpm install
```

Run the development server:

```bash
pnpm dev
```

Open:

```text
http://localhost:3000
```

Force winter mode:

```text
http://localhost:3000/?winter=1
```

## Scripts

```bash
pnpm dev        # Start local development server
pnpm build      # Create production build
pnpm start      # Run production server
pnpm lint       # Run ESLint
pnpm typecheck  # Run TypeScript check
pnpm check      # Run lint, typecheck, and build
```

## Project Structure

```text
src/app/                    Next.js app entry
src/components/             React components
src/lib/firewood/           Three.js scene, gameplay, physics, audio, winter
public/firewood/            Models, textures, sounds, and runtime assets
docs/ASSET_LICENSES.md      Asset source and license notes
```

## Deployment

The app is configured for GitHub Pages static deployment. Every push to `main`
runs the Pages workflow and publishes the static export from `out/`.

Production URL:

```text
https://promptwhisper.github.io/firewood/
```

If this is the first Pages deployment for the repository, open GitHub repository
settings, go to `Pages`, and set the source to `GitHub Actions`.

## Disclaimer / 免责声明

This project is an independent, non-commercial study and technical demonstration
created for learning and research only. It is not affiliated with, endorsed by,
or an official release of the original website or its creators.

本项目为独立的非商业学习与技术研究作品，仅用于学习、交流和演示。项目与原网站及其
创作者不存在隶属、授权或官方合作关系。请勿将本项目及其中的第三方素材用于侵权、
商业销售、付费分发或其他未经权利人许可的用途。

Original experience / 原站地址:

https://screen.toys/firewood/

All trademarks, product names, visual designs, models, textures, audio, and other
third-party materials belong to their respective owners. If any content
infringes your rights, please open an issue and it will be reviewed and removed
promptly.

所有商标、产品名称、视觉设计、模型、贴图、音频及其他第三方素材的权利均归其各自
权利人所有。如相关内容侵犯了您的合法权益，请提交 Issue 联系处理，核实后将及时
修改或删除。

## License

The original source code in this repository is available under the MIT License.
See `LICENSE`. This license does not grant any rights to third-party assets,
branding, or content. See `docs/ASSET_LICENSES.md` for asset notes.
