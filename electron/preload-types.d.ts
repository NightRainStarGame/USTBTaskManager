import type { TaskAPI } from './preload.js';

declare global {
  interface Window {
    taskAPI: TaskAPI;
  }
}

export {};