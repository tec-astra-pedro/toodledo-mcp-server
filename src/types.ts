/**
 * Domain models for the Toodledo API v3.
 *
 * These interfaces are deliberately non-exhaustive: Toodledo returns more
 * fields than are modeled here (which ones depend on the `fields` request
 * parameter), so each resource carries a `[key: string]: any` catch-all.
 * Do not treat them as closed schemas when deriving JSON Schemas.
 */

/**
 * A Toodledo task. The API always returns `id`, `title`, `modified`, and
 * `completed` (a unix timestamp, or 0 when the task is open); everything
 * else is opt-in via the `fields` request parameter.
 */
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

/** A Toodledo note. Notes are standalone — they do not attach to tasks. */
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

/**
 * A Toodledo list (a spreadsheet-like collection; rows/columns are managed
 * through separate API endpoints).
 */
export interface ToodledoList {
  /**
   * List IDs are hex strings (e.g. "6a4726f3d4eac24e1a0ad495"), unlike the
   * numeric IDs used by tasks, notes, and folders.
   */
  id: string;
  title: string;
  ref?: string;
  /** Conflict-detection counter; mandatory when editing. */
  version?: number;
  keywords?: string;
  note?: string;
  [key: string]: any;
}

/** A Toodledo folder. Folders are named via `name`, not `title`. */
export interface ToodledoFolder {
  id: number;
  name: string;
  private?: number;
  archived?: number;
  ord?: number;
  [key: string]: any;
}

// --- Request payload types ---

/** Payload for creating a task via tasks/add.php. Only `title` is required. */
export interface TaskCreateRequest {
  title: string;
  list_id?: number;
  folder_id?: number;
  description?: string;
}

/** Payload for creating notes via notes/add.php. Only `title` is required per note. */
export interface NoteCreateRequest {
  notes: Array<{
    title: string;
    text?: string;
    folder?: number;
  }>;
}

/**
 * Payload for creating a list via lists/add.php. Toodledo also requires a
 * `ref` (duplicate-detection key); ToodledoClient generates one when the
 * caller doesn't supply it.
 */
export interface ListCreateRequest {
  title: string;
  ref?: string;
}

/** Generic envelope for API responses that report a status alongside data. */
export interface CommonResponse<T> {
  status: string;
  data?: T;
  error?: string;
}
