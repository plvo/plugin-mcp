import { logger } from '@elizaos/core';

export const mcpLogger = {
  trace: (message: string, ...args: unknown[]) => logger.trace(`[MCP] ${message}`, ...args),
  debug: (message: string, ...args: unknown[]) => logger.debug(`[MCP] ${message}`, ...args),
  info: (message: string, ...args: unknown[]) => logger.info(`[MCP] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn(`[MCP] ${message}`, ...args),
  error: (message: string, ...args: unknown[]) => logger.error(`[MCP] ${message}`, ...args),
};
