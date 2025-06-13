import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { mcpLogger } from "@/utils/mcp-logger";
import { handleMcpError } from "@/utils/error";
import {
  processResourceResult,
  sendInitialResponse,
} from "@/utils/processing";
import { useActionHandler } from "@/utils/use-action";
import { createResourceSelection } from "@/utils/selection";
import { handleNoResourceAvailable, handleResourceAnalysis } from "@/utils/handlers";
import { validateAction } from "@/utils/validation";


const ACTION_NAME = 'READ_RESOURCE';

export const readResourceAction: Action = {
  name: ACTION_NAME,
  similes: [
    "READ_MCP_RESOURCE",
    "GET_RESOURCE",
    "GET_MCP_RESOURCE",
    "FETCH_RESOURCE",
    "FETCH_MCP_RESOURCE",
    "ACCESS_RESOURCE",
    "ACCESS_MCP_RESOURCE",
  ],
  description: "Reads a resource from an MCP server",

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return await validateAction(ACTION_NAME, runtime, message, state);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<boolean> => {
    const context = await useActionHandler({ actionName: ACTION_NAME, runtime, message, state, options, callback });

    try {
      mcpLogger.info('[INITIAL_RESPONSE] Sending initial response...');
      await sendInitialResponse(callback);

      const resourceSelection = await createResourceSelection({ ...context });
      mcpLogger.info(`[SELECTED] Resource Selection response:\n${JSON.stringify(resourceSelection, null, 2)}`);

      if (!resourceSelection || resourceSelection.noResourceAvailable) {
        mcpLogger.info('[NO_RESOURCE_AVAILABLE] No appropriate resource available for the request');
        return handleNoResourceAvailable(callback);
      }

      const { serverName, uri, reasoning } = resourceSelection;
      mcpLogger.info(`[FETCHING] Fetching resource "${serverName}/${uri}" with reasoning: "${reasoning}"`);

      const result = await context.mcpService.readResource(serverName, uri);
      mcpLogger.info(`[FETCHED] Resource "${serverName}/${uri}" result: \n"${JSON.stringify(result, null, 2)}"`);
      
      const { resourceContent, resourceMeta } = processResourceResult(result, uri);

      mcpLogger.info('[HANDLE] Handling resource response...');
      await handleResourceAnalysis({ ...context, serverName, uri, resourceContent, resourceMeta });

      return true;
    } catch (error) {
      return await handleMcpError({ ...context, error, type: 'resource' });
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Can you get the documentation about installing ElizaOS?",
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: `I'll retrieve that information for you. Let me access the resource...`,
          actions: ["READ_MCP_RESOURCE"],
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: `ElizaOS installation is straightforward. You'll need Node.js 23+ and Git installed. For Windows users, WSL 2 is required. The quickest way to get started is by cloning the ElizaOS starter repository with \`git clone https://github.com/elizaos/eliza-starter.git\`, then run \`cd eliza-starter && cp .env.example .env && bun i && bun run build && bun start\`. This will set up a development environment with the core features enabled. After starting, you can access the web interface at http://localhost:3000 to interact with your agent.`,
          actions: ["READ_MCP_RESOURCE"],
        },
      },
    ],
  ],
};
