/**
 * Interaction Create Event Handler (Router)
 * Dispatches button and select-menu interactions to focused handler modules.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import createButtonHandler = require('./handlers/button_handler');
import createSelectMenuHandler = require('./handlers/select_menu_handler');

const createInteractionHandler = (
  playerService: any,
  _deprecated?: any,   // kept for backward compat if called with 2 args
): { name: string; execute: (interaction: any) => Promise<void> } => {
  const handleButton     = createButtonHandler(playerService);
  const handleSelectMenu = createSelectMenuHandler(playerService);

  return {
    name: 'interactionCreate',

    async execute(interaction: any): Promise<void> {
      if (interaction.isButton()) {
        await handleButton(interaction);
      }

      if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
      }
    },
  };
};

export = createInteractionHandler;
