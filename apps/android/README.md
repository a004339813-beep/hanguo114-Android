# 韩国114 / Korean114 安卓 App

原生 Android 壳，内容直接加载线上网站（`apps/m`），**网站更新 App 自动同步，不用重新发版**。
一套代码出两个 App：

| Flavor | 包名 | 打开的网址 | 桌面名称 |
|---|---|---|---|
| `hanguo114` | `com.hanguo114.app` | https://hanguo114.com | 韩国114 |
| `korean114` | `com.korean114.app` | https://korean114.com | Korean114 |

## 原生能力（网页做不到或体验差的部分）

- 📞 `tel:` 拨号、`sms:` 短信、`mailto:` 邮件 → 调起系统应用
- 🔗 站外链接 → 系统浏览器；`kakaotalk://`、`weixin://`、`intent://` 等 → 对应 App
- 📤 `navigator.share` → 原生分享面板（微信 / KakaoTalk / 短信…）
- 🖼 头像、简历等 `<input type="file">` 上传（支持多选）
- ⬅️ 返回键：先关网页弹窗/抽屉（history），再后退，首页时退到后台
- 📴 断网提示页 + 重新加载（中/英/韩/越 跟随系统语言）
- 🌗 深色模式跟随系统，状态栏颜色与网页一致；适配 Android 15 全面屏与键盘
- 🚀 启动页（首屏加载完才消失，最多 3 秒）
- 🔗 深链：`https://hanguo114.com/...`、`hanguo114://jobs/123`、`web+hanguo:` 都能直接打开 App
- 🙈 网页里的「添加到主屏幕 / 安装 PWA」引导在 App 内自动隐藏
- UA 追加 `JobInfinityApp/<版本> (<flavor>; Android)`，网页可据此判断运行环境；
  也可调用 `window.JobInfinityNative.platform()` / `.appVersion()`

## 打包方式一：GitHub 自动打包（不用装任何软件）

1. 把整个仓库推送到 GitHub（工作流在 `.github/workflows/android.yml`）
2. 打开仓库 → **Actions** → **Android APK** → **Run workflow**
3. 约 5 分钟后，在这次运行页面底部 **Artifacts** 下载：
   - `hanguo114-apk` → 韩国114 安装包
   - `korean114-apk` → Korean114 安装包
   - `google-play-aab` → 上架 Google Play 用的 .aab

未配置签名时用调试签名，**可以直接装到手机测试，但不能上架**。

## 打包方式二：Android Studio

1. 用 Android Studio 打开 `apps/android` 目录，等 Gradle 同步完成
2. 左下角 **Build Variants** 选 `hanguo114Debug` 或 `korean114Debug`
3. 连接手机点 ▶️ 运行；或菜单 **Build → Build APK(s)**

命令行：`./gradlew assembleHanguo114Release`（产物在 `app/build/outputs/apk/`）

## 上架前：正式签名

1. 生成签名文件（只做一次，**务必备份，丢了就再也无法更新 App**）：
   ```bash
   keytool -genkeypair -v -keystore release.jks -alias jobinfinity \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. 本地打包：复制 `keystore.properties.example` 为 `keystore.properties` 并填写
3. GitHub 打包：仓库 Settings → Secrets and variables → Actions 添加
   - `ANDROID_KEYSTORE_BASE64`（`base64 -w0 release.jks` 的输出）
   - `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`

## 链接免选择框直接打开 App（可选）

1. 取正式签名的指纹：`keytool -list -v -keystore release.jks -alias jobinfinity` 里的 SHA256
   （上架 Google Play 时用 Play Console → 应用完整性 里的「应用签名密钥」指纹）
2. 把 `assetlinks.template.json` 填好，保存为 `apps/m/public/.well-known/assetlinks.json` 并部署网站

## 版本号

发新版改 `app/build.gradle.kts` 里的 `versionCode`（每次 +1）和 `versionName`。
只改网页内容不需要发新版。
