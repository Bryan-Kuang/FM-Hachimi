const ButtonBuilders = require("../../src/ui/buttons");

function componentIds(rows) {
  return rows.flatMap((row) => row.components.map((component) => component.data.custom_id));
}

function componentById(rows, id) {
  return rows.flatMap((row) => row.components).find((component) => component.data.custom_id === id);
}

describe("radio playback controls", () => {
  test("renders stop and skip buttons for radio mode", () => {
    const rows = ButtonBuilders.createPlaybackControls({
      isPlaying: true,
      canSkip: true,
      canGoBack: true,
      hasQueue: true,
      loopMode: "queue",
      radioMode: true,
    });

    expect(rows).toHaveLength(1);
    expect(componentIds(rows)).toEqual(["stop", "skip"]);
  });

  test("keeps radio skip clickable even when there is no visible queued next track", () => {
    const rows = ButtonBuilders.createPlaybackControls({
      isPlaying: true,
      canSkip: false,
      hasQueue: false,
      radioMode: true,
    });

    const skipButton = componentById(rows, "skip");

    expect(skipButton).toBeTruthy();
    expect(skipButton.setDisabled).not.toHaveBeenCalledWith(true);
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
