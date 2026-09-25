export interface Schedule {
  id: string;
  name: string;
  project: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRun: number;
  status: string;
  lastThreadId: string | null;
}
