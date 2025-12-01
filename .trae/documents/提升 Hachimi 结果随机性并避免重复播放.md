## 目标
- 保持“系统默认排序”的相关性，同时提升 /hachimi 的随机性。
- 引入高性能的 LRU 历史去重（大小限制），并处理候选被历史集耗尽的边界情况。
- 模块化拆分，实现易维护与可测试。

## 随机页采样（Search Depth）
- 固定抓取第 1 页（保证高相关）。
- 额外随机抓取 1~2 个页码，范围限制在 [2, 10]，避免低相关长尾。
- 并发请求：使用 Promise.all 并行拉取这 2-3 个页面；总体超时窗口 8 秒（race 超时保护）。

## 历史去重（LRU，Size Limit）
- 结构：Map<GuildId, Set<BvId>>；按插入顺序维护 LRU。
- 写入：`set.delete(bvid); set.add(bvid);`；若超限：`set.delete(set.values().next().value)` 删除最旧项。
- 只采用大小限制，不使用 TTL，保证简单高效。
- 软性去重回退：若过滤后 `filteredCandidates.length === 0`，则忽略历史，直接从“质量筛选后”的集合随机抽样，保证结果可用。
- UI 提示：当触发软性回退时，在成功 embed 的 Footer 添加“候选池已耗尽，随机回溯历史记录”。

## 模块化拆分
- 新增：`src/utils/history_store.js`
  - 提供 `has(guildId, bvid)`、`add(guildId, bvid)`、`filter(guildId, candidates)`（返回过滤后的数组）。
  - 单例导出，默认 limit=50，可通过 config 覆盖。
- 调整：`src/utils/bilibiliApi.js`
  - `fetchRawCandidates(keyword, opts)`: 并发分页抓取（固定页1 + 随机2~10页 1~2个）。
  - `processCandidates(rawList, guildId, maxResults)`: 去重 → 质量筛选 → 历史过滤（含软性回退）→ 随机抽样。
  - `searchHachimiVideos(maxResults, guildId)`: 组合上述函数并返回最终列表。

## 配置
- `src/config/config.js` 增加：
  - `features.hachimiPoolSize`（默认 50）
  - `features.hachimiMaxPages`（默认 3）
  - `features.hachimiTimeoutMs`（默认 8000）
  - `features.hachimiHistorySize`（默认 50）
- `MAX_VIDEO_BATCH_SIZE` 继续在 `hachimi.js` 顶部常量中控制批量添加上限（已实现）。

## 集成点（保持模块化）
- `/hachimi` 命令仅负责：
  - 设置 UI 上下文（InterfaceUpdater）与 deferReply 防超时；
  - 调用 `BilibiliAPI.searchHachimiVideos(MAX_VIDEO_BATCH_SIZE, guildId)` 获取结果；
  - 通过 `PlaylistManager.add` 逐项添加；
  - 通过 `PlayerControl.play/notifyState` 触发 UI 刷新与进度跟踪。
- 历史写入：添加成功后，调用 `HistoryStore.add(guildId, bvid)`。

## 性能与容错
- 总体操作使用 Promise.all 并行抓取 2-3 页；外层 `Promise.race` 设定 8 秒。
- 仅保留必要字段（bvid、title、url、view、like、duration），控制内存。
- 当 API 异常（如 412）时沿用现有 extractor 回退；随机抽样同样适用回退结果。

## 测试
- 单元测试：
  - `HistoryStore`：插入/超限删除顺序、`filter` 行为正确。
  - `processCandidates`：在历史集耗尽时走软性回退并添加 Footer 提示。
  - 多次运行 `processCandidates` 在相同输入下产生不同采样输出（统计差异）。
- 集成测试：
  - 多次执行 `/hachimi`，验证相邻两次结果不完全相同（在候选充分时），且均满足质量筛选与批量上限。

## 交付
- 模块化代码（history_store、新的 API 拆分）。
- 单元/集成测试用例。
- 使用文档追加“随机性与去重”说明（简短）。

请确认该精细化方案，我将开始实施并提交验证结果。