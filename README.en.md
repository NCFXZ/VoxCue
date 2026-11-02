# VoxCue

[简体中文](README.md) | English

VoxCue is a desktop interview preparation assistant for Windows and macOS. Prepare using your résumé and job description, build interview skills, and review sessions with live transcription, AI answers, and interview history.

[User guide](https://voxcue.com.cn/install/) · [Downloads and updates](https://github.com/NCFXZ/VoxCue-releases/releases) · [Report an issue](https://github.com/NCFXZ/VoxCue-releases/issues)

## Download

| Platform | Current installer | Requirements |
| --- | --- | --- |
| Windows | [0.6.7 · x64 EXE](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.7/VoxCue-Setup-0.6.7-x64.exe) | Windows 10 / 11, 64-bit |
| macOS | [0.6.6 · Apple Silicon DMG](https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.6.6/VoxCue-0.6.6-arm64.dmg) | macOS 14.2 or later, M-series chip |

Version 0.6.7 is a Windows release. Mac 0.6.7 is not yet available. Each platform checks for its own complete, stable release. For a first installation, download only the EXE or DMG; the app uses the other files for updates.

## Features

- **Interview preparation:** Add your résumé, job description, and attachments to discuss your experience, projects, and target role. The home screen offers three next steps based on your profile.
- **Generate and update skills:** Build interview knowledge and talking points from your résumé and job description. Review and save changes individually, keeping reference knowledge separate from your actual experience.
- **AI services:** Connect ChatGPT or GitHub Copilot independently in Settings. The model can search the web when needed. Preparation chats use selected knowledge bases only when explicitly requested.
- **Live interview assistance:** Transcribe system audio and microphone input separately. View questions and answers in an always-on-top window, or ask questions using text and screenshots.
- **Interview history:** Review transcripts, answers, and screenshots, with navigation, renaming, and export tools.
- **Profile and knowledge bases:** Manage personal information and source documents, use local retrieval when needed, and enable cloud backup separately for your profile, interview history, and knowledge bases.
- **Chinese and English UI:** Switch between Simplified Chinese and English, with light, dark, and system appearance. Chat and interview answers support LaTeX equations and matrices.

## What's new in 0.6.7

- Added complete Chinese and English UI. The first launch follows your system language; manual choices are remembered.
- Simplified home-screen guidance and improved hover descriptions, English layouts, and control alignment.
- Improved skill generation, updates, and individual review, with an option to prepare relevant skills after completing your profile.
- Let the model decide when to search the web. Preparation chats use knowledge bases only on explicit request.
- Added equation rendering in chat and interviews, with smoother skill-detail and reasoning-progress expansion, collapse, and scrolling.
- Fixed UI, stability, and security issues.

[Full release notes (中文 / English)](https://github.com/NCFXZ/VoxCue-releases/releases/tag/v0.6.7)

## Get started

1. Install and open VoxCue. Create or sign in to a VoxCue account, or skip sign-in to use local mode.
2. Connect ChatGPT or GitHub Copilot in **Settings → AI services**. Download the required speech and retrieval components under **Local components**.
3. Add your résumé and job description, review the AI's proposed changes, and generate interview skills when ready.
4. Check your audio devices before starting an interview, then use transcription, questions, and answers in the interview window.

VoxCue is free to use. Account eligibility and usage limits for AI services are determined by those services. Cloud backup requires a VoxCue account; local mode still supports independent AI-service connections. See the [user guide](https://voxcue.com.cn/install/) for detailed instructions.

## Data and privacy

Speech recognition runs locally. Raw audio is neither saved nor uploaded. AI requests include the text and relevant excerpts needed for the task, plus attachments or screenshots you choose to submit. Cloud backups are enabled separately by the user. AI-service credentials are protected with system encryption in the main process.

Basic usage statistics contain limited action categories, timestamps, and numeric values. They exclude chat and transcript content, source files, audio, screenshots, and access tokens. See the [data and usage-statistics documentation](shared/docs/CLIENT_TELEMETRY.md).

## Development

The single version source is `shared/package.json`. Shared UI and business logic live in `shared/`; native integrations, dependencies, lockfiles, and builds are separate in `windows/` and `macos/`.

Install Node.js and the pnpm version declared by the project. From the repository root, synchronize configuration for the current platform:

```sh
pnpm sync:workspace
```

Enter your platform directory (`windows` on Windows or `macos` on Mac), then run:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Do not install dependencies at the repository root or in `shared/`, and do not generate files for the other platform. See the [Mac development guide](macos/docs/MACOS_PORT.md) for native build requirements.

From the repository root, run:

```sh
pnpm check:workspace
pnpm check:architecture
pnpm typecheck
pnpm test
```

For a Windows installer, run `pnpm package:installer` in `windows/`. It produces an EXE, a blockmap, and `latest.yml` without publishing them automatically.

[Architecture](shared/docs/ARCHITECTURE.md) · [Workspace](shared/docs/WORKSPACE_LAYOUT.md) · [Tests](shared/test/README.md) · [Current progress](PROGRESS.md) · [Mac 0.6.7 handoff checklist](shared/docs/MACOS_0.6.7_HANDOFF.md)
