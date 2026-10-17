# Folia 同人录数据源接口文档

> 本文档描述 Folia 播放器中「同人录」(Tongrenlu) 数据源的接口规范。同人录是一个公开的东方 Project 同人音乐目录/归档服务，**无需登录认证**，所有操作均为只读。

---

## 1. 概述

- **Provider ID**: `tongrenlu`
- **Display Name**: 东方同人录
- **Short Name**: 同人录
- **认证方式**: 无（公开只读）
- **环境变量**: `VITE_TONGRENLU_API_BASE` — 同人录 API 服务地址

### 1.1 能力声明

| 能力 | 支持 |
|------|------|
| search (搜索) | ✅ |
| playback (播放) | ✅ |
| lyrics (歌词) | ❌ |
| auth (登录) | ❌ |
| userLibrary (用户库) | ❌ |
| playlists (歌单) | ❌ |
| albums (专辑) | ✅ |
| artists (艺术家) | ✅ |
| recommendations (推荐) | ❌ |
| mutations (收藏/订阅等操作) | ❌ |

---

## 2. 公共类型定义

### 2.1 基础类型

```typescript
// 媒体 ID，可为数字或字符串
type MediaId = string | number;

// 提供商 ID
type OnlineProviderId = 'netease' | 'tongrenlu' | (string & {});

// 音频质量偏好
type AudioQualityPreference = 'standard' | 'high' | 'lossless' | 'hires';

// 目录实体类型
type ProviderCatalogEntityKind = 'album' | 'artist' | 'playlist';
```

### 2.2 歌曲 / 元数据

```typescript
interface Artist {
    id: MediaId;
    name: string;
}

interface Album {
    id: MediaId;
    name: string;
    coverUrl?: string;
    entityId?: string;
    catalogRef?: ProviderCatalogRef;
}

interface ProviderCatalogRef {
    providerId: OnlineProviderId;
    kind: ProviderCatalogEntityKind;
    id: MediaId;
}

interface NoCopyrightRecommendation {
    type?: number;
    typeDesc?: string;
    songId?: string | number;
    thirdPartySong?: unknown | null;
    expInfo?: unknown | null;
}

interface SongPrivilege {
    flag?: number;
    cs?: boolean;
}

interface ReplayGainInfo {
    trackGain?: number;   // dB
    albumGain?: number;   // dB
    trackPeak?: number;   // 线性比率
    albumPeak?: number;   // 线性比率
}

interface PlaybackSourceRef {
    kind: 'online';
    providerId: OnlineProviderId;
    mediaId: string;
    variant?: string;
    providerData?: Record<string, JsonValue>;
}

interface SongResult {
    id: MediaId;
    name: string;
    artists: Artist[];
    album: Album;
    durationMs: number;
    isPureMusic?: boolean;
    aliases?: string[];
    translatedNames?: string[];
    t?: 0 | 1 | 2;
    sourceType?: 'netease' | 'cloud';
    sourceRef?: PlaybackSourceRef;
    playbackSourceRevision?: string;
    fee?: number;
    noCopyrightRcmd?: NoCopyrightRecommendation | null;
    resourceState?: boolean;
    privilege?: SongPrivilege;
    replayGain?: ReplayGainInfo;
    qqMid?: string;
    kgHash?: string;
}
```

### 2.3 歌词

```typescript
interface LyricLine {
    start: number;        // 毫秒
    end?: number;         // 毫秒
    text: string;
    wordByWord?: LyricWord[];
    translation?: string;
    romanization?: string;
}

interface LyricWord {
    start: number;        // 毫秒
    end: number;          // 毫秒
    text: string;
}

interface LyricData {
    lines: LyricLine[];
    lrc?: string;         // 原始 LRC 文本
    isPureMusic?: boolean;
}

interface ChorusRange {
    startTime: number;    // 毫秒
    endTime: number;      // 毫秒
}

interface ProviderLyricsResult {
    lyrics: LyricData | null;
    mainText?: string | null;
    wordByWordText?: string | null;
    translationText?: string | null;
    romanizationText?: string | null;
    isPureMusic: boolean;
    chorusRanges?: ChorusRange[];
}
```

