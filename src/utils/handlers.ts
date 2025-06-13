import { resourceAnalysisTemplate } from '@/templates/resourceAnalysisTemplate';
import { createMcpMemory } from '@/utils/mcp';
import { mcpLogger } from '@/utils/mcp-logger';
import {
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  composePromptFromState,
} from '@elizaos/core';

interface HandleResourceAnalysisParams {
  runtime: IAgentRuntime;
  message: Memory;
  uri: string;
  serverName: string;
  resourceContent: string;
  resourceMeta: string;
  callback?: HandlerCallback;
}

/**
 *  Handles the analysis of a resource fetched from an MCP server.
 * @param runtime - The agent runtime instance.
 * @param message - The message object containing the user's request.
 * @param uri - The URI of the resource.
 * @param serverName - The name of the MCP server.
 * @param resourceContent - The content of the resource.
 * @param resourceMeta - The metadata of the resource.
 * @param callback - Optional callback function to handle the response.
 * @returns A promise that resolves when the analysis is complete.
 */
export async function handleResourceAnalysis({
  runtime,
  message,
  uri,
  serverName,
  resourceContent,
  resourceMeta,
  callback,
}: HandleResourceAnalysisParams): Promise<void> {
  // Create a memory entry for the resource
  mcpLogger.debug(`[HANDLER] Creating memory entry for resource: ${uri} on server: ${serverName}`);
  await createMcpMemory(runtime, message, 'resource', serverName, resourceContent, {
    uri,
    isResourceAccess: true,
  });

  // Generate a thoughtful response based on the resource content
  mcpLogger.debug(`[HANDLER] Generating response based on resource content: ${uri} on server: ${serverName}`);
  const analysisPrompt = createAnalysisPrompt(uri, message.content.text || '', resourceContent, resourceMeta);

  mcpLogger.debug(`[HANDLER] Analysis prompt created: ${analysisPrompt}`);
  const analyzedResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: analysisPrompt,
  });

  if (callback) {
    await callback({
      text: analyzedResponse,
      thought: `I analyzed the content from the ${uri} resource on ${serverName} and crafted a thoughtful response that addresses the user's request while maintaining my conversational style.`,
      actions: ['READ_MCP_RESOURCE'],
    });
  }
}

function createAnalysisPrompt(uri: string, userMessage: string, resourceContent: string, resourceMeta: string): string {
  const enhancedState: State = {
    data: {},
    text: '',
    values: {
      uri,
      userMessage,
      resourceContent,
      resourceMeta,
    },
  };

  return composePromptFromState({
    state: enhancedState,
    template: resourceAnalysisTemplate,
  });
}

export function handleNoResourceAvailable(callback?: HandlerCallback): boolean {
  if (callback) {
    callback({
      text: "I don't have a specific resource that contains the information you're looking for. Let me try to assist you directly instead.",
      thought: 'No appropriate MCP resource available for this request. Falling back to direct assistance.',
      actions: ['REPLY'],
    });
  }

  return true;
}


export function handleNoToolAvailable(
  callback?: HandlerCallback,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  toolSelection?: Record<string, any> | null
): boolean {
  if (callback && toolSelection?.noToolAvailable) {
    callback({
      text: "I don't have a specific tool that can help with that request. Let me try to assist you directly instead.",
      thought:
        "No appropriate MCP tool available for this request. Falling back to direct assistance.",
      actions: ["REPLY"],
    });
  }

  return true;
}

