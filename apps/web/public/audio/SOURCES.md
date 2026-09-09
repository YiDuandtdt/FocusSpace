# FocusSpace 环境音来源与授权（第七阶段）

四条真实环境录音均已随应用部署，播放不需要连接第三方网站。

| 文件 / 名称 | 原作者与原始来源 | 授权 | 上游整理 |
| --- | --- | --- | --- |
| `rain.mp3` / 窗边雨声 | alex36917，[rain ambience](https://freesound.org/people/alex36917/sounds/524605/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Porrumentzio / Blanket |
| `fire.mp3` / 炉火轻响 | ezwa，[Fireplace](https://soundbible.com/1543-Fireplace.html) | Public Domain，原页面声明公有领域 | Blanket |
| `birds.mp3` / 林间鸟鸣 | kvgarlic，[WoodThrushinMorningShawneeForestMay272012.wav](https://freesound.org/people/kvgarlic/sounds/156826/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Porrumentzio / Blanket |
| `stream.mp3` / 溪水潺潺 | gluckose，[stream2.wav](https://freesound.org/people/gluckose/sounds/333987/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Blanket |

取得日期：2026-09-09。下载来源为 [Blanket 的声音目录](https://github.com/rafaelmardojai/blanket/tree/9d229d2be7cb6619135d55ff9e49926e40298686/data/resources/sounds)，固定提交 `9d229d2be7cb6619135d55ff9e49926e40298686`。保留上游逐条授权清单 [BLANKET-SOUNDS-LICENSING.md](./BLANKET-SOUNDS-LICENSING.md)。仅使用录音资产，未复制 Blanket 的应用代码。以上素材各自遵循其录音许可。

FocusSpace 的修改：截取上游录音的前 24 秒、响度规范化（目标 -25 LUFS、真峰值 -3 dB）、将尾部与头部交叉淡化 2 秒，输出 22 秒循环；44.1 kHz 双声道、96 kbps MP3。每条 264,926 字节，合计 1,059,704 字节（约 1.01 MiB）。不含无声占位文件。雨声遵循 CC BY 4.0，分发时请保留作者、原始链接、许可链接与本修改说明，不暗示原作者为本应用背书。

重建：下载该固定提交下的 `rain.ogg`、`fireplace.ogg`、`birds.ogg`、`stream.ogg` 到项目 `.tmp/ambience/`，将 `FFMPEG` 环境变量指向本地 FFmpeg，再运行 `npm run audio:prepare`。处理脚本为 `scripts/prepare-ambience.mjs`；输入/输出 SHA-256、文件大小见 [manifest.json](./manifest.json)。转码工具与上游大体积 OGG 不随应用分发。

播放器默认暂停，用户明确播放后才加载。选择和音量按账号保存在本机；播放状态不保存。主题仅给出文字推荐，切换主题、视图或全屏不会替用户开始/暂停或换声音。主动切换录音时保持当时的播放/暂停意图；离开页面、结束房间时释放播放器。

循环接缝已交叉淡化，但 HTMLAudioElement 在部分浏览器/设备上仍可能产生短暂解码间隙。音频实际输出还取决于设备静音、系统音量和浏览器声音许可。

## 旧版合成音（兼容保留，不在本轮声音菜单中）

- 文件：`window-rain.wav`，24 秒、24 kHz、16 bit、双声道 PCM WAV（约 2.3 MB）。
- 来源：2026-09-07 为本项目编写的 `scripts/generate-ambience.mjs` 原创程序合成。
- 内容：滤波噪声模拟连续雨幕，叠加轻微雨滴与缓慢强弱变化；不是实地录音，不包含第三方采样、音乐、语音或外部模型素材。
- 授权：生成脚本及其输出文件以 **CC0-1.0** 提供，可复制、修改、商用及随应用分发，无需署名；在法律允许范围内放弃相关权利。不包含第三方录音权利。
- 许可全文：<https://creativecommons.org/publicdomain/zero/1.0/legalcode>。
- 重建：在项目根目录执行 `node scripts/generate-ambience.mjs`。固定种子、等功率交叉淡化循环接缝，无静音占位。
- 播放：随应用同源部署，默认关闭，用户点击播放；音量仅影响当前页面，离开房间释放播放资源。

场景家具与四种几何体角色也由本项目代码创建，不使用外部图片、字体或模型；Three.js 依赖采用 MIT 许可，许可保留在依赖包中。
