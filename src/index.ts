import type { IAgentRuntime, Plugin  } from "@elizaos/core";
import { mcpLogger } from "@/utils/mcp-logger";
import { callToolAction } from "./actions/callToolAction";
import { readResourceAction } from "./actions/readResourceAction";
import { provider } from "./provider";
import { McpService } from "./service";

const mcpPlugin: Plugin = {
  name: "mcp",
  description: "Plugin for connecting to MCP (Model Context Protocol) servers",

  init: async (_config: Record<string, string>, _runtime: IAgentRuntime) => {
    mcpLogger.info("Initializing MCP plugin...");
  },

  services: [McpService],
  actions: [callToolAction, readResourceAction],
  providers: [provider],
};

export type { McpService };

export default mcpPlugin;
