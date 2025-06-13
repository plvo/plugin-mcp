import {
  type Content,
  ContentType,
  type HandlerCallback,
  type IAgentRuntime,
  type Media,
  type Memory,
  ModelType,
  createUniqueUuid,
} from '@elizaos/core';
import { mcpLogger } from "./mcp-logger";
import { type State, composePromptFromState } from '@elizaos/core';
import { toolReasoningTemplate } from '@/templates/toolReasoningTemplate';
import { createMcpMemory } from './mcp';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpProvider } from '@/types';

function getMimeTypeToContentType(mimeType?: string): ContentType | undefined {
  if (!mimeType) return undefined;

  if (mimeType.startsWith('image/')) return ContentType.IMAGE;
  if (mimeType.startsWith('video/')) return ContentType.VIDEO;
  if (mimeType.startsWith('audio/')) return ContentType.AUDIO;
  if (mimeType.includes('pdf') || mimeType.includes('document')) return ContentType.DOCUMENT;

  return undefined;
}

export function processResourceResult(
  result: {
    contents: Array<{
      uri: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    }>;
  },
  uri: string
): { resourceContent: string; resourceMeta: string } {
  let resourceContent = '';
  let resourceMeta = '';

  for (const content of result.contents) {
    if (content.text) {
      resourceContent += content.text;
    } else if (content.blob) {
      resourceContent += `[Binary data - ${content.mimeType || 'unknown type'}]`;
    }

    resourceMeta += `Resource: ${content.uri || uri}\n`;
    if (content.mimeType) {
      resourceMeta += `Type: ${content.mimeType}\n`;
    }
  }

  return { resourceContent, resourceMeta };
}

interface ProcessToolResultOptions {
  runtime: IAgentRuntime;
  result: CallToolResult;
  serverName: string;
  toolName: string;
  messageEntityId: string;
}

interface ProcessedToolResult {
  toolOutput: string;
  hasAttachments: boolean;
  attachments: Media[];
}

export function processToolResult({
  runtime,
  result,
  serverName,
  toolName,
  messageEntityId,
}: ProcessToolResultOptions): ProcessedToolResult {
  let toolOutput = '';
  let hasAttachments = false;
  const attachments: Media[] = [];

  for (const content of result.content) {
    if (content.type === 'text') {
      toolOutput += content.text;
    } else if (content.type === 'image') {
      hasAttachments = true;
      attachments.push({
        contentType: getMimeTypeToContentType(content.mimeType),
        url: `data:${content.mimeType};base64,${content.data}`,
        id: createUniqueUuid(runtime, messageEntityId),
        title: 'Generated image',
        source: `${serverName}/${toolName}`,
        description: 'Tool-generated image',
        text: 'Generated image',
      });
    } else if (content.type === 'resource') {
      const resource = content.resource;
      if (resource && 'text' in resource) {
        toolOutput += `\n\nResource (${resource.uri}):\n${resource.text}`;
      } else if (resource && 'blob' in resource) {
        toolOutput += `\n\nResource (${resource.uri}): [Binary data]`;
      }
    }
  }

  return { toolOutput, hasAttachments, attachments };
}

interface HandleToolResponse {
  runtime: IAgentRuntime;
  state: State;
  message: Memory;
  serverName: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  toolOutput: string;
  hasAttachments: boolean;
  attachments: Media[];
  mcpProvider: McpProvider;
  callback?: HandlerCallback;
}

export async function handleToolResponse({
  runtime,
  state,
  message,
  serverName,
  toolName,
  toolArguments,
  toolOutput,
  hasAttachments,
  attachments,
  mcpProvider,
  callback,
}: HandleToolResponse): Promise<void> {
  await createMcpMemory(runtime, message, 'tool', serverName, toolOutput, {
    toolName,
    arguments: toolArguments,
    isToolCall: true,
  });

  const reasoningPrompt = createReasoningPrompt(
    state,
    mcpProvider,
    toolName,
    serverName,
    message.content.text || '',
    toolOutput,
    hasAttachments
  );

  mcpLogger.info('reasoning prompt: ', reasoningPrompt);

  const reasonedResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
    prompt: reasoningPrompt,
  });

  const agentId = message.agentId || runtime.agentId;
  const replyMemory: Memory = {
    entityId: agentId,
    roomId: message.roomId,
    worldId: message.worldId,
    content: {
      text: reasonedResponse,
      thought: `I analyzed the output from the ${toolName} tool on ${serverName} and crafted a thoughtful response that addresses the user's request while maintaining my conversational style.`,
      actions: ['CALL_MCP_TOOL'],
      attachments: hasAttachments && attachments.length > 0 ? attachments : undefined,
    },
  };

  await runtime.createMemory(replyMemory, 'messages');

  if (callback) {
    await callback({
      text: reasonedResponse,
      thought: `I analyzed the output from the ${toolName} tool on ${serverName} and crafted a thoughtful response that addresses the user's request while maintaining my conversational style.`,
      actions: ['CALL_MCP_TOOL'],
      attachments: hasAttachments && attachments.length > 0 ? attachments : undefined,
    });
  }
}

export async function sendInitialResponse(callback?: HandlerCallback): Promise<void> {
  if (callback) {
    const responseContent: Content = {
      thought:
        'The user is asking for information that can be found in an MCP resource. I will retrieve and analyze the appropriate resource.',
      text: "I'll retrieve that information for you. Let me access the resource...",
      actions: ['READ_MCP_RESOURCE'],
    };
    await callback(responseContent);
  }
}


function createReasoningPrompt(
  state: State,
  mcpProvider: {
    values: { mcp: unknown };
    data: { mcp: unknown };
    text: string;
  },
  toolName: string,
  serverName: string,
  userMessage: string,
  toolOutput: string,
  hasAttachments: boolean
): string {
  const enhancedState: State = {
    ...state,
    values: {
      ...state.values,
      mcpProvider,
      toolName,
      serverName,
      userMessage,
      toolOutput,
      hasAttachments,
    },
  };

  return composePromptFromState({
    state: enhancedState,
    template: toolReasoningTemplate,
  });
}
