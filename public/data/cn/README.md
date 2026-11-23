# 中国的查表数据

照片线索查表用（决策 0014 补充）：整理照片时模型抄下电话号码和车牌，前端用这几张表查出城市。
三份文件原样取自 [geo-sleuth](https://github.com/Oldcircle/geo-sleuth)（MIT）的 `skills/geo-sleuth/regions/cn/data/`，
2026-11-23 下载；每个文件的 `_meta` 里记着原始来源和抓取日期。

| 文件              | 内容                     | 原始来源                                                                                                | 协议         |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------ |
| `area_codes.json` | 固话区号 → 省、市        | 中文维基百科"中国大陆固定电话区号"，整理：geo-sleuth                                                    | CC BY-SA 4.0 |
| `plates.json`     | 车牌前缀 → 省、市        | 中文维基百科"中华人民共和国民用机动车号牌"，整理：geo-sleuth                                            | CC BY-SA 4.0 |
| `admin.json`      | 省、市、区县三级行政区划 | [modood/Administrative-divisions-of-China](https://github.com/modood/Administrative-divisions-of-China) | WTFPL        |

两份 CC BY-SA 4.0 的数据保持原协议，再分发或修改后也要用同样的协议并注明出处；这条只约束这两份数据本身，
不影响项目代码的 MIT 协议。
