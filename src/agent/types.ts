export type AgentOk = {
  kind: 'ok';
  payload: Record<string, unknown>;
  help?: string[];
};

export type AgentErr = {
  kind: 'error';
  message: string;
  help?: string[];
  exitCode?: 1 | 2;
};

export type AgentResult = AgentOk | AgentErr;

export function ok(payload: Record<string, unknown>, help?: string[]): AgentOk {
  return { kind: 'ok', payload, help };
}

export function err(message: string, help?: string[], exitCode: 1 | 2 = 1): AgentErr {
  return { kind: 'error', message, help, exitCode };
}
