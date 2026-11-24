# 0017 安装包正式化：签名、版本号、图标（第四档 4A）

- 状态：已定并实现（2026-11-24）。方案和备选见决策 0015 的"4A"一节，用户选了"先做 4A"，按推荐做；
  图标的生成方式和推荐的不一样，原因见第 3 条。

## 1. 正式签名（0015 的 A）

- 用 JDK 自带的 keytool 生成：RSA 4096 位，PKCS12 格式，有效期 10000 天（约 27 年）。
  证书名只写项目名（`CN=footprint-journal`），不写个人信息，因为证书会随安装包公开。
- 脚本 `scripts/make_keystore.py`，只跑一次。口令随机生成 32 位，不打印出来；密钥已存在时拒绝覆盖。
- 密钥放在仓库外：`C:\Users\Lenovo\.footprint-journal-signing\`，里面有：
  - `footprint-release.jks`：密钥。
  - `keystore.properties`：口令。
  - `README.txt`：说明。
- Gradle 读 `android/keystore.properties`（脚本同时写了一份，不进 git）。
  没有这个文件时，正式版不签名，调试版照常用调试签名。
- `.gitignore` 加了 `android/keystore.properties`、`*.jks`、`*.keystore`。
- 打包：`npm run app:release`，要先设好 `JAVA_HOME`。
  输出在 `android/app/build/outputs/apk/release/app-release.apk`。
- 证书 SHA-256：`f99e8542ebd3d1819b509afdc5527f91dc065a01ee0d0498ae620c46c8e9b212`。
  以后核对安装包是不是自己签的，看这个指纹。

**要用户做的**：

- 把签名文件夹整个备份到别处（网盘、U 盘）。丢了就再也发不了能覆盖安装的更新，只能让所有人卸载重装。
- 第一次装正式版前，先在旧的调试版里导出备份；卸载旧版，装新版，再导入备份。签名不同，不能覆盖安装。

## 2. 版本号（0015 的 A）

- `package.json` 的 version 是唯一来源，从 0.0.0 改成 1.0.0。
- Gradle 读它：versionName 就是这个字符串，versionCode = 主×10000 + 次×100 + 修订（1.0.0 → 10000）。
  之前的调试版 versionCode 是 1，新号更大。
- 网页通过 Vite 的 `define` 拿到同一个版本号（`src/appVersion.ts`），显示在偏好页最底下："足迹手账 v1.0.0"。
- 发新版时只改 `package.json` 这一处：修 bug 加修订号，加功能加次版本号。

## 3. 图标（换了做法：不用 `@capacitor/assets`，自己写脚本生成）

图案是一张 17×17 的像素画（`scripts/make_icons.py` 里的 `ART`）：

- 一左一右两只深紫黑的脚印错开，读作"足迹"，左上角一颗柠檬黄小星星。
- 底色是草莓粉。颜色由 `src/index.css` 的 oklch 值换算过来，和界面一致（决策 0010）。
- 画了三版：
  - 第一版是白色带描边的单只脚印：脚趾和星星挤成一团。
  - 第二版拉开了间距：还是糊。
  - 最后改成实心脚印，小尺寸也看得清。

**为什么不用 0015 推荐的 `@capacitor/assets`**：

- 它用插值缩放，像素画的边缘会糊。
- 它还要装一个带原生二进制（sharp）的依赖。

自己写的脚本只用本机已有的 Pillow，每个像素放大成整数倍的方块。

| 备选                          | 结论 / 原因                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------- |
| **自己写脚本（Pillow）**      | **选定**。像素边缘锐利；尺寸算成整数倍；不加依赖；改图案只要改 `ART` 再跑一次 |
| `@capacitor/assets`           | 插值缩放会把像素画缩糊；要装 sharp                                            |
| Android Studio 的 Image Asset | 要手动点；网页图标另外做；同样会缩放                                          |

**生成的东西**：

- 安卓自适应图标（安卓 8+）：
  - 前景画布 108dp，按 27 格画，每种密度都是整数倍（108/162/216/324/432 像素 = 27 × 4/6/8/12/16）。
  - 17 格的图案放在中间 66dp 的安全区里，各种形状的遮罩都裁不到。
- 安卓 13 的"主题图标"：单色层 `ic_launcher_monochrome`。
- 老版本安卓：方形和圆形图标，48dp 按 24 格画。圆形的边缘也是台阶状的像素。
- 启动画面：
  - 安卓 11 及以下用 `splash.png`：奶油底，图标居中。
  - 安卓 12 起由系统画（图标加底色），在 `styles.xml` 加了 `windowSplashScreenBackground`，用奶油色。
- 网页：`public/favicon.svg`（换掉了 Vite 默认图标）。另存一份 `public/icon-512.png`，留给以后的"添加到主屏幕"（0015 的 4D）。

## 验证

- 正式版打包成功，28.0 MB。
- 用 `apksigner verify` 核对：签名者是 `CN=footprint-journal`，指纹见上。
- 用 `aapt2 dump badging` 核对：versionCode 10000，versionName 1.0.0，名称"足迹手账"。
- 测试 171 个全部通过；类型检查、代码检查、格式检查都通过。
- 构建产物里偏好页的版本号是 1.0.0。
- 没验证：还没装到手机上看图标、启动画面和安装流程。