### 2.4 收藏集 (Collection)

```typescript
interface ProviderUser {
    id: MediaId;
    nickname: string;
    avatarUrl?: string;
    backgroundUrl?: string;
    vipType?: number;
}

interface ProviderArtistSummary {
    id: MediaId;
    name: string;
    entityId?: string;
    catalogRef?: ProviderCatalogRef;
}

interface ProviderAlbumSummary {
    id: MediaId;
    name: string;
    coverUrl?: string;
    entityId?: string;
    catalogRef?: ProviderCatalogRef;
}

interface ProviderCollection {
    providerId: OnlineProviderId;
    id: MediaId;
    name: string;
    type: 'playlist' | 'album' | 'artist' | 'radio' | 'cloud' | string;
    coverUrl?: string;
    description?: string;
    trackCount?: number;
    albumCount?: number;
    isOwned?: boolean;
    creator?: ProviderUser;
    artists?: ProviderArtistSummary[];
    aliases?: string[];
    publishedAt?: number;
    publisher?: string;
    playCount?: number;
    updatedAt?: number;
    tracksUpdatedAt?: number;
    isLiked?: boolean;
    providerData?: Record<string, JsonValue>;
}
```

### 2.5 分页

```typescript
interface ProviderPage<T> {
    items: T[];
    total?: number;
    hasMore: boolean;
    nextOffset: number;
}
```

### 2.6 音频源

```typescript
interface ProviderAudioSource {
    url: string;
    fetchedAt: number;
    expiresAt?: number;
    quality: AudioQualityPreference;
    replayGain?: ReplayGainInfo;
}
```

### 2.7 歌曲可用性

```typescript
type ProviderSongAvailabilityState = 'playable' | 'unavailable' | 'unknown';
type ProviderSongUnavailableReason = 'taken-down' | 'restricted';

interface ProviderSongAvailability {
    state: ProviderSongAvailabilityState;
    label?: string;
    reason?: ProviderSongUnavailableReason;
}

interface ProviderSongReplacement {
    song: UnifiedSong;
    label?: string;
}
```

### 2.8 歌曲元数据 (扩展)

```typescript
interface ProviderSongMetadata {
    artists: ProviderArtistSummary[];
    album: ProviderAlbumSummary;
    durationMs: number;
    coverUrl?: string;
    aliases: string[];
    translatedNames: string[];
}
```

### 2.9 统一歌曲 (UnifiedSong)

```typescript
// UnifiedSong extends SongResult，添加了以下字段：
interface UnifiedSong extends SongResult {
    // SongResult 所有字段 ...
    // 附加：
    matchedLyricsSource?: 'netease' | 'qq' | 'kugou' | 'amll';
    matchedLyricsProviderPlatform?: 'ncm' | 'qq';
    // ... 其他在线歌曲特有字段
}
```

---

## 3. Provider 接口合约

### 3.1 OnlineMusicProvider (主接口)

```typescript
interface OnlineMusicProvider {
    id: OnlineProviderId;                                    // 'tongrenlu'
    displayName: string;                                     // '东方同人录'
    shortName?: string;                                      // '同人录'

    // 提供商可用性检查（可选）
    getAvailability?(): ProviderAvailability;

    // 能力声明
    capabilities: ProviderCapabilities;

    // 标准化函数
    normalizeSong(raw: unknown): UnifiedSong;
    normalizeUser?(raw: unknown): ProviderUser;
    normalizeCollection?(raw: unknown, type?: string): ProviderCollection;

    // 各能力子接口
    songMetadata?: OnlineSongMetadataProvider;
    getSongPageUrl?(song: SongResult): string | null;
    search?: OnlineSearchProvider;
    playback?: OnlinePlaybackProvider;
    playbackReports?: OnlinePlaybackReportProvider;
    lyrics?: OnlineLyricsProvider;
    auth?: OnlineAuthProvider;
    library?: OnlineLibraryProvider;
    catalog?: OnlineCatalogProvider;
    recommendations?: OnlineRecommendationProvider;
    mutations?: OnlineMutationProvider;
}
```

