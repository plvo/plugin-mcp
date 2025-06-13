import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { mcpLogger } from "@/utils/mcp-logger";
import { handleMcpError } from "@/utils/error";
import { handleToolResponse, processToolResult } from "@/utils/processing";
import { createToolSelectionArgument, createToolSelectionName } from "@/utils/selection";
import { useActionHandler } from "@/utils/use-action";
import { validateAction } from "@/utils/validation";
import { handleNoToolAvailable } from "@/utils/handlers";

const ACTION_NAME = "CALL_TOOL";

export const callToolAction: Action = {
  name: ACTION_NAME,
  similes: [
    "CALL_MCP_TOOL",
    "USE_TOOL",
    "USE_MCP_TOOL",
    "EXECUTE_TOOL",
    "EXECUTE_MCP_TOOL",
    "RUN_TOOL",
    "RUN_MCP_TOOL",
    "INVOKE_TOOL",
    "INVOKE_MCP_TOOL",
  ],
  description: "Calls a tool from an MCP server to perform a specific task",

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
      // Select the tool with this servername and toolname
      const toolSelectionName = await createToolSelectionName({...context});
      if (!toolSelectionName || toolSelectionName.noToolAvailable) {
        mcpLogger.warn("[NO_TOOL_AVAILABLE] No appropriate tool available for the request");
        return handleNoToolAvailable(callback, toolSelectionName);
      }
      const { serverName, toolName, reasoning } = toolSelectionName;
      mcpLogger.info(`[CALLING] Calling tool "${serverName}/${toolName}" on server with reasoning: "${reasoning}"`);

      const toolSelectionArgument = await createToolSelectionArgument({ ...context, toolSelectionName });
      if (!toolSelectionArgument) {
        mcpLogger.warn("[NO_TOOL_SELECTION_ARGUMENT] No appropriate tool selection argument available");
        return handleNoToolAvailable(callback, toolSelectionName);
      }
      mcpLogger.info(`[SELECTED] Tool Selection result:\n${JSON.stringify(toolSelectionArgument, null, 2)}`);

      const result = await context.mcpService.callTool(serverName, toolName, toolSelectionArgument.toolArguments);
      mcpLogger.info(`[CALLED] Tool "${serverName}/${toolName}" result:\n"${JSON.stringify(result, null, 2)}"`);

      const { toolOutput, hasAttachments, attachments } = processToolResult({
        ...context,
        result,
        serverName,
        toolName,
        messageEntityId: context.message.entityId,
      });

      mcpLogger.info('[HANDLE] Handling tool response...');
      await handleToolResponse({
        ...context,
        serverName,
        toolName,
        toolArguments: toolSelectionArgument.toolArguments,
        toolOutput,
        hasAttachments,
        attachments,
      });

      return true;
    } catch (error) {
      return await handleMcpError({ ...context, type: 'tool', error });
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Can you search for information about climate change?",
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll help you with that request. Let me access the right tool...",
          actions: ["CALL_MCP_TOOL"],
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I found the following information about climate change:\n\nClimate change refers to long-term shifts in temperatures and weather patterns. These shifts may be natural, but since the 1800s, human activities have been the main driver of climate change, primarily due to the burning of fossil fuels like coal, oil, and gas, which produces heat-trapping gases.",
          actions: ["CALL_MCP_TOOL"],
        },
      },
    ],
  ],
};
