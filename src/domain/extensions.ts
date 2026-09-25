export interface McpDefinition {
  name: string;
  enabled: boolean;
  command: string | null;
  args: string[];
  url: string | null;
  bearerTokenEnvVar: string | null;
}