### 3.2 OnlineSearchProvider (搜索)

```typescript
interface OnlineSearchProvider {
    searchSongs(query: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>>;
}
```

### 3.3 OnlinePlaybackProvider (播放)

```typescript
interface OnlinePlaybackProvider {
    // 获取歌曲详情
    getSongDetail(id: MediaId): Promise<UnifiedSong | null>;

    // 获取音频源 URL
    getAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<ProviderAudioSource | null>;

    // 获取可用性（可选）
    getAvailability?(song: SongResult): ProviderSongAvailability;

    // 获取替代歌曲（可选）
    getReplacement?(song: SongResult): Promise<ProviderSongReplacement | null>;
}
```

### 3.4 OnlineCatalogProvider (目录)

```typescript
interface OnlineCatalogProvider {
    // 是否能解析目录引用
    canResolveSongCatalogRefs?(song: UnifiedSong): boolean;

    // 解析歌曲的目录引用
    resolveSongCatalogRefs?(song: UnifiedSong): Promise<UnifiedSong>;

    // 获取歌单/专辑曲目列表
    getPlaylistTracks?(id: MediaId, limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;

    // 获取歌单详情
    getPlaylistDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;

    // 获取云盘曲目
    getCloudTracks?(limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;

    // 获取专辑曲目
    getAlbumTracks?(id: MediaId, limit?: number, offset?: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;

    // 获取专辑详情
    getAlbumDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;

    // 获取艺术家歌曲
    getArtistSongs?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>>;

    // 获取艺术家专辑列表
    getArtistAlbums?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;

    // 获取艺术家详情
    getArtistDetail?(id: MediaId): Promise<ProviderCollection | null>;

    // 获取订阅状态
    getSubscriptionStatus?(type: 'playlist' | 'album', id: MediaId, collection?: ProviderCollection): Promise<boolean>;
}
```

---

## 4. 同人录 API 端点

> 所有请求通过 `VITE_TONGRENLU_API_BASE` 配置的地址发送。
> 开发环境通过同源代理 `/api/tongrenlu/<operation>` 转发以避免跨域。

### 端点列表

| Operation | HTTP 方法 | 路径 | 说明 |
|-----------|-----------|------|------|
| `search` | GET | `/api/music/search` | 搜索专辑/曲目 |
| `detail` | GET | `/api/music/detail` | 获取专辑详情（含曲目列表） |
| `track` | GET | `/api/music/track` | 获取单个曲目详情（含音频 URL） |
| `random-albums` | GET | `/api/music/random-albums` | 获取随机专辑列表 |
| `tags` | GET | `/api/music/tags` | 获取标签列表 |
| `artists` | GET | `/api/music/artists` | 获取艺术家列表 |
| `album-stats` | GET | `/api/music/album-stats` | 获取专辑统计 |
| `events-count` | GET | `/api/music/events-count` | 获取活动计数 |

### 4.1 请求格式

```typescript
// 请求函数签名
requestTongrenlu<T = unknown>(
    operation: TongrenluOperation,
    params?: TongrenluParams
): Promise<T>

type TongrenluParams = Record<string, string | number | boolean | undefined>
```

### 4.2 响应包装

同人录 API 的响应有两种形式：

**形式 A** — 直接返回数据（用于 search、detail、track 等）：
```json
{ /* 数据对象或数组 */ }
```

**形式 B** — 封装信封（用于 album-stats、events-count 等写操作）：
```json
{
    "success": true,
    "data": { /* 实际数据 */ },
    "message": "可选的错误/提示信息"
}
```

