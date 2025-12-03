## 目标与度量
- 参数化 + 场景工厂 + 快照 + 属性 + 契约，扩展到数百/上千用例。
- 常规测试 ≤ 2–3 分钟；变异测试独立流水线（Nightly/CI Stage）。
- 覆盖门槛与质量阈值到位（branches ≥ 90%，变异阈值分级）。

## Phase 0：基础设施（并行支撑 Phase 1）
- 依赖：`jest`、`jest-extended`、`fast-check`、`@stryker-mutator/core`（暂不并入常规命令）。
- TestFactory/Builder：
  - `createMockAudioPlayer(state)`、`createMockInteraction(options)`、`createMockDependencies()`。
  - InteractionBuilder：隐藏 deep-nested Mock 复杂度，提升可维护性。
- EventEmitter 模拟：用于异步事件测试。
```js
class MockEventEmitter {
  constructor(){ this.listeners = new Map(); }
  on(event, handler){ const arr=this.listeners.get(event)||[]; arr.push(handler); this.listeners.set(event, arr); }
  emit(event, data){ (this.listeners.get(event)||[]).forEach(h=>h(data)); }
}
```
- 状态机验证器：校验状态转换合法性，辅助属性与集成测试。
```js
const validateStateTransition = (from, to) => {
  const valid = { idle: ['playing'], playing: ['paused','stopped','idle'], paused: ['playing','stopped','idle'] };
  return valid[from]?.includes(to) ?? false;
};
```
- 性能监控：在 Jest 环境钩子中记录执行时长与最慢用例；为后续优化提供数据。
- 统一虚拟时钟：`jest.useFakeTimers()` 并封装推进时间帮助函数。

## Phase 1：核心命令矩阵（对象数组表驱动）
- 用对象数组提升可读性，覆盖所有分支与异常（Stop 示例：参考 `src/bot/commands/stop.js:41-46, 55-61, 69-86`）。
```js
const testCases = [
  {
    description: '用户不在语音频道',
    scene: { userVc: null, botVc: 'vc_1', playerState: 'playing' },
    expected: { success: false, replyContains: 'Voice channel required', playerCalled: false }
  },
  {
    description: '正常停止',
    scene: { userVc: 'vc_1', botVc: 'vc_1', playerState: 'playing' },
    expected: { success: true, replyContains: '⏹️ Stopped', playerCalled: true }
  },
  // ... 其他分支与异常
];

test.each(testCases)('$description', async ({ scene, expected }) => {
  const { interaction, playerControl } = TestFactory.createScene(scene);
  await stopCommand.execute(interaction);
  expect(playerControl.stop)[expected.playerCalled ? 'toHaveBeenCalled' : 'not.toHaveBeenCalled']();
  expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(expected.replyContains) }));
});
```
- 将 `play/search/help/queue/nowplaying/pause/resume/skip/prev` 接入同一矩阵，并在 Phase 0 的 Builder 之上复用。

## Phase 2：契约测试（前置至此）
- 为 `AudioManager` / `PlayerControl` / `InterfaceUpdater` 建立契约：输入、输出、错误、副作用。
- 所有命令共享契约用例，减少重复并强化一致性；成为后续表驱动与属性测试的基石。

## Phase 3：快照策略（分层与抗脆性）
- 分层快照策略：
  - Level 1（Minimal）：只验证关键字段类型/存在性（抗变更）。
  - Level 2（Business）：验证业务字段值（title/description/fields 内容）。
  - Level 3（Full UI）：完整 UI 快照，仅用于视觉组件，稀少且严格审查。
```js
const snapshotStrategies = {
  minimal: (embed) => ({
    fieldsCount: embed.fields?.length,
    hasDescription: !!embed.description,
    hasTitle: !!embed.title,
  }),
  business: (embed) => ({ title: embed.title, description: embed.description, fields: embed.fields }),
};
expect(snapshotStrategies.minimal(embed)).toMatchSnapshot();
```
- Property Matchers：忽略易变字段（时间戳、颜色、内部 ID）。

## Phase 4：属性测试（关键不变式）
- 必须不变式：
```js
const invariants = {
  queueNonNegative: (queue) => queue.length >= 0,
  queueOperationIdempotent: (queue, item) => deepEqual(queue, removeItem(addItem(queue, item), item)),
  noPlayingWithoutConnection: (player) => !(player.state === 'playing' && !player.voiceConnection),
  paginationBounds: (items, pageSize) => { const total = Math.ceil(items.length / pageSize); return total >= 1 && (items.length === 0 || total <= items.length); },
};
```
- `fast-check`：固定 `seed`；常规 CI 使用小样本（100–200），Nightly 使用大样本（1000+）。

## Phase 5：变异测试（独立与增量）
- 独立流水线：Stryker 作为 CI 单独 Stage 或 Nightly Job，不混入 `npm test`。
- 增量变异：仅变异改动文件（利用 Stryker 的增量能力或 `--mutate` 与 git 变更结合）。
- 建议配置（示例）：
```js
// .stryker.conf.js
module.exports = {
  mutate: ['src/bot/commands/**/*.js', '!src/bot/commands/**/*.spec.js'],
  timeoutMS: 2000,
  concurrency: 4,
  thresholds: { high: 90, low: 80, break: 85 },
};
```

## Phase 6：并发、错误注入与性能/内存
- 测试数据工厂：`TrackFactory`、`UserFactory` 生成多样化数据；`SceneFactory` 组合。
- 网络请求模拟：为 `search` 命令 Mock 外部 API 响应、超时、429/5xx 等。
- 错误注入：权限错误、网络错误、资源不可用、限流等边界情况。
- 并发与竞态：多个命令同时执行（如 skip+pause），保留独立集成测试用例而非表驱动。
- 内存泄漏检测：长时间运行模拟，对播放器与队列进行内存快照比对（可在 Nightly）。

## 风险与对策
- 表驱动掩盖复杂交互：为复杂场景保留独立集成测试套件（race/跨模块交互）。
- Mock 复杂与耦合：定期审查 Mock，只模拟行为契约，不复制实现细节；持续收敛 Builder 与 Factory 接口。
- 快照脆性：严格限制 Level 3 使用场景；对快照变更设审查流程。

## 实施顺序与里程碑
- Phase 0 与 Phase 1 并行：先落地 2–3 个核心命令（stop/play/search）验证模式与基础设施。
- 前置契约测试（Phase 2）：完成后，剩余命令接入矩阵与快照更顺畅。
- 持续扩展属性与并发测试（Phase 4/6），最后接入变异测试独立流水线（Phase 5）。

若确认，我将先实现 `tests/utils/scene_factory.js` 与 `InteractionBuilder`，并将 `stop/play/search` 三个命令改造成对象数组的表驱动矩阵，用最小可行集达成百级用例，再按上述阶段迭代扩展。