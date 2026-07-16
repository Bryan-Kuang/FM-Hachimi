/**
 * createThrottledProgressReporter (Task 2.8) — throttled progress edits for
 * the bulk-enqueue playlist path. Same serialized-pending-promise pattern as
 * createInteractionStageReporter, plus a timestamp gate.
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { createThrottledProgressReporter } = require("../../src/playback/stage_feedback");

describe("createThrottledProgressReporter", () => {
  test("sends the first report immediately", async () => {
    const interaction = { editReply: jest.fn().mockResolvedValue() };
    const reporter = createThrottledProgressReporter(interaction, 1000);

    reporter.report("正在解析歌单… 已获取 1");
    await reporter.finish();

    expect(interaction.editReply).toHaveBeenCalledWith({ content: "正在解析歌单… 已获取 1" });
  });

  test("drops intermediate reports arriving within minIntervalMs", async () => {
    const interaction = { editReply: jest.fn().mockResolvedValue() };
    const reporter = createThrottledProgressReporter(interaction, 10_000);

    reporter.report("first");
    reporter.report("second, too soon");
    reporter.report("third, also too soon");
    await reporter.finish();

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: "first" });
  });

  test("sends a later report once minIntervalMs has elapsed", async () => {
    const interaction = { editReply: jest.fn().mockResolvedValue() };
    const reporter = createThrottledProgressReporter(interaction, 20);

    reporter.report("first");
    await new Promise((resolve) => setTimeout(resolve, 30));
    reporter.report("second");
    await reporter.finish();

    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    expect(interaction.editReply).toHaveBeenNthCalledWith(1, { content: "first" });
    expect(interaction.editReply).toHaveBeenNthCalledWith(2, { content: "second" });
  });

  test("finish() awaits the outstanding edit chain", async () => {
    let resolveEdit;
    const interaction = {
      editReply: jest.fn().mockImplementation(() => new Promise((resolve) => { resolveEdit = resolve; })),
    };
    const reporter = createThrottledProgressReporter(interaction, 0);

    reporter.report("in flight");
    const finishPromise = reporter.finish();

    let settled = false;
    finishPromise.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveEdit();
    await finishPromise;
    expect(settled).toBe(true);
  });

  test("reports after finish() are no-ops", async () => {
    const interaction = { editReply: jest.fn().mockResolvedValue() };
    const reporter = createThrottledProgressReporter(interaction, 0);

    reporter.report("before finish");
    await reporter.finish();
    interaction.editReply.mockClear();

    reporter.report("after finish");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test("swallows editReply failures without throwing", async () => {
    const interaction = { editReply: jest.fn().mockRejectedValue(new Error("discord down")) };
    const reporter = createThrottledProgressReporter(interaction, 0);

    reporter.report("will fail");
    await expect(reporter.finish()).resolves.toBeUndefined();
  });
});