Folia 内部统一规范化为：
```typescript
type TongrenluBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; httpStatus?: number; stage?: string } };
```

### 4.3 错误码

| HTTP 状态 | 代码 | 含义 |
|-----------|------|------|
| 404 | `not-playable` | 资源不存在 |
| 429 | `rate-limited` | 请求过于频繁 |
| 5xx | `service-unavailable` | 服务端错误 |
| 其他非 2xx | `network` | 网络错误 |

---

## 5. 各接口详细说明

### 5.1 搜索 — `search`

**同人录 API**: `GET /api/music/search`

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| keyword | string | 搜索关键词 |
| pageNumber | number | 页码（从 1 开始） |
| pageSize | number | 每页数量 |

**返回**: 专辑行（album-row）数组，每行结构见 `normalizeTongrenluSong` 的原始字段映射。

**标准化输出**: `ProviderPage<UnifiedSong>`

**同人录特有字段映射**:
```typescript
// 原始字段 -> 标准化字段
{
    id: number | string,           // 专辑 ID（搜索结果为专辑 ID）
    title: string,                 // 专辑名称
    artist: string,                // 社团/艺术家名称
    cloudMusicPicUrl: string,      // 封面图 URL
    description?: string,          // 描述
    publishDate?: string,          // 发布日期（ISO 字符串）
    updDate?: string,              // 更新日期
    trackCount?: number,           // 曲目数量
    accessCount?: number,          // 访问计数
    thbWikiUrl?: string,           // THBWiki URL
}
```

---

### 5.2 专辑详情 — `detail`

**同人录 API**: `GET /api/music/detail`

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| albumId | number \| string | 专辑 ID |

**返回**:
```typescript
{
    id: number | string,           // 专辑 ID
    title: string,                 // 专辑名称
    artist: string,                // 社团名称
    cloudMusicPicUrl: string,      // 封面 URL
    description?: string,          // 描述
    publishDate?: string,          // 发布日期
    updDate?: string,              // 更新日期
    trackCount?: number,           // 曲目数量
    accessCount?: number,          // 访问计数
    thbWikiUrl?: string,           // THBWiki URL
    tracks?: Array<{               // 曲目列表
        id: number | string,       // 曲目 ID
        name: string,              // 曲目名称
        articleId: number | string,// 所属专辑 ID
        trackNumber?: number,      // 曲序号
        disc?: string,             // 碟片编号
        cloudMusicId?: string,     // 网易云音乐 ID
        cloudMusicName?: string,   // 网易云音乐名称
        original?: string,         // 原曲名
        originalUrl?: string,      // 原曲 URL
        cloudMusicPicUrl?: string, // 封面（继承自专辑）
    }>
}
```

**标准化输出**: `ProviderCollection`（type: 'album'） + `ProviderPage<UnifiedSong>`（通过 `getAlbumTracks` 调用）

---

### 5.3 曲目详情 — `track`

**同人录 API**: `GET /api/music/track`

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | number \| string | 曲目 ID |

**返回**:
```typescript
{
    id: number | string,           // 曲目 ID
    name: string,                  // 曲目名称
    url: string,                   // 🎵 音频直链 URL
    articleId: number | string,    // 所属专辑 ID
    albumTitle?: string,           // 专辑名称
    cloudMusicPicUrl?: string,     // 封面 URL
    artist?: string,               // 社团名称
    trackNumber?: number,          // 曲序号
    disc?: string,                 // 碟片编号
    cloudMusicId?: string,
    cloudMusicName?: string,
    original?: string,
    originalUrl?: string,
    duration?: string,             // 格式 "m:ss"，非毫秒
}
```

**注意**: 音频 URL 每次请求都会重新生成，非永久有效。

**标准化输出**: `UnifiedSong` + `ProviderAudioSource`

---

### 5.4 随机专辑 — `random-albums`

**同人录 API**: `GET /api/music/random-albums`

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| count | number | 请求数量（最大 200） |

