## 问题说明
- 当前 `/hachimi` 使用过程中未显示播放 UI，用户无法进行暂停/跳过等操作。
- 原因：`hachimi` 直接调用 `player.playNext()` 导致没有经过 `PlayerControl` 的事件通道，`InterfaceUpdater` 绑定在 `PlayerControl.onStateChanged` 上，因此不会触发 UI 更新。
- 另外，添加音乐流程需要复用“播放列表管理”和“播放状态管理”的模块代码以保持模块化与可维护性。

## 改动目标
1. 通过 `PlayerControl` 触发播放状态变更，保证 `InterfaceUpdater` 收到事件并渲染播放 UI。
2. 添加音乐严格通过 `PlaylistManager`，不直接操作 `player.queue`。
3. 在命令开始时设置 UI 上下文 `InterfaceUpdater.setPlaybackContext`，确保 UI 能正确发到当前频道。
4. 维持已有的批量添加上限 `MAX_VIDEO_BATCH_SIZE`，并在日志/用户提示中反馈超过上限时的处理。

## 具体修改
### 1) hachimi 命令重构（src/bot/commands/hachimi.js）
- 在 `execute()` 里，验证通过后立即：
  - 调用 `InterfaceUpdater.setPlaybackContext(guildId, channelId)`，确保 UI 通道已绑定。
  - 使用 `await interaction.deferReply()` 防止 3 秒超时。
- 在 `searchAndAddHachimiVideos()` 中：
  - 保留当前的批量大小校验逻辑，限定在 `1..20`，超限记录警告日志。
  - 添加视频统一用 `PlaylistManager.add(guildId, video.url, username)`。
  - 移除对 `player.playNext()` 的直接调用，改为：
    - 若 `!player.isPlaying && !player.isPaused` 则调用 `await PlayerControl.play(guildId)`。
    - 对于后续跳过/上一首等统一走 `PlayerControl.next/prev`，不直接操作 `AudioManager`。
  - 在播放开始前后调用 `PlayerControl.notifyState(guildId)`（仅当需要立即刷新 UI 但没有状态跳变时），确保 UI 刷新一致性。
- 在成功 embed 中补充提示：若批量数量被上限截断（例如配置超过 20），在返回消息中追加“已按上限截断为 X”信息。

### 2) 交互与 UI 通道（src/ui/interface_updater.js）
- 逻辑无需改动，确保：
  - `InterfaceUpdater.bind(PlayerControl)` 已在 `src/bot/client.js:66-68` 完成。
  - 通过 `PlayerControl.emitState()` 的事件触发 `handleUpdate()`，从而创建/编辑消息并启动 `ProgressTracker`。

### 3) 关联模块复用
- 播放状态管理：统一使用 `PlayerControl`（src/control/player_control.js:33-45, 73-83, 99-109）。
- 播放列表管理：统一使用 `PlaylistManager`（src/playlist/playlist_manager.js:23-41）。
- UI 更新：统一通过 `InterfaceUpdater`（src/ui/interface_updater.js:23-33, 29-83）。

## 测试与验证
- 单元测试：
  - 新增测试用例模拟 `/hachimi` 流程时，验证是否调用了 `PlayerControl.play` 而不是 `player.playNext`（使用 spy/mocks）。
  - 验证批量上限逻辑：当配置超出上限时日志中有警告，返回的数量不超过上限。
- 集成测试：
  - 运行 Bot，在真实频道中执行 `/hachimi`，确认：
    - UI 消息（Now Playing embed + 控件）出现；
    - 进度条每秒更新（由 `ProgressTracker` 驱动）。

## 交付内容
- 已重构的 `hachimi` 命令代码（仅使用 `PlaylistManager` 与 `PlayerControl`）。
- 批量上限提示嵌入与日志反馈。
- 新增或更新的测试用例，确保 UI 触发与模块化调用路径正确。

## 风险与回退
- 若部分频道未显示 UI，检查是否在命令开头正确调用了 `InterfaceUpdater.setPlaybackContext`。
- 若播放未开始，检查是否队列为空或 `PlayerControl.play` 返回失败；保留日志定位失败原因。

请确认以上方案，我将按此计划实施修改并提交对应测试与验证结果。