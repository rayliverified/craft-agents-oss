/**
 * Spawn Worker
 *
 * Runs synchronous child process operations in a worker thread to avoid
 * blocking the main thread on Windows, where CreateProcess is expensive.
 *
 * This is critical for Electron apps where the main process owns all
 * window message pumps — any synchronous spawn blocks UI responsiveness.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';

export interface ExecTask {
  command: string;
  args: string[];
  options: ExecFileSyncOptions;
}

export interface ExecResult {
  success: true;
  result: string;
}

export interface ExecError {
  success: false;
  error: string;
}

type ExecTaskResult = ExecResult | ExecError;

// Worker entry point
if (parentPort) {
  const task = workerData as ExecTask;
  try {
    const result = execFileSync(task.command, task.args, {
      ...task.options,
      encoding: 'utf-8',
    }) as string;
    parentPort.postMessage({
      success: true,
      result,
    } as ExecResult);
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: (error as Error).message,
    } as ExecError);
  }
}

/**
 * Execute a command in a worker thread to avoid blocking the main thread.
 *
 * @param command - The executable to run (e.g., 'git', 'where', 'which')
 * @param args - Command line arguments
 * @param options - Options for execFileSync
 * @returns The stdout of the command, or throws an error
 */
export async function execInWorker(
  command: string,
  args: string[],
  options: ExecFileSyncOptions = {},
): Promise<string> {
  const { Worker } = await import('node:worker_threads');

  const task: ExecTask = {
    command,
    args,
    options: {
      ...options,
      encoding: 'utf-8',
    },
  };

  const worker = new Worker(
    new URL(import.meta.url),
    { workerData: task },
  );

  return new Promise<string>((resolve, reject) => {
    const timeout = options.timeout ? Number(options.timeout) : 5000;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      worker.terminate();
      reject(new Error(`Command "${command} ${args.join(' ')}" timed out after ${timeout}ms`));
    }, timeout);

    worker.once('message', (message: ExecTaskResult) => {
      clearTimeout(timer);
      if (timedOut) return;

      worker.terminate();

      if (message.success) {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    });

    worker.once('error', (error) => {
      clearTimeout(timer);
      if (timedOut) return;

      reject(error);
    });

    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0 && code !== null) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}