**返回**: `Array<专辑行>`，同 search 结果格式

**标准化输出**: `ProviderPage<ProviderCollection>`（type: 'album'）

---

### 5.5 标签列表 — `tags`

**同人录 API**: `GET /api/music/tags`

**返回**: 标签列表数据（用于专辑分类筛选）

---

### 5.6 艺术家列表 — `artists`

**同人录 API**: `GET /api/music/artists`

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| page | number | 页码（从 1 开始） |
| limit | number | 每页数量（最大 1000） |

**返回**:
```typescript
{
    records: Array<{
        id: number | string,
        name: string,
        cloud_music_pic_url?: string,  // 头像/封面 URL
    }>,
    totalPages?: number,               // 总页数
}
```

**标准化输出**: `ProviderPage<ProviderCollection>`（type: 'artist'）

---

### 5.7 专辑统计 — `album-stats`

**同人录 API**: `GET /api/music/album-stats`

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| albumId | number \| string | 专辑 ID |

**返回**: 专辑统计数据

---

### 5.8 活动计数 — `events-count`

**同人录 API**: `GET /api/music/events-count`

**返回**: 活动计数数据

---

## 6. 同人录 Provider 能力矩阵

| 方法 | 实现 | 说明 |
|------|------|------|
| `search.searchSongs` | ✅ | 搜索专辑/曲目 |
| `playback.getSongDetail` | ✅ | 获取曲目详情 |
| `playback.getAudioSource` | ✅ | 获取音频 URL |
| `playback.getAvailability` | ❌ | 不支持 |
| `playback.getReplacement` | ❌ | 不支持 |
| `catalog.getAlbumTracks` | ✅ | 获取专辑曲目 |
| `catalog.getAlbumDetail` | ✅ | 获取专辑详情 |
| `catalog.getArtistSongs` | ✅ | 获取艺术家歌曲（通过标签搜索模拟） |
| `catalog.getArtistAlbums` | ✅ | 获取艺术家专辑（通过标签搜索模拟） |
| `catalog.getArtistDetail` | ✅ | 获取艺术家详情（线性扫描） |
| `catalog.getPlaylistTracks` | ❌ | 同人录无歌单 |
| `catalog.getPlaylistDetail` | ❌ | 同人录无歌单 |
| `catalog.getCloudTracks` | ❌ | 同人录无云盘 |
| `library.getUserPlaylists` | ❌ | 公开目录，无需用户库 |
| `library.getLikedSongIds` | ❌ | 不支持 |
| `library.getCloudCollection` | ❌ | 不支持 |
| `recommendations.getDailySongs` | ❌ | 不支持 |
| `recommendations.getPersonalFm` | ❌ | 不支持 |
| `recommendations.getRecommendedCollections` | ✅ | 随机专辑列表 |
| `mutations.likeSong` | ❌ | 只读 |
| `mutations.updatePlaylistTracks` | ❌ | 只读 |
| `auth.*` | ❌ | 公开目录，无需认证 |
| `lyrics.*` | ❌ | 不支持歌词 |

---

## 7. providerData 字段说明

同人录的歌曲 `sourceRef.providerData` 包含同人录特有的扩展信息：

```typescript
interface TongrenluProviderData {
    albumId: string;           // 所属专辑 ID
    trackNumber: number | null;// 曲序号
    disc: string | null;       // 碟片编号
    cloudMusicId: string | null;   // 网易云音乐 ID（若有）
    cloudMusicName: string | null; // 网易云音乐名称
    original: string | null;       // 原曲名
    originalUrl: string | null;    // 原曲 URL
}
```

---

## 8. 集成指南

### 8.1 开发新的 Folium Mod 数据源

参考 `src/services/onlineMusic/tongrenluProvider.ts` 的结构：

