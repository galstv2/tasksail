export type LogExplorerCategory = 'info' | 'warn' | 'error';
export type LogExplorerRecordLevel = 'debug' | 'info' | 'warn' | 'error' | 'other';
export type LogExplorerLevelFilter = 'all' | LogExplorerRecordLevel;

export type LogExplorerFileEntry = {
  category: LogExplorerCategory;
  fileName: string;
  displayName: string;
  sizeBytes: number;
  modifiedAt: string;
  modifiedAtMs: number;
};

export type LogExplorerListFilesRequest = {
  action: 'logExplorer.listFiles';
  payload?: undefined;
};

export type LogExplorerListFilesResponse = {
  action: 'logExplorer.listFiles';
  mode: 'read-only';
  message: string;
  sourceLabel: string;
  categories: Record<LogExplorerCategory, LogExplorerFileEntry[]>;
};

export type LogExplorerReadFilePayload = {
  category: LogExplorerCategory;
  fileName: string;
  startLine?: number;
  beforeLine?: number;
  limit?: number;
  tail?: boolean;
  levelFilter?: LogExplorerLevelFilter;
};

export type LogExplorerReadFileRequest = {
  action: 'logExplorer.readFile';
  payload: LogExplorerReadFilePayload;
};

export type LogExplorerRecord = {
  lineNumber: number;
  parsed: boolean;
  prettyJson: string;
  raw: string;
  truncated?: boolean;
  parseError?: string;
  summary: {
    ts?: string;
    level: LogExplorerRecordLevel;
    rawLevel?: string;
    stack?: string;
    module?: string;
    msg?: string;
    taskId?: string | null;
    agentId?: string | null;
  };
};

export type LogExplorerReadFileResponse = {
  action: 'logExplorer.readFile';
  mode: 'read-only';
  message: string;
  category: LogExplorerCategory;
  fileName: string;
  displayName: string;
  sizeBytes: number;
  modifiedAt: string;
  totalLines: number;
  totalMatchingLines: number;
  startLine: number;
  endLine: number;
  hasOlder: boolean;
  hasNewer: boolean;
  levelFilter: LogExplorerLevelFilter;
  truncatedResponse?: boolean;
  records: LogExplorerRecord[];
};
