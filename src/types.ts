import type { AxiosInstance } from 'axios';

export interface ToodledoTask {
  id: number;
  title: string;
  description?: string;
  list_id?: number;
  folder_id?: number;
  status?: string;
  due_date?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface ToodledoNote {
  id: number;
  title: string;
  text?: string;
  folder?: number;
  added?: number;
  modified?: number;
  private?: number;
  [key: string]: any;
}

export interface ToodledoList {
  // List IDs are hex strings (e.g. "6a4726f3d4eac24e1a0ad495"), unlike the
  // numeric IDs used by tasks/notes/folders.
  id: string;
  title: string;
  ref?: string;
  version?: number;
  keywords?: string;
  note?: string;
  [key: string]: any;
}

export interface ToodledoFolder {
  id: number;
  name: string;
  private?: number;
  archived?: number;
  ord?: number;
  [key: string]: any;
}

// Request payload types
export interface TaskCreateRequest {
  title: string;
  list_id?: number;
  folder_id?: number;
  description?: string;
}

export interface NoteCreateRequest {
  notes: Array<{
    title: string;
    text?: string;
    folder?: number;
  }>;
}

export interface ListCreateRequest {
  title: string;
  ref?: string;
}

export interface CommonResponse<T> {
  status: string;
  data?: T;
  error?: string;
}