1. 创建 `xxxTransport.ts` — 定义 API 端点和请求分发
2. 创建 `xxxNormalize.ts` — 定义原始响应到标准类型的标准化函数
3. 创建 `xxxProvider.ts` — 实现 `OnlineMusicProvider` 接口
4. 在 `providerRegistry.ts` 中注册

### 8.2 关键约束

- **不要猜测接口结构**：同人录 API 没有官方文档，所有字段映射基于实际请求响应
- **providerData 不可信**：仅用于同人录内部导航，不要依赖它做跨 provider 判断
- **音频 URL 临时性**：同人录的音频 URL 每次请求都会变化，不可缓存
- **分页限制**：艺术家列表 API 每页最多 1000 条

---

## 9. Folium Mod 外部数据源（实验性）

Folia 支持通过 Folium Mod 注册外部在线音乐数据源（实验性功能）。这允许第三方开发者在不修改 Folia 核心代码的情况下，添加新的音乐服务。

### 9.1 FoliumOmniProviderDef 接口

```typescript
interface FoliumOmniProviderDef {
    /** 本地提供商 ID */
    id: string;
    /** 全名（主页提供商切换器的第二行）*/
    displayName: string;
    /** 简称（默认取 displayName 首字符作为头像徽章）*/
    shortName?: string;
    /** 搜索歌曲；page 为基于 offset 的分页 */
    search?(query: string, page: { limit: number; offset: number }): Promise<{
        items: FoliumProviderSong[];
        hasMore: boolean;
        total?: number;
    }>;
    /** 根据 ID 获取一首歌曲 */
    getSong?(id: string): Promise<FoliumProviderSong | null>;
    /** 获取歌曲的可播放 URL */
    getAudioUrl?(song: FoliumProviderSong, quality: FoliumAudioQuality): Promise<{
        url: string;
        expiresAt?: number;
    } | null>;
    /** 获取歌词（支持 FoliumLyricsResult 或旧版 Folium 1.3 纯 LRC 格式）*/
    getLyrics?(song: FoliumProviderSong): Promise<FoliumLyricsResult | FoliumLegacyLyricsResult | null>;
}
```

### 9.2 FoliumProviderSong 类型

```typescript
interface FoliumProviderSong {
    id: string;
    title: string;
    artists: string[];
    album: string;
    coverUrl?: string;
    durationMs?: number;
}
```

### 9.3 注册方式

在 Folium Mod 的 `client` 入口中使用 `folium.experimental.omniProviders.register()` 注册：

```typescript
import type { FoliumClientModule } from 'folium';

export const activate: FoliumClientModule = (folium) => {
    folium.experimental.omniProviders.register({
        id: 'my-provider',
        displayName: '我的音乐源',
        shortName: '我的',
        search: async (query, page) => {
            // 调用你的 API 并返回 FoliumProviderSong[]
            const results = await mySearchApi(query);
            return {
                items: results,
                hasMore: results.length === page.limit,
            };
        },
        getSong: async (id) => { /* ... */ },
        getAudioUrl: async (song, quality) => { /* ... */ },
        getLyrics: async (song) => { /* ... */ },
    });
};
```

详情参见 [Folium API 参考](folium/api.md) 的 `FoliumOmniProviderDef` 一节。

---

## 10. 相关文件索引

| 文件 | 说明 |
|------|------|
| `src/services/onlineMusic/tongrenluProvider.ts` | 同人录 Provider 主实现 |
| `src/services/onlineMusic/tongrenluTransport.ts` | API 传输层 |
| `src/services/onlineMusic/tongrenluNormalize.ts` | 数据标准化 |
| `src/services/onlineMusic/tongrenluAvailability.ts` | 可用性检查 |
| `src/services/onlineMusic/omni.ts` | 统一接口 facade |
| `src/types/onlineMusic.ts` | 核心类型定义 |
| `src/types.ts` | 通用类型（SsongResult, UnifiedSong 等） |
| `src/mods/folium/contract.ts` | Folium Mod 契约定义 |
| `docs/folium/api.md` | Folium API 参考文档 |
