import { MCP_SERVICE_NAME, type McpProvider } from '@/types';
import { mcpLogger } from './mcp-logger';
import type { McpService } from '@/service';
import type { HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';

export type HandlersOptions = {
  [key: string]: unknown;
};

export interface UseActionHandlerOptions {
  actionName: string;
  runtime: IAgentRuntime;
  message: Memory;
  state?: State;
  options?: HandlersOptions;
  callback?: HandlerCallback;
}

export interface ActionHandlerContext {
  runtime: IAgentRuntime;
  message: Memory;
  state: State;
  options?: HandlersOptions;
  callback?: HandlerCallback;
  mcpService: McpService;
  mcpProvider: McpProvider;
}

export async function useActionHandler({
  actionName,
  runtime,
  message,
  state,
  options,
  callback,
}: UseActionHandlerOptions): Promise<ActionHandlerContext> {
  mcpLogger.info(`[USE-ACTION] [${actionName}] Starting handler with message: "${message.content.text}"`);

  const composedState = await runtime.composeState(message);

  const mcpService = runtime.getService<McpService>(MCP_SERVICE_NAME);
  if (!mcpService) {
    throw new Error(`[USE-ACTION] [${actionName}] MCP service not available`);
  }

  // Get MCP provider data
  const mcpProvider = mcpService.getProviderData();
  mcpLogger.trace(`[USE-ACTION] [${actionName}] Provider Data: ${mcpProvider}`);

  return {
    runtime,
    message,
    state: composedState,
    options,
    callback,
    mcpService,
    mcpProvider,
  } satisfies ActionHandlerContext;
}
