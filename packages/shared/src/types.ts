export type ServerInfo = {
  pid: number;
  port: number;
  host: string;
  name: string;
  path: string | null;
  commandLine: string | null;
  isSelf: boolean;
  isProxy: boolean;
  siblingPorts: number[];
};

export type ServersResponse = {
  servers: ServerInfo[];
};

export type KillRequest = { pid: number; port?: never } | { port: number; pid?: never };

export type KillResponse = {
  success: boolean;
  message: string;
};

export type HealthResponse = {
  status: 'ok';
  pid: number;
  port: number;
};
