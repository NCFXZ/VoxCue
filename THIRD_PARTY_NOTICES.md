# Third-party and asset notices

The root [LICENSE](LICENSE) applies to VoxCue's original software code. It does not replace upstream licenses or grant rights in third-party models, trademarks, system symbols, or artwork. Preserve the applicable copyright notices and license texts when redistributing those materials.

## Vendored source

| Source | Upstream revision | License and retained notices |
| --- | --- | --- |
| [qwen3-asr-rs](https://github.com/alan890104/qwen3-asr-rs) | `c5ef09646af6278d2ba8b8ceaf543ffb32d1a5dc` | MIT; Copyright (c) 2025 alan890104. The original [LICENSE](shared/native/qwen-speech/vendor/qwen3-asr/LICENSE) is retained. |
| [qwen-aligner-rs](https://github.com/eclipse005/qwen-aligner-rs) | `bb8c73ba670d65b3f5fddc5f5b8791bc07d4392a` | MIT as declared in the upstream [README at this revision](https://github.com/eclipse005/qwen-aligner-rs/blob/bb8c73ba670d65b3f5fddc5f5b8791bc07d4392a/README.md). The [vendored README](shared/native/qwen-speech/vendor/qwen-aligner/README.md) is retained; that upstream revision has no separate LICENSE file. |

VoxCue-specific changes and the fixed upstream provenance are documented in [the native runtime README](shared/native/qwen-speech/README.md). Vendoring does not change these projects' licenses or authorship.

## Dependencies and runtimes

JavaScript dependencies and Rust crates retain their own licenses. Exact versions are recorded in the platform pnpm locks and [Cargo.lock](shared/native/qwen-speech/Cargo.lock). The following are notable direct dependencies, not a complete inventory of transitive dependencies:

| Dependency | Upstream license |
| --- | --- |
| React, Radix UI, GitHub Copilot SDK, KaTeX, ONNX Runtime | MIT |
| OpenAI Codex, Transformers.js, LanceDB, sherpa-onnx, sharp | Apache-2.0 |
| Mammoth | BSD-2-Clause |
| WebRTC AEC3 JavaScript port | BSD-3-Clause |

Keep the license and notice files from the exact dependency/runtime distributions. A package's top-level license does not replace the terms for embedded third-party libraries, fonts, codecs, or GPU runtimes. Account access and hosted AI services remain subject to the respective providers' service terms.

## Model and component archives

Model weights and separately distributed native runtimes are not relicensed under VoxCue's AGPL license. Component archives contain their own licenses, notices, and provenance; keep those files and the archives' original bytes when mirroring Releases. Fixed filenames and hashes are recorded in [the component catalog](shared/electron/backend/components/catalog.ts) and its Qwen catalogs.

Examples include Apache-2.0 notices for the Paraformer/sherpa and Qwen resources, MIT notices for Silero VAD, and separate licenses for embedding models and runtime dependencies. NVIDIA CUDA components retain their NVIDIA terms. Consult the particular archive and upstream model card rather than applying one license to all assets.

## Icons, brands, and illustrations

- Fluent UI System Icons used by the Windows interface are from [Microsoft's icon project](https://github.com/microsoft/fluentui-system-icons), under its [MIT license](https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE).
- `shared/src/assets/copilot.svg` and `github.svg` use [Primer Octicons](https://github.com/primer/octicons), under its [MIT license](https://github.com/primer/octicons/blob/main/LICENSE). The notices and permission text for these icon projects are reproduced below.
- Mac SF Symbols are obtained from AppKit on the build machine for the Mac interface. They remain subject to [Apple's SF Symbols terms](https://developer.apple.com/sf-symbols/); generated symbol assets are not part of the repository's AGPL grant.
- The OpenAI/ChatGPT mark identifies the connected service. OpenAI owns those marks; their use is governed by [OpenAI's brand guidelines](https://openai.com/brand/), not this project's software license. GitHub and other third-party names and marks likewise remain with their owners. VoxCue does not imply their endorsement.
- The VoxCue name, source logo, and derived brand images are outside the software-code license grant. No trademark license is granted by publishing this repository.
- User-supplied artwork, including `shared/src/assets/interview-easter-egg.jpg`, is outside the software-code license grant. The three generated story illustrations and asset provenance are described in [the asset README](shared/src/assets/README.md); publication does not expand third-party or reference-image rights.

### MIT notices for Fluent UI System Icons and Primer Octicons

Fluent UI System Icons: Copyright (c) 2020 Microsoft Corporation.

Primer Octicons: Copyright (c) 2026 GitHub Inc.

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
