# 第三方数据、模型、字体和代码

项目自己的代码用 MIT 协议（见 `LICENSE`）。下面这些是打包进网页和安卓 App 的别人的东西，各自保留原来的协议。
协议核对于 2026-11-24（决策 0018 第 1 条）。

## 数据和模型

这些文件都在 `public/` 下。除了 `public/data/cn/`，其余都不进仓库，由 `npm run assets`（`scripts/prepare_assets.mjs`）下载生成。

| 内容                       | 用在哪                             | 来源                                                                                                    | 协议                     |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| 全球省州边界               | 记录在哪个省州、地图点亮、离线底图 | [Natural Earth](https://www.naturalearthdata.com/) 1:10m admin-1                                        | 公有领域                 |
| 中国区县边界               | 记录在哪个区县、地图点亮           | [geoBoundaries](https://www.geoboundaries.org/) gbOpen CHN ADM2（原始来源：Revolutionary GIS）          | ODC-PDDL 1.0（公有领域） |
| 语义搜索模型 bge-small-zh  | 本机语义搜索                       | [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)，用 Xenova 转好的 ONNX 量化版   | MIT                      |
| onnxruntime-web 的 wasm    | 在浏览器里跑上面的模型             | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime)                                       | MIT                      |
| 固话区号表、车牌前缀表     | 照片线索查城市                     | 中文维基百科，由 [geo-sleuth](https://github.com/Oldcircle/geo-sleuth) 整理                             | **CC BY-SA 4.0**（见下） |
| 省、市、区县三级行政区划表 | 城市名、照片线索查城市             | [modood/Administrative-divisions-of-China](https://github.com/modood/Administrative-divisions-of-China) | WTFPL                    |

**两份 CC BY-SA 4.0 的表**（`public/data/cn/area_codes.json`、`plates.json`）保持原协议。
再分发或修改这两个文件，要用同样的协议并注明出处（中文维基百科、geo-sleuth）。
这条只约束这两份数据，不影响项目代码的 MIT 协议。详情见 `public/data/cn/README.md`。

## 字体

| 内容                                    | 用在哪                       | 来源                                                                      | 协议                                                    |
| --------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| 缝合像素字体 Fusion Pixel 12px 简体中文 | 界面标题、按钮、标签，分享图 | [TakWolf/fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font) | SIL Open Font License 1.1（`src/assets/fonts/OFL.txt`） |

## 地图瓦片和地名

国内（决策 0021）：

- 地图瓦片：高德地图，地图右下角有署名。
- 地名查询、地点搜索、行政区边界：服务端用高德 Web 服务（需要自己申请 key，个人非商业使用有免费额度，条款以高德开放平台为准）。

国外：

不打包，运行时在线使用：

- 地图瓦片：OpenStreetMap，© OpenStreetMap 贡献者，数据协议 ODbL。地图右下角有署名。
- 地名查询：服务端转发到 OpenStreetMap 的 Nominatim。遵守它的使用政策：每秒最多 1 次，带可识别的 User-Agent，结果缓存。

## 主要代码依赖

完整列表见 `package.json`，协议以各自包里的为准。打进网页的主要有：

| 包                               | 协议         |
| -------------------------------- | ------------ |
| React、Hono、Zod、exifr、fflate  | MIT          |
| Leaflet                          | BSD-2-Clause |
| leaflet.markercluster            | MIT          |
| Dexie、@huggingface/transformers | Apache-2.0   |
| Capacitor（安卓外壳）            | MIT          |
