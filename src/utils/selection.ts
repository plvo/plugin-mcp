import {
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  composePromptFromState,
} from "@elizaos/core";
import { mcpLogger } from "./mcp-logger";
import { withModelRetry } from "./wrapper";
import type { McpProvider, McpProviderData } from "@/types";
import type { ToolSelectionName, ToolSelectionArgument, ResourceSelection } from "./schemas";
import {
  toolSelectionArgumentTemplate,
  toolSelectionNameTemplate,
} from "@/templates/toolSelectionTemplate";
import { validateResourceSelection, validateToolSelectionArgument, validateToolSelectionName } from "./validation";
import { resourceSelectionTemplate } from "@/templates/resourceSelectionTemplate";

export interface CreateToolSelectionOptions {
  runtime: IAgentRuntime;
  state: State;
  message: Memory;
  callback?: HandlerCallback;
  mcpProvider: McpProvider;
  toolSelectionName?: ToolSelectionName;
}

/**
 *  Creates a tool selection name based on the current state and MCP provider.
 * @returns A tool selection name object or null if the selection is invalid.
 * ```json
 * {
 *  "serverName": "github",
 *  "toolName": "get_file_contents",
 *  "reasoning": "The user wants to see the README from the facebook/react repository based on our conversation."
 *  "noToolSelection": false
 * }
 * ```
 */
export async function createToolSelectionName({
  runtime,
  state,
  message,
  callback,
  mcpProvider,
}: CreateToolSelectionOptions): Promise<ToolSelectionName | null> {
  const toolSelectionPrompt: string = composePromptFromState({
    state: { ...state, values: { ...state.values, mcpProvider } },
    template: toolSelectionNameTemplate,
  });
  mcpLogger.debug(`[SELECTION] Tool Selection Name Prompt:\n${toolSelectionPrompt}`);

  // Use the model to generate a tool selection stringified json response
  const toolSelectionName: string = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: toolSelectionPrompt,
  });
  mcpLogger.debug(`[SELECTION] Tool Selection Name Response:\n${toolSelectionName}`);

  return await withModelRetry<ToolSelectionName>({
    runtime,
    message,
    state,
    callback,
    input: toolSelectionName,
    validationFn: (parsed) => validateToolSelectionName(parsed, state),
    createFeedbackPromptFn: (originalResponse, errorMessage, state, userMessage) =>
      createToolSelectionFeedbackPrompt(originalResponse, errorMessage, state, userMessage),
    failureMsg: "I'm having trouble figuring out the best way to help with your request.",
  });
}
/**
 * Creates a tool selection argument based on the current state and MCP provider.
 * @returns  A tool selection argument object or null if the selection is invalid.
 * ```json
 * {
 *  "toolArguments": {
 *    "file_path": "facebook/react/README.md",
 *    "repo": "facebook/react"
 *  },
 *  "reasoning": "The user wants to see the README from the facebook/react repository based on our conversation."
 * }
 */
export async function createToolSelectionArgument({
  runtime,
  state,
  message,
  callback,
  mcpProvider,
  toolSelectionName,
}: CreateToolSelectionOptions): Promise<ToolSelectionArgument | null> {
  if (!toolSelectionName) {
    mcpLogger.warn(
      "[SELECTION] Tool selection name is not provided. Cannot create tool selection argument."
    );
    return null;
  }
  const { serverName, toolName } = toolSelectionName;
  const toolInputSchema = mcpProvider.data.mcp[serverName].tools[toolName].inputSchema;
  mcpLogger.trace(`[SELECTION] Tool Input Schema:\n${JSON.stringify({ toolInputSchema }, null, 2)}`);

  // Create a tool selection argument prompt
  const toolSelectionArgumentPrompt: string = composePromptFromState({
    state: {
      ...state,
      values: {
        ...state.values,
        toolSelectionName,
        toolInputSchema: JSON.stringify(toolInputSchema),
      },
    },
    template: toolSelectionArgumentTemplate,
  });
  mcpLogger.debug(`[SELECTION] Tool Selection Prompt:\n${toolSelectionArgumentPrompt}`);

  // Use the model to generate a tool selection argument stringified json response
  const toolSelectionArgument: string = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: toolSelectionArgumentPrompt,
  });
  mcpLogger.debug(`[SELECTION] Tool Selection Argument Response:\n${toolSelectionArgument}`);

  return await withModelRetry<ToolSelectionArgument>({
    runtime,
    message,
    state,
    callback,
    input: toolSelectionArgument,
    validationFn: (parsed) => validateToolSelectionArgument(parsed, state),
    createFeedbackPromptFn: (originalResponse, errorMessage, state, userMessage) =>
      createToolSelectionFeedbackPrompt(originalResponse, errorMessage, state, userMessage),
    failureMsg: "I'm having trouble figuring out the best way to help with your request.",
  });
}

