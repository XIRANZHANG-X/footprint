/// <reference lib="webworker" />
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers'

// 本地语义搜索（决策 0014 第 3A 条）：在后台线程里跑中文向量模型，不卡界面。
// 模型和 wasm 都打包在 App 里（public/models、public/ort），完全离线，文字不出手机。

const BASE = import.meta.env.BASE_URL
const MODEL = 'Xenova/bge-small-zh-v1.5'

env.allowRemoteModels = false
env.allowLocalModels = true
// 必须是路径而不是完整网址：transformers.js 只对"不是网址"的本地路径检查模型文件在不在
env.localModelPath = `${BASE}models/`
// 默认会从 CDN 下载 wasm，改成 App 自带的那份（只跑 CPU 的版本，见 scripts/prepare_assets.mjs）
const ortWasm = env.backends.onnx.wasm
if (ortWasm) {
  ortWasm.wasmPaths = {
    mjs: `${new URL(`${BASE}ort/ort-wasm-simd-threaded.mjs`, self.location.origin)}`,
    wasm: `${new URL(`${BASE}ort/ort-wasm-simd-threaded.wasm`, self.location.origin)}`,
  }
}

let extractor: Promise<FeatureExtractionPipeline> | null = null
const getExtractor = () =>
  (extractor ??= pipeline('feature-extraction', MODEL, {
    dtype: 'q8',
    device: 'wasm',
  }) as Promise<FeatureExtractionPipeline>)

export type EmbedRequest = { id: number; texts: string[] }
export type EmbedResponse =
  { id: number; vectors: Float32Array[] } | { id: number; error: string }

self.onmessage = async (e: MessageEvent<EmbedRequest>) => {
  const { id, texts } = e.data
  try {
    const run = await getExtractor()
    // bge 用 [CLS] 位置的向量，归一化后点积就是余弦相似度
    const out = await run(texts, { pooling: 'cls', normalize: true })
    const dim = out.dims[out.dims.length - 1]
    const data = out.data as Float32Array
    const vectors = texts.map((_, i) => data.slice(i * dim, (i + 1) * dim))
    self.postMessage({ id, vectors } satisfies EmbedResponse)
  } catch (err) {
    extractor = null
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies EmbedResponse)
  }
}
