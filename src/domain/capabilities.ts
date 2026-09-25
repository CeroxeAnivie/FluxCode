export interface ModelCapability {
  id: string;
  name: string;
  description: string;
  efforts: string[];
  modalities: string[];
}
export interface SkillCapability {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
}
export interface McpCapability {
  name: string;
  status: string;
  tools: number;
  error: string | null;
}
