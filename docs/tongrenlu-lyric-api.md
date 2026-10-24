# 同人录歌词来源

<!-- docs/tongrenlu-lyric-api.md -->

Folia 的「东方同人录」（Tongrenlu）provider 从网易云的公开歌词接口读取歌词。

## 歌词从哪里来

同人录的目录本身**不存歌词**。每一首曲目指向它导入自的那首网易云歌曲（`m_track.cloud_music_id`），歌词存在那首歌曲上。因此歌词的读取链路是：

```text
Folia 播放一首同人录曲目
  → 取该曲目的 cloudMusicId
  → 请求网易云公开歌词接口 /lyric/new?id=<cloudMusicId>
  → 解析成 Folia 的歌词结构
```

这条链路不需要登录、不需要 Cookie、不需要签名，也不依赖任何本地后端服务。

## 使用的网易云接口

| 接口 | 地址 | 说明 |
| --- | --- | --- |
| 逐字歌词 | `https://apis.netstart.cn/music/lyric/new?id=<音乐id>` | 完整歌词包。`yrc` 字段是逐字歌词，`ytlrc` / `yromalrc` 是逐字行的翻译与罗马音。 |
| 逐行歌词 | `https://apis.netstart.cn/music/lyric?id=<音乐id>` | 逐行歌词，用于没有逐字歌词的歌曲。 |

两个接口都会按顺序请求，取第一个有内容的应答。

### 逐字歌词

逐字歌词在 `yrc` 字段中，每行形如：

```text
[12340,1200](0,0,0)First(12340,700,0) line(13040,600,0)
```

方括号是这一行的起止时间（毫秒），圆括号是每个字的起止时间与偏移。Folia 现有的网易云歌词流水线能直接读这个格式，所以逐字歌词不需要新的解析器。

并不是每首歌都有逐字歌词：多数应答只有 `lrc`（逐行）和 `tlyric`（翻译）。有逐字歌词时，Folia 用 `yrc` 作主歌词、`ytlrc` 作翻译；没有时用 `lrc` 和 `tlyric`。

### 「没有歌词」不是错误

接口对不存在的歌曲**不是**报错，而是返回 200：

```json
{ "uncollected": true, "lrc": { "lyric": "[00:00.00]暂无歌词" } }
```

`uncollected` 标记与「暂无歌词」占位文本都表示这首歌没有歌词。同人录 provider 会把这种应答当成「没有歌词」，而不是当成失败。

同样地，纯音乐歌曲的歌词是 `[00:05.00]纯音乐，请欣赏`，Folia 已有的纯音乐判定会认出来。

## 曲目的音乐 id

`cloudMusicId` 来自同人录的曲目行：

- `/api/music/detail` 的 `tracks[]` 返回驼峰 `cloudMusicId`；
- `/api/music/track-search` 的行是数据库原样返回的蛇形 `cloud_music_id`。

provider 的归一化两种写法都认，所以从搜索结果播放的曲目同样能取到歌词。

没有导入过网易云歌曲的曲目（`cloudMusicId` 为空或为 `0`）没有歌词可查，会直接回答「没有歌词」，不发起请求。

## 失败处理

歌词是可选的，任何失败都不会影响播放：

- 网络失败、超时、HTTP 错误状态：当作「没有歌词」。
- 接口返回的内容无法解析：当作「没有歌词」。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| `src/services/onlineMusic/netease/publicLyricApi.ts` | 网易云公开歌词接口的客户端：请求两个端点、识别「没有歌词」的应答、解析歌词。 |
| `src/services/onlineMusic/tongrenlu/tongrenluProvider.ts` | provider 的 `getLyrics`：取曲目的 `cloudMusicId`，交给上面的客户端。 |
| `src/services/onlineMusic/tongrenlu/tongrenluNormalize.ts` | 曲目行的归一化，驼峰与蛇形的 `cloudMusicId` 都认。 |

## 测试

- `test/unit/onlineMusic/netease/publicLyricApi.test.ts` — 接口客户端：端点顺序、「没有歌词」的判定、失败与超时。
- `test/unit/onlineMusic/tongrenlu/tongrenluProvider.test.ts` — provider：请求的是网易云歌曲 id 而不是同人录曲目 id、无歌曲 id 时不发请求、网络失败不影响播放。