function createToolSelectionFeedbackPrompt(
  originalResponse: string | object,
  errorMessage: string,
  state: State,
  userMessage: string
): string {
  let toolsDescription = "";

  for (const [serverName, server] of Object.entries(state.values.mcp || {}) as [
    string,
    McpProviderData[string],
  ][]) {
    if (server.status !== "connected") continue;

    for (const [toolName, tool] of Object.entries(server.tools || {})) {
      toolsDescription += `Tool: ${toolName} (Server: ${serverName})\n`;
      toolsDescription += `Description: ${tool.description || "No description available"}\n\n`;
    }
  }

  const feedbackPrompt = createFeedbackPrompt(
    originalResponse,
    errorMessage,
    "tool",
    toolsDescription,
    userMessage
  );
  mcpLogger.debug(`[SELECTION] Tool Selection Feedback Prompt:\n${feedbackPrompt}`);
  return feedbackPrompt;
}

function createFeedbackPrompt(
  originalResponse: string | object,
  errorMessage: string,
  itemType: string,
  itemsDescription: string,
  userMessage: string
): string {
  return `Error parsing JSON: ${errorMessage}
  
  Your original response:
  ${originalResponse}
  
  Please try again with valid JSON for ${itemType} selection.
  Available ${itemType}s:
  ${itemsDescription}
  
  User request: ${userMessage}`;
}


interface CreateResourceSelection {
  runtime: IAgentRuntime;
  state: State;
  message: Memory;
  callback?: HandlerCallback;
}

export async function createResourceSelection({
  runtime,
  state,
  message,
  callback,
}: CreateResourceSelection): Promise<ResourceSelection> {
  // Select appropriate prompt
  mcpLogger.info('[SELECTION] Selecting resource based on the current state...');
  const resourceSelectionPrompt = createResourceSelectionPrompt({
    state,
    userMessage: message.content.text || '',
  });
  mcpLogger.info(`[SELECTION] Resource Selection Prompt: ${resourceSelectionPrompt}`);

  // Call the model to get the resource selection
  mcpLogger.info('[SELECTION] Calling model to get resource selection...');
  const resourceSelection = await runtime.useModel(ModelType.OBJECT_LARGE, {
    prompt: resourceSelectionPrompt,
  });
  mcpLogger.info(`[SELECTION] Resource Selection Response: ${resourceSelection}`);

  const parsedSelection = await withModelRetry<ResourceSelection>({
    runtime,
    state,
    message,
    callback,
    input: resourceSelection,
    validationFn: (data) => validateResourceSelection(data),
    createFeedbackPromptFn: (originalResponse, errorMessage, state, userMessage) =>
      createResourceSelectionFeedbackPrompt(originalResponse, errorMessage, state, userMessage),
    failureMsg: `I'm having trouble finding the resource you're looking for. Could you provide more details about what you need?`,
    retryCount: 0,
  });
  mcpLogger.info(`[SELECTION] Parsed Resource Selection: ${JSON.stringify(parsedSelection)}`);

  return parsedSelection;
}

interface CreateResourceSelectionPromptOptions {
  state: State;
  userMessage: string;
}

function createResourceSelectionPrompt({ state, userMessage }: CreateResourceSelectionPromptOptions): string {
  const mcpData = state.values.mcp || {};
  const serverNames = Object.keys(mcpData);

  let resourcesDescription = '';
  for (const serverName of serverNames) {
    const server = mcpData[serverName];
    if (server.status !== 'connected') continue;

    const resourceUris = Object.keys(server.resources || {});
    for (const uri of resourceUris) {
      const resource = server.resources[uri];
      resourcesDescription += `Resource: ${uri} (Server: ${serverName})\n`;
      resourcesDescription += `Name: ${resource.name || 'No name available'}\n`;
      resourcesDescription += `Description: ${resource.description || 'No description available'}\n`;
      resourcesDescription += `MIME Type: ${resource.mimeType || 'Not specified'}\n\n`;
    }
  }

  const enhancedState: State = {
    ...state,
    values: {
      ...state.values,
      resourcesDescription,
      userMessage,
    },
  };

  return composePromptFromState({
    state: enhancedState,
    template: resourceSelectionTemplate,
  });
}

function createResourceSelectionFeedbackPrompt(
  originalResponse: string | object,
  errorMessage: string,
  state: State,
  userMessage: string,
): string {
  let resourcesDescription = '';

  for (const [serverName, server] of Object.entries(state.values.mcp || {}) as [string, McpProviderData[string]][]) {
    if (server.status !== 'connected') continue;

    for (const [uri, resource] of Object.entries(server.resources || {}) as [
      string,
      { description?: string; name?: string },
    ][]) {
      resourcesDescription += `Resource: ${uri} (Server: ${serverName})\n`;
      resourcesDescription += `Name: ${resource.name || 'No name available'}\n`;
      resourcesDescription += `Description: ${resource.description || 'No description available'}\n\n`;
    }
  }

  return createFeedbackPrompt(originalResponse, errorMessage, 'resource', resourcesDescription, userMessage);
}
