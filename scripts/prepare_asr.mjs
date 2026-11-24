// 本机语音识别要的文件（决策 0027）：只给安卓 App 用，不进仓库。
//   android/app/libs/sherpa-onnx.aar                       sherpa-onnx 的安卓库（Apache-2.0）
//   android/app/src/main/assets/sensevoice/model.int8.onnx  SenseVoice-Small int8，2024-07-17 版（FunASR 模型协议，要署名）
//   android/app/src/main/assets/sensevoice/tokens.txt
// 下载的原始文件缓存在 .cache/asr/，已经有就不再下载。用法：npm run asr:assets
import { execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'asr')
const VERSION = '2.0.3'
const AAR_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/sherpa-onnx-${VERSION}.aar`
const MODEL_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_DIR}.tar.bz2`

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  )

async function download(url, dest) {
  if (await exists(dest)) return dest
  await mkdir(dirname(dest), { recursive: true })
  console.log(`下载 ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`下载失败 ${res.status}: ${url}`)
  const tmp = `${dest}.part`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  await copyFile(tmp, dest)
  await rm(tmp)
  return dest
}

const aar = await download(AAR_URL, join(CACHE, `sherpa-onnx-${VERSION}.aar`))
const libs = join(ROOT, 'android', 'app', 'libs')
await mkdir(libs, { recursive: true })
await copyFile(aar, join(libs, 'sherpa-onnx.aar'))

await download(MODEL_URL, join(CACHE, `${MODEL_DIR}.tar.bz2`))
const extracted = join(CACHE, MODEL_DIR)
if (!(await exists(join(extracted, 'model.int8.onnx')))) {
  console.log('解压模型…')
  // Windows 10 起自带的 tar（bsdtar）、Git Bash 的 tar 都能解 bz2。
  // 用相对路径：Git Bash 的 tar 会把 "D:" 当成远程主机名
  execFileSync('tar', ['-xjf', `${MODEL_DIR}.tar.bz2`], {
    cwd: CACHE,
    stdio: 'inherit',
  })
}
const assets = join(
  ROOT,
  'android',
  'app',
  'src',
  'main',
  'assets',
  'sensevoice',
)
await mkdir(assets, { recursive: true })
for (const f of ['model.int8.onnx', 'tokens.txt'])
  await copyFile(join(extracted, f), join(assets, f))
console.log('本机语音识别的文件准备好了')
