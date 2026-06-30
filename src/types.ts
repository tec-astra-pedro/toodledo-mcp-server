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
  task_id?: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ToodledoList {
  id: number;
  title: string;
  ref?: string;
  version?: number;
  folder_id?: number;
  description?: string;
}

export interface ToodledoFolder {
  id: number;
  title: string;
  description?: string;
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
    task_id?: number;
    content: string;
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
