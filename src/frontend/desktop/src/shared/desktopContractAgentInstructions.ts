// Agent instructions contract types — extracted from desktopContract.ts for file-size compliance.

export type InstructionFileEntry = {
  fileName: string;
  relativePath: string;
};

export type InstructionDirectory = 'profiles' | 'instructions' | 'prompts' | 'templates';

export type AgentInstructionsListFilesRequest = {
  action: 'agentInstructions.listFiles';
  payload: { directory: InstructionDirectory };
};

export type AgentInstructionsListFilesResponse = {
  action: 'agentInstructions.listFiles';
  mode: 'read-only';
  message: string;
  files: InstructionFileEntry[];
};

export type AgentInstructionsReadFileRequest = {
  action: 'agentInstructions.readFile';
  payload: { relativePath: string };
};

export type AgentInstructionsReadFileResponse = {
  action: 'agentInstructions.readFile';
  mode: 'read-only';
  message: string;
  fileName: string;
  relativePath: string;
  content: string;
};

export type AgentInstructionsWriteFileRequest = {
  action: 'agentInstructions.writeFile';
  payload: { relativePath: string; content: string };
};

export type AgentInstructionsWriteFileResponse = {
  action: 'agentInstructions.writeFile';
  mode: 'mutated';
  message: string;
  fileName: string;
  relativePath: string;
};
