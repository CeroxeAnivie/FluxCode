export interface Plugin {
  id: string;
  name: string;
  marketplace: string;
  marketplacePath: string | null;
  installed: boolean;
  enabled: boolean;
}
