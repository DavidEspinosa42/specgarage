import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { SpecGarageError } from '../domain/errors.ts';
import { type AppOptions, createApp } from './app.ts';

export interface RunningServer {
  /** Address to open in a browser, for example `http://127.0.0.1:8787`. */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** The server only ever listens on the loopback interface. */
export const HOST = '127.0.0.1';

/**
 * Starts the local server. Port 0 picks a free port, which is useful in tests.
 */
export function startServer(options: AppOptions & { port: number }): Promise<RunningServer> {
  const app = createApp(options);
  return new Promise((resolve, reject) => {
    // Without TLS or HTTP/2 options, serve() returns a plain HTTP server.
    const server = serve(
      { fetch: app.fetch, port: options.port, hostname: HOST },
      (info: AddressInfo) => {
        server.off('error', onError);
        resolve({
          url: `http://${HOST}:${info.port}`,
          port: info.port,
          close: () =>
            new Promise<void>((done, fail) => {
              server.close((error) => (error ? fail(error) : done()));
              server.closeAllConnections();
            }),
        });
      },
    ) as Server;
    const onError = (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new SpecGarageError(
              'conflict',
              `Port ${options.port} is already in use. Set SPECGARAGE_PORT or pass --port to choose another.`,
            )
          : error,
      );
    };
    server.once('error', onError);
  });
}
