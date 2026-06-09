let mockButtonHandler;
let mockSelectHandler;

jest.mock("discord.js", () => ({
  MessageFlags: { Ephemeral: 64 },
}));

jest.mock("../../src/bot/events/handlers/button_handler", () =>
  jest.fn(() => (...args) => mockButtonHandler(...args))
);

jest.mock("../../src/bot/events/handlers/select_menu_handler", () =>
  jest.fn(() => (...args) => mockSelectHandler(...args))
);

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/config/config", () => ({
  test: { guildId: "1376318047794761838" },
}));

const createInteractionHandler = require("../../src/bot/events/interactionCreate");

function makeInteraction({ customId, guildId, kind }) {
  return {
    customId,
    guildId,
    guild: guildId ? { id: guildId, name: "Guild" } : null,
    isButton: jest.fn().mockReturnValue(kind === "button"),
    isStringSelectMenu: jest.fn().mockReturnValue(kind === "select"),
    reply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
    replied: false,
    deferred: false,
  };
}

describe("testing component interaction guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonHandler = jest.fn().mockResolvedValue({});
    mockSelectHandler = jest.fn().mockResolvedValue({});
  });

  test("blocks testing buttons outside the test guild before routing", async () => {
    const handler = createInteractionHandler({});
    const interaction = makeInteraction({
      customId: "testing:queue:v2",
      guildId: "not-test",
      kind: "button",
    });

    await handler.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("queue"),
      flags: 64,
    });
    expect(mockButtonHandler).not.toHaveBeenCalled();
  });

  test("allows testing buttons inside the test guild", async () => {
    const handler = createInteractionHandler({});
    const interaction = makeInteraction({
      customId: "testing:queue:v2",
      guildId: "1376318047794761838",
      kind: "button",
    });

    await handler.execute(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(mockButtonHandler).toHaveBeenCalledWith(interaction);
  });

  test("blocks testing select menus outside the test guild before routing", async () => {
    const handler = createInteractionHandler({});
    const interaction = makeInteraction({
      customId: "testing:search:v2",
      guildId: "not-test",
      kind: "select",
    });

    await handler.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("search"),
      flags: 64,
    });
    expect(mockSelectHandler).not.toHaveBeenCalled();
  });

  test("allows testing select menus inside the test guild", async () => {
    const handler = createInteractionHandler({});
    const interaction = makeInteraction({
      customId: "testing:search:v2",
      guildId: "1376318047794761838",
      kind: "select",
    });

    await handler.execute(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(mockSelectHandler).toHaveBeenCalledWith(interaction);
  });

  test("stable custom IDs outside the test guild are unaffected", async () => {
    const handler = createInteractionHandler({});
    const interaction = makeInteraction({
      customId: "daily_play_BV1abc",
      guildId: "not-test",
      kind: "button",
    });

    await handler.execute(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(mockButtonHandler).toHaveBeenCalledWith(interaction);
  });
});
