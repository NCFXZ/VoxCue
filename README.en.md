# VoxCue

[简体中文](README.md) | English

VoxCue is a desktop interview preparation assistant for Windows and macOS. Organize materials around your résumé and job description, prepare interview skills, and use live transcription, AI answers, and interview history to support practice and review.

[GitHub repository](https://github.com/NCFXZ/VoxCue) · [Download installers and local components](https://github.com/NCFXZ/VoxCue/releases)

## Features

- **Interview preparation:** Add your résumé, job description, and attachments to discuss your experience, projects, and target role with AI.
- **Generate and update skills:** Build interview knowledge and talking points from your résumé and job description. Review and save changes individually, keeping reference knowledge separate from your actual experience.
- **AI services:** Sign in with ChatGPT or GitHub Copilot. Windows 1.3.0 also supports API keys from eight AI providers. Web search availability depends on the connection and model. Preparation chats use selected knowledge bases only when explicitly requested.
- **Live interview assistance:** Transcribe system audio and microphone input separately. View questions and answers in an always-on-top window, or ask questions using text and screenshots.
- **Hidden from screen sharing:** With capture protection enabled, the interview window stays visible to you while being hidden from the shared screen, so other participants cannot see its contents. This requires support from the operating system and sharing software.
- **Interview history:** Review transcripts, answers, and screenshots, with navigation, renaming, and export tools.
- **Profile and knowledge bases:** Manage personal information and source documents, use local retrieval when needed, and enable cloud backup separately for your profile, interview history, and knowledge bases.
- **Interface and content display:** Choose Simplified Chinese or English and light, dark, or system appearance. Chat and interview answers support LaTeX equations and matrices.

## Notes

- **System requirements:** Windows 10 / 11 (64-bit) or macOS 14.2 or later (Apple Silicon).
- **Accounts and usage:** VoxCue is free to use. AI features require a connection to a supported service, which determines account eligibility and usage limits. You can skip VoxCue sign-in to use local mode; cloud backup requires a VoxCue account.
- **Local components:** Download speech-recognition and document-retrieval components from the app's settings as needed. Check audio devices and required permissions before starting an interview.
- **Data and privacy:** Speech recognition runs locally. Automatic interview recording is off by default on Windows 1.3.0. Starting a recording manually or enabling automatic recording saves WAV files in the current account’s local interview history. Cloud backups exclude these recordings. AI requests include the text and relevant excerpts needed for the task, plus attachments or screenshots you choose to submit.
- **Local storage:** Login credentials and API keys use system encryption. Personal information, interview records, imported originals, recordings and saved screenshots have no application-level encryption at rest. Source icons request the cited website's hostname from a fixed icon service, without page paths, query parameters or chat text.
- **Copilot sign-out:** The official SDK may share system credentials with the standalone Copilot CLI. Signing out of VoxCue ends its local session without deleting shared credentials. Revoke GitHub authorization separately in GitHub settings.
- **Usage statistics:** Basic statistics contain limited information such as action categories, timestamps, and numeric values. They exclude chat and transcript content, source files, audio, screenshots, and access tokens.
- **Content review:** AI-generated materials and answers may contain errors. Review them before saving or using them, and avoid presenting reference knowledge as your own experience.

## Development

Run `corepack pnpm install --frozen-lockfile` inside the host platform directory (`macos/` or `windows/`). After installation, run `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build:shared`, or `corepack pnpm dev` from the repository root; commands dispatch to the host platform.

See the [workspace layout](shared/docs/WORKSPACE_LAYOUT.md), [architecture](shared/docs/ARCHITECTURE.md), and [test entry points](shared/test/README.md). Install dependencies only inside the host platform directory and keep the other platform read-only.

## License

Copyright 2026 VoxCue contributors.

VoxCue's original software code is licensed under the [GNU Affero General Public License, version 3 only (AGPL-3.0-only)](LICENSE). No permission to use a later license version is granted.

Commercial use, modification, and distribution are permitted. When distributing the program or a derivative version, provide its Corresponding Source to recipients under the license. If users interact with a modified version over a network, offer those users the Corresponding Source for that version. Local use, private modifications, or merely using the program do not by themselves require publishing personal data, output, or unrelated code. The software is provided without warranty; the full license governs the exact rights and obligations.

Third-party dependencies, models, system symbols, brand assets, and illustrations retain their respective licenses and rights. They are not relicensed under AGPL by this repository. The VoxCue name, logo, and user-supplied artwork are outside this software-code license grant. See [third-party and asset notices](THIRD_PARTY_NOTICES.md).
