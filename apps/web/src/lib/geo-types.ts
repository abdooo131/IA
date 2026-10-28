export interface ImportStatus {
  kind: 'places' | 'streets' | null;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  done: number;
  total: number;
  found: number;
  saved: number;
  failed: string[];
  error: string | null;
}

export interface GeoOverview {
  areasByLevel: Record<string, number>;
  placedByMethod: Record<string, number>;
  pendingSuggestions: number;
  import: ImportStatus;
}

export interface AreaRef {
  id: string;
  level: number;
  nameEn: string;
  nameAr: string;
}

export interface GeoSuggestion {
  id: string;
  phrase: string;
  sampleAddress: string;
  seen: number;
  area: AreaRef;
  updatedAt: string;
}

export interface AreaSearchRow extends AreaRef {
  parentEn: string | null;
  aliases: string[];
}

export type EngineAnswer =
  | { status: 'zone'; darkStoreId: string; chain: AreaRef[]; matched: string[] }
  | { status: 'outside'; chain: AreaRef[]; matched: string[] }
  | { status: 'unsure'; chain: AreaRef[]; matched: string[]; reason: string };
