import path from 'node:path';
import { access } from 'node:fs/promises';
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Embedder } from './types';
export class LocalEmbedder implements Embedder {
  private pipe?: FeatureExtractionPipeline;
  private loading?: Promise<void>;
  constructor(private modelPath: string) {}
  initialize() {
    return (this.loading ??= this.load().catch((error) => {
      this.loading = undefined;
      throw error;
    }));
  }
  private async load() {
    try {
      await access(path.join(this.modelPath, 'onnx/model_quantized.onnx'));
    } catch {
      throw Error('本地知识库模型未安装，请先在本地组件中下载并完成校验。原件已保留。');
    }
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    this.pipe = await pipeline('feature-extraction', this.modelPath, {
      dtype: 'q8',
      device: 'cpu',
      local_files_only: true,
      session_options: { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential' },
    });
  }
  count(text: string, kind: 'query' | 'passage') {
    if (!this.pipe) throw Error('Embedding 未初始化。');
    return this.pipe.tokenizer(`${kind}: ${text}`, { truncation: false }).input_ids.size;
  }
  async encode(texts: string[], kind: 'query' | 'passage', signal: AbortSignal) {
    await this.initialize();
    signal.throwIfAborted();
    if (texts.some((text) => this.count(text, kind) > 512))
      throw Error('检索文本超过 512 tokens，拒绝静默截断。');
    const output = await this.pipe!(
      texts.map((text) => `${kind}: ${text}`),
      { pooling: 'mean', normalize: true },
    );
    signal.throwIfAborted();
    return (output.tolist() as number[][]).map((vector) => {
      if (vector.length !== 384 || vector.some((v) => !Number.isFinite(v)))
        throw Error('Embedding 返回无效向量。');
      const norm = Math.hypot(...vector);
      if (!norm) throw Error('Embedding 返回零向量。');
      return vector.map((v) => Math.fround(v / norm));
    });
  }
  async close() {
    await this.loading?.catch(() => {});
    await this.pipe?.dispose();
    this.pipe = undefined;
    this.loading = undefined;
  }
}
