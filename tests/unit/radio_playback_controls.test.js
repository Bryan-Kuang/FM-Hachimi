const ButtonBuilders = require("../../src/ui/buttons");

function componentIds(rows) {
  return rows.flatMap((row) => row.components.map((component) => component.data.custom_id));
}

describe("radio playback controls", () => {
  test("renders only the stop button for radio mode", () => {
    const rows = ButtonBuilders.createPlaybackControls({
      isPlaying: true,
      canSkip: true,
      canGoBack: true,
      hasQueue: true,
      loopMode: "queue",
      radioMode: true,
    });

    expect(rows).toHaveLength(1);
    expect(componentIds(rows)).toEqual(["stop"]);
  });

  test("keeps normal playback controls outside radio mode", () => {
    const rows = ButtonBuilders.createPlaybackControls({
      isPlaying: true,
      canSkip: true,
      canGoBack: true,
      hasQueue: true,
      loopMode: "queue",
      radioMode: false,
    });

    expect(componentIds(rows)).toEqual([
      "prev",
      "pause_resume",
      "stop",
      "skip",
      "loop",
      "queue",
    ]);
  });
});
