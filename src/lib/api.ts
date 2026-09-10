const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * This portal's name, sent on EVERY request as `X-Portal`.
 *
 * The backend names the session cookie after it (`callsim_auth_admin`) so the
 * admin and agent portals can hold two sessions in one browser. A login also
 * CLEARS the legacy shared `callsim_auth`, so a request that omits this header
 * has no cookie the backend will look for: it 401s and the app logs itself out.
 * That is why this lives at the fetch boundary and not in one helper.
 */
const PORTAL = 'admin';

let logoutInProgress = false;

function handleUnauthorized() {
  if (typeof window === 'undefined' || logoutInProgress) return;
  logoutInProgress = true;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  if (!window.location.pathname.startsWith('/login')) {
    window.location.replace('/login');
  }
  setTimeout(() => { logoutInProgress = false; }, 3000);
}

/**
 * The value held in place of a JWT once the session moved to the httpOnly
 * cookie (security review finding 8). It is TRUTHY on purpose: the whole admin
 * UI gates its data loading on `if (!token) return`, and setting the store's
 * token to null silently disabled every page — AdminShell bailed, nothing
 * loaded, and login appeared to do nothing at all.
 *
 * So the store keeps this marker, the guards keep working, and `request` below
 * knows it is not a bearer token and sends the cookie instead.
 */
export const COOKIE_AUTH_MARKER = '__cookie_auth__';

/**
 * Single auth boundary for every protected browser request, including blobs
 * and multipart uploads that do not use request(). The cookie is the normal
 * browser credential. COOKIE_AUTH_MARKER is UI state only and is defensively
 * removed if an old caller tries to send it as a bearer token.
 */
function sessionFetch(
  input: RequestInfo | URL,
  token: string | undefined,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  // Every request names its portal, or the backend falls back to the legacy
  // cookie name that login cleared and answers 401. Media, blob and multipart
  // callers reach the network here without going through request().
  headers.set('X-Portal', PORTAL);
  if (token === COOKIE_AUTH_MARKER) {
    headers.delete('Authorization');
  } else if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers, credentials: 'include' });
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  token: string | undefined,
  init: RequestInit = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await sessionFetch(input, token, init);
  } catch {
    throw new Error(`Cannot reach the server at ${API_URL}. Is the backend running?`);
  }
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Session expired. Please log in again.');
  }
  return res;
}

async function request<T>(endpoint: string, options: { method?: string; body?: any; token?: string } = {}): Promise<T> {
  const { method = 'GET', body, token } = options;
  // X-Portal is set for every request in sessionFetch, including the media and
  // multipart callers that never reach this helper.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let res: Response;
  try {
    res = await sessionFetch(`${API_URL}${endpoint}`, token, {
      method,
      headers,
      // ── THE COOKIE IS THE SESSION (security review 2026-09-01, finding 8) ──
      // The bearer token used to come out of localStorage, where any script on
      // the page — an XSS, a compromised dependency, a browser extension — can
      // read it and walk away with a seven-day admin session. `callsim_auth` is
      // httpOnly, so script cannot read it, and the browser attaches it here.
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch() rejects only on a transport failure — backend not running, DNS,
    // a blocked preflight. The raw "Failed to fetch" sent people looking for a
    // bug in app code when the actual answer is that nothing is listening.
    throw new Error(`Cannot reach the server at ${API_URL}. Is the backend running?`);
  }

  if (res.status === 401) {
    // A 401 from the login endpoint means the credentials were rejected, not
    // that a session lapsed — there is no session yet at that point. Routing
    // it through handleUnauthorized() reported "Session expired. Please log in
    // again." for what was only a wrong password, which reads as though the
    // login succeeded and then immediately went stale.
    if (endpoint.startsWith('/api/auth/login')) {
      const failed = await res.json().catch(() => ({} as any));
      throw new Error(failed.error || 'Invalid email or password.');
    }
    handleUnauthorized();
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API request failed');
  return data;
}

export const auth = {
  login: (email: string, password: string) =>
    request<any>('/api/auth/login', { method: 'POST', body: { email, password } }),
  // No token argument: the httpOnly cookie is the session and `request`
  // sends it. A caller cannot supply a bearer token it can no longer read.
  getMe: () => request<any>('/api/auth/me'),
  /**
   * The same change-password endpoint the agent portal uses. It is
   * authenticated (Bearer or cookie) and works for admins too — it only
   * verifies the current password and stores the new hash.
   */
  changePassword: (currentPassword: string, newPassword: string) =>
    request<any>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  // Hits the backend with credentials so the httpOnly callsim_auth cookie is
  // actually cleared — localStorage cleanup alone leaves the cookie behind.
  // Through sessionFetch so it carries X-Portal: without it the backend clears
  // only the legacy cookie and this portal's session survives the logout.
  logout: () =>
    sessionFetch(`${API_URL}/api/auth/logout`, undefined, { method: 'POST' }),
};

export type AnalyticsScope = { campaign?: string; agentId?: string };

/** `?campaign=ACA&agentId=…`, or an empty string when nothing is scoped. */
function scopeQuery(scope?: AnalyticsScope): string {
  const q = new URLSearchParams();
  if (scope?.campaign) q.set('campaign', scope.campaign);
  if (scope?.agentId) q.set('agentId', scope.agentId);
  const query = q.toString();
  return query ? `?${query}` : '';
}

export type SignupRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** A request to join, waiting on a trainer. Approving is what creates the user. */
export interface SignupRequest {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: SignupRequestStatus;
  reviewedAt: string | null;
  createdAt: string;
}

export const admin = {
  /**
   * Signup requests waiting on a trainer.
   *
   * Public signup files one of these instead of creating an account, so
   * approving is what actually makes the user. Rejecting keeps the row and
   * the reason, which the applicant is emailed verbatim.
   */
  listSignupRequests: (token: string, status?: string) => {
    const q = status ? '?status=' + encodeURIComponent(status) : '';
    return request<{ success: boolean; data: SignupRequest[] }>(
      `/api/admin/signup-requests${q}`,
      { token },
    );
  },

  approveSignupRequest: (token: string, id: string) =>
    request<{ success: boolean; data: SignupRequest }>(
      `/api/admin/signup-requests/${id}/approve`,
      { method: 'POST', token },
    ),

  rejectSignupRequest: (token: string, id: string) =>
    request<{ success: boolean; data: SignupRequest }>(
      `/api/admin/signup-requests/${id}/reject`,
      { method: 'POST', token },
    ),
  dashboard: (token: string) => request<any>('/api/admin/dashboard', { token }),
  listAgents: (token: string, params?: any) => {
    const q = new URLSearchParams(params).toString();
    return request<any>(`/api/admin/agents?${q}`, { token });
  },
  getAgent: (token: string, id: string) => request<any>(`/api/admin/agents/${id}`, { token }),

  /** Enroll a new agent. Each call creates an independent agent record. */
  enrollAgent: (
    token: string,
    body: {
      fullName: string;
      email: string;
      age?: number;
      trainingStartDate: string;
      temporaryPassword: string;
      employeeId?: string;
      department?: string;
    },
  ) => request<any>('/api/admin/agents', { method: 'POST', body, token }),

  updateAgent: (token: string, id: string, body: any) =>
    request<any>(`/api/admin/agents/${id}`, { method: 'PUT', body, token }),

  resetAgentPassword: (token: string, id: string, temporaryPassword: string) =>
    request<any>(`/api/admin/agents/${id}/reset-password`, {
      method: 'POST',
      body: { temporaryPassword },
      token,
    }),

  /** The agent's resolved journey plus their quiz attempt history. */
  getAgentJourney: (token: string, id: string) =>
    request<any>(`/api/admin/agents/${id}/journey`, { token }),

  /** Clear one journey stage so a single-attempt quiz failure is recoverable. */
  resetAgentStage: (token: string, agentId: string, stageId: string) =>
    request<any>(`/api/admin/agents/${agentId}/journey/${stageId}/reset`, { method: 'POST', token }),
  getAgentPerformance: (token: string, id: string) =>
    request<any>(`/api/admin/agents/${id}/performance`, { token }),
  /**
   * Switch an agent's sign-in on or off.
   *
   * Pass `isActive` to say which way it should end — the button on the Agents
   * screen does, so it cannot accidentally re-enable someone because the row
   * on screen was a few seconds out of date. Omit it for the old flip.
   */
  toggleAgentStatus: (token: string, id: string, isActive?: boolean) =>
    request<any>(`/api/admin/agents/${id}/status`, {
      method: 'PUT',
      token,
      ...(isActive === undefined ? {} : { body: { isActive } }),
    }),
  listCalls: (token: string, params?: any) => {
    const q = new URLSearchParams(params).toString();
    return request<any>(`/api/admin/calls?${q}`, { token });
  },
  getCallDetail: (token: string, id: string) => request<any>(`/api/admin/calls/${id}`, { token }),

  // ── Call recordings ────────────────────────────────────────
  // Stereo WAV per call: trainee on the left channel, customer on the right.
  listRecordings: (token: string, params?: any) => {
    const q = new URLSearchParams(params).toString();
    return request<any>(`/api/admin/recordings?${q}`, { token });
  },
  deleteRecording: (token: string, sessionId: string) =>
    request<any>(`/api/admin/recordings/${sessionId}`, { method: 'DELETE', token }),
  /**
   * Fetch the audio as a blob URL for an <audio> element.
   *
   * The stream endpoint is admin-authenticated, so the URL cannot simply be put
   * in a `src` — the browser would request it without the Authorization header
   * and get a 401. Fetching with the header and wrapping the response in an
   * object URL is what makes playback work while keeping the bytes behind auth.
   * Callers must revokeObjectURL when done or the blob leaks for the page's life.
   */
  recordingBlobUrl: async (token: string, sessionId: string): Promise<string> => {
    const res = await authenticatedFetch(`${API_URL}/api/admin/recordings/${sessionId}/audio`, token);
    if (!res.ok) throw new Error(`Could not load recording (${res.status})`);
    return URL.createObjectURL(await res.blob());
  },
  /**
   * Analytics scope. Both fields optional — omit them for the floor-wide
   * numbers, which is what these endpoints returned before filtering existed.
   */
  analyticsOverview: (token: string, scope?: AnalyticsScope) =>
    request<any>(`/api/admin/analytics/overview${scopeQuery(scope)}`, { token }),
  /**
   * The campaign is already in the path, so only the agent narrows this one
   * further; passing a `campaign` here as well would be a contradiction
   * waiting to happen.
   */
  campaignAnalytics: (token: string, campaign: string, agentId?: string) =>
    request<any>(`/api/admin/analytics/campaign/${campaign}${scopeQuery({ agentId })}`, { token }),
  trends: (token: string, scope?: AnalyticsScope) =>
    request<any>(`/api/admin/analytics/trends${scopeQuery(scope)}`, { token }),
  awaitingVerifier: (token: string) => request<any>('/api/admin/calls/awaiting-verifier', { token }),
  assignVerifier: (token: string, callId: string, agentId: string) =>
    request<any>(`/api/admin/calls/${callId}/assign-verifier`, { method: 'POST', body: { agentId }, token }),
};

export const assignmentsApi = {
  list: (token: string, params?: any) => {
    const q = new URLSearchParams(params).toString();
    return request<any>(`/api/admin/assignments?${q}`, { token });
  },
  cancel: (token: string, id: string) =>
    request<any>(`/api/admin/assignments/${id}`, { method: 'DELETE', token }),
};

export const assignmentsExtra = {
  /**
   * Assign any number of customers to any number of agents in one call.
   * This is what makes one-agent-to-many-customers a single submission.
   */
  assignCustomers: (
    token: string,
    body: {
      agentIds: string[];
      scenarioIds: string[];
      scheduledDate: string;
      scheduledHour?: number;
      flowType?: 'SINGLE' | 'DUAL';
      agentRole?: 'FRONTER' | 'VERIFIER';
      notes?: string;
    },
  ) => request<any>('/api/admin/assignments/customers', { method: 'POST', body, token }),

  agentCustomers: (token: string, agentId: string) =>
    request<any>(`/api/admin/assignments/agent/${agentId}/customers`, { token }),
};

// ── Content management: knowledge, quizzes, clips ───────────

/** One field of a block shape, as the server describes it. */
export interface BlockField {
  name: string;
  label: string;
  type: 'text' | 'longtext' | 'number' | 'icon' | 'color' | 'boolean' | 'list';
  required?: boolean;
  hint?: string;
  max?: number;
}

/** A block shape: what it is for, and the fields it carries. */
export interface BlockKind {
  kind: string;
  label: string;
  description: string;
  fields: BlockField[];
}

/** One item on a knowledge screen. */
export interface KnowledgeBlock {
  id: string;
  campaign: string;
  sectionKey: string;
  kind: string;
  data: Record<string, unknown>;
  sortOrder: number;
  isPublished: boolean;
}

export const contentApi = {
  listArticles: (token: string, campaign?: string) =>
    request<any>(`/api/admin/content/articles${campaign ? `?campaign=${campaign}` : ''}`, { token }),
  createArticle: (token: string, body: any) =>
    request<any>('/api/admin/content/articles', { method: 'POST', body, token }),
  updateArticle: (token: string, id: string, body: any) =>
    request<any>(`/api/admin/content/articles/${id}`, { method: 'PUT', body, token }),
  deleteArticle: (token: string, id: string) =>
    request<any>(`/api/admin/content/articles/${id}`, { method: 'DELETE', token }),

  listQuizzes: (token: string) => request<any>('/api/admin/content/quizzes', { token }),
  getQuiz: (token: string, id: string) => request<any>(`/api/admin/content/quizzes/${id}`, { token }),
  updateQuiz: (token: string, id: string, body: any) =>
    request<any>(`/api/admin/content/quizzes/${id}`, { method: 'PUT', body, token }),
  /**
   * The admin-facing Shuffle button. Re-rolls the paper: fresh MCQ order,
   * fresh option order inside each MCQ, and a new random selection of
   * scenario sets from the pool. `scenariosPerPaper` (optional) both updates
   * the setting and is used for the roll.
   */
  shuffleQuiz: (token: string, id: string, scenariosPerPaper?: number) =>
    request<any>(`/api/admin/content/quizzes/${id}/shuffle`, {
      method: 'POST',
      body: scenariosPerPaper != null ? { scenariosPerPaper } : {},
      token,
    }),
  /** Bulk import — replaces the whole bank. The builder below edits one at a time. */
  replaceQuestions: (token: string, id: string, questions: any[]) =>
    request<any>(`/api/admin/content/quizzes/${id}/questions`, { method: 'PUT', body: { questions }, token }),

  /**
   * Which agents can sit this quiz at its journey stage. Returns the active
   * agents plus the assignments each currently has at that stage.
   */
  listQuizAssignments: (token: string, quizId: string) =>
    request<any>(`/api/admin/content/quizzes/${quizId}/assignments`, { token }),
  /**
   * The admin-facing "Assign to agents" save. `agentIds` are the agents that
   * should sit THIS quiz; everyone else falls back to the stage default.
   */
  setQuizAssignments: (token: string, quizId: string, agentIds: string[]) =>
    request<any>(`/api/admin/content/quizzes/${quizId}/assignments`, {
      method: 'PUT', body: { agentIds }, token,
    }),

  createQuestion: (token: string, quizId: string, body: any) =>
    request<any>(`/api/admin/content/quizzes/${quizId}/questions`, { method: 'POST', body, token }),
  updateQuestion: (token: string, questionId: string, body: any) =>
    request<any>(`/api/admin/content/questions/${questionId}`, { method: 'PUT', body, token }),
  deleteQuestion: (token: string, questionId: string) =>
    request<any>(`/api/admin/content/questions/${questionId}`, { method: 'DELETE', token }),
  reorderQuestions: (token: string, quizId: string, questionIds: string[]) =>
    request<any>(`/api/admin/content/quizzes/${quizId}/questions/order`, {
      method: 'PUT', body: { questionIds }, token,
    }),

  // ── Marking written answers ────────────────────────────────
  listPendingMarking: (token: string) =>
    request<any>('/api/admin/content/quiz-attempts/pending', { token }),
  getAttemptForMarking: (token: string, attemptId: string) =>
    request<any>(`/api/admin/content/quiz-attempts/${attemptId}`, { token }),
  markAttempt: (token: string, attemptId: string, marks: any[]) =>
    request<any>(`/api/admin/content/quiz-attempts/${attemptId}/marks`, {
      method: 'PUT', body: { marks }, token,
    }),

  // ── Clip sections ──────────────────────────────────────────
  // Sections are rows, not an enum, so the portal reads the list at runtime.
  listClipCategories: (token: string) =>
    request<any>('/api/admin/content/clip-categories', { token }),
  createClipCategory: (token: string, body: { name: string; description?: string }) =>
    request<any>('/api/admin/content/clip-categories', { method: 'POST', body, token }),
  updateClipCategory: (token: string, id: string, body: any) =>
    request<any>(`/api/admin/content/clip-categories/${id}`, { method: 'PATCH', body, token }),
  reorderClipCategories: (token: string, order: string[]) =>
    request<any>('/api/admin/content/clip-categories/reorder', { method: 'PUT', body: { order }, token }),
  deleteClipCategory: (token: string, id: string) =>
    request<any>(`/api/admin/content/clip-categories/${id}`, { method: 'DELETE', token }),

  // ── Clips ──────────────────────────────────────────────────
  listClips: (token: string) => request<any>('/api/admin/content/clips', { token }),
  updateClip: (token: string, id: string, body: any) =>
    request<any>(`/api/admin/content/clips/${id}`, { method: 'PUT', body, token }),
  deleteClip: (token: string, id: string) =>
    request<any>(`/api/admin/content/clips/${id}`, { method: 'DELETE', token }),
  /** Place an existing clip in a second section. Reuses the stored media. */
  copyClip: (token: string, id: string, categoryId: string) =>
    request<any>(`/api/admin/content/clips/${id}/copy`, { method: 'POST', body: { categoryId }, token }),

  /**
   * Bytes for a clip, so admins can preview what they uploaded.
   *
   * This is the agent-facing journey route, not an admin one: it only requires
   * an authenticated user, and an admin token satisfies that. Adding a parallel
   * admin media route would be a second code path serving identical bytes.
   */
  clipMediaUrl: (id: string) => `${API_URL}/api/journey/clips/${id}/media`,

  /**
   * Multipart upload. Cannot use `request` — that helper forces
   * Content-Type: application/json, which would break the multipart boundary.
   * The browser sets the boundary itself when given a FormData body.
   */
  uploadClip: async (
    token: string,
    file: File,
    meta: { title?: string; description?: string; categoryId: string; sortOrder?: number },
  ) => {
    const form = new FormData();
    form.append('file', file);
    // Title is optional: the API falls back to the filename, which is what
    // makes selecting twenty files at once practical.
    if (meta.title) form.append('title', meta.title);
    form.append('categoryId', meta.categoryId);
    if (meta.description) form.append('description', meta.description);
    if (meta.sortOrder != null) form.append('sortOrder', String(meta.sortOrder));

    const res = await authenticatedFetch(`${API_URL}/api/admin/content/clips`, token, {
      method: 'POST',
      body: form,
    });

    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data.error || `Upload failed with status ${res.status}`);
    return data;
  },

  // ── Knowledge narration ──────────────────────────────────
  // Audio attached to the product-knowledge guides. Scoped by campaign, not by
  // an admin-created section, so there is no category to resolve first.

  /**
   * Topics per campaign: the guide's built-ins plus anything an admin added.
   * Entries carry `builtIn`, and custom ones carry an id for edit and delete.
   */
  // ── Knowledge screens ──────────────────────────────────────
  // A screen is a list of blocks. The kinds call returns the field spec each
  // shape has, so the editor builds its inputs from the server rather than
  // hardcoding a form per shape.
  listBlockKinds: (token: string) =>
    request<{ success: boolean; data: BlockKind[] }>(
      '/api/admin/content/knowledge-blocks/kinds',
      { token },
    ),

  listBlocks: (token: string, campaign: string, sectionKey?: string) => {
    const q = new URLSearchParams({ campaign });
    if (sectionKey) q.set('sectionKey', sectionKey);
    return request<{ success: boolean; data: KnowledgeBlock[] }>(
      `/api/admin/content/knowledge-blocks?${q}`,
      { token },
    );
  },

  createBlock: (
    token: string,
    body: { campaign: string; sectionKey: string; kind: string; data: Record<string, unknown> },
  ) =>
    request<{ success: boolean; data: KnowledgeBlock }>('/api/admin/content/knowledge-blocks', {
      method: 'POST',
      body,
      token,
    }),

  updateBlock: (
    token: string,
    id: string,
    body: { data?: Record<string, unknown>; isPublished?: boolean; sortOrder?: number },
  ) =>
    request<{ success: boolean; data: KnowledgeBlock }>(
      `/api/admin/content/knowledge-blocks/${id}`,
      { method: 'PUT', body, token },
    ),

  reorderBlocks: (token: string, blockIds: string[]) =>
    request<any>('/api/admin/content/knowledge-blocks/reorder', {
      method: 'PUT',
      body: { blockIds },
      token,
    }),

  deleteBlock: (token: string, id: string) =>
    request<any>(`/api/admin/content/knowledge-blocks/${id}`, { method: 'DELETE', token }),

  listKnowledgeSections: (token: string) =>
    request<any>('/api/admin/content/knowledge-sections', { token }),
  createKnowledgeSection: (token: string, body: { campaign: string; label: string }) =>
    request<any>('/api/admin/content/knowledge-sections', { method: 'POST', body, token }),
  /** Rename or hide one of the guide's own topics; upserts an override row. */
  updateBuiltInSection: (
    token: string,
    body: {
      campaign: string;
      key: string;
      label?: string;
      isPublished?: boolean;
      /** With isPublished false, also deletes the notes and audio filed here. */
      cascade?: boolean;
    },
  ) =>
    request<any>('/api/admin/content/knowledge-sections/built-in', {
      method: 'PUT',
      body,
      token,
    }),
  updateKnowledgeSection: (token: string, id: string, body: any) =>
    request<any>(`/api/admin/content/knowledge-sections/${id}`, { method: 'PUT', body, token }),
  /** `cascade` also deletes every note and recording filed under the topic. */
  deleteKnowledgeSection: (token: string, id: string, cascade = false) =>
    request<any>(
      `/api/admin/content/knowledge-sections/${id}${cascade ? '?cascade=1' : ''}`,
      { method: 'DELETE', token },
    ),

  listRecordings: (token: string, campaign?: string) =>
    request<any>(
      `/api/admin/content/knowledge-recordings${campaign ? `?campaign=${campaign}` : ''}`,
      { token },
    ),
  updateRecording: (token: string, id: string, body: any) =>
    request<any>(`/api/admin/content/knowledge-recordings/${id}`, { method: 'PUT', body, token }),
  deleteRecording: (token: string, id: string) =>
    request<any>(`/api/admin/content/knowledge-recordings/${id}`, { method: 'DELETE', token }),
  reorderRecordings: (token: string, order: string[]) =>
    request<any>('/api/admin/content/knowledge-recordings/reorder', {
      method: 'PUT',
      body: { order },
      token,
    }),

  /** Bytes for a recording — the journey route, for the same reason as clips. */
  recordingMediaUrl: (id: string) => `${API_URL}/api/journey/knowledge/recordings/${id}/media`,

  /** Multipart upload; see uploadClip for why `request` cannot be used. */
  uploadRecording: async (
    token: string,
    file: File,
    meta: { campaign: string; title?: string; description?: string; sectionKey?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('campaign', meta.campaign);
    if (meta.title) form.append('title', meta.title);
    if (meta.description) form.append('description', meta.description);
    if (meta.sectionKey) form.append('sectionKey', meta.sectionKey);

    const res = await authenticatedFetch(`${API_URL}/api/admin/content/knowledge-recordings`, token, {
      method: 'POST',
      body: form,
    });

    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data.error || `Upload failed with status ${res.status}`);
    return data;
  },
};

export const scenariosApi = {
  list: (token: string, params?: any) => {
    const q = new URLSearchParams(params).toString();
    return request<any>(`/api/scenarios?${q}`, { token });
  },
  get: (token: string, id: string) => request<any>(`/api/scenarios/${id}`, { token }),
  create: (token: string, body: any) =>
    request<any>('/api/scenarios', { method: 'POST', body, token }),
  update: (token: string, id: string, body: any) =>
    request<any>(`/api/scenarios/${id}`, { method: 'PUT', body, token }),
  delete: (token: string, id: string) =>
    request<any>(`/api/scenarios/${id}`, { method: 'DELETE', token }),

  /** Every reason a draft cannot go live, named by field and in plain language. */
  validate: (token: string, body: any) =>
    request<{ success: boolean; valid: boolean; findings: { severity: string; field: string; message: string }[] }>(
      '/api/scenarios/validate',
      { method: 'POST', body, token },
    ),

  /**
   * Readable names for the qualification fact keys.
   *
   * /autofill returns labels alongside the facts it generates, which covers
   * creating a persona. EDITING one never calls autofill — the facts come off
   * the stored row — so the grid needs the labels on their own or it renders
   * raw keys (`mm`, `rtd`, `partAB`).
   */
  factLabels: (token: string) =>
    request<{ success: boolean; data: Record<string, string> }>('/api/scenarios/fact-labels', { token }),

  /** What the system would fill in — returned, not written, so it stays editable. */
  autofill: (token: string, body: any) =>
    request<{ success: boolean; data: { qualificationFacts: Record<string, unknown>; labels: Record<string, string>; states: string[] } }>(
      '/api/scenarios/autofill',
      { method: 'POST', body, token },
    ),

  /** The American voices valid for this persona's gender, and the resolved pick. */
  voiceOptions: (token: string, gender: string, age: number) =>
    request<any>(`/api/scenarios/voice-options?gender=${encodeURIComponent(gender)}&age=${age}`, { token }),

  /**
   * A playable URL for one voice.
   *
   * The token rides in the query string because an <audio> element sends no
   * Authorization header — the same constraint the guide's narration player has.
   */
  voicePreviewUrl: (voice: string, token: string) =>
    `${API_URL}/api/scenarios/voice-preview?voice=${encodeURIComponent(voice)}&token=${encodeURIComponent(token)}`,
};

// ── Pronunciation practice sentences ─────────────────────────

export interface PronunciationSentence {
  id: string;
  slug: string;
  text: string;
  hint: string | null;
  campaign: string | null;
  isPublished: boolean;
  sortOrder: number;
  attemptCount: number;
  createdAt: string;
}

/** Null on a limit field means "inherit"; 0 means a real limit of zero. */
export interface PronunciationLimitValues {
  dailyAttemptLimit: number | null;
  dailyMinutesLimit: number | null;
  monthlyAttemptLimit: number | null;
  monthlyMinutesLimit: number | null;
  totalAttemptLimit: number | null;
  totalMinutesLimit: number | null;
}

export interface PronunciationUsageWindow {
  attempts: number;
  minutes: number;
  seconds: number;
}

export interface PronunciationLimitsResponse {
  environmentDefault: { dailyAttemptLimit: number };
  global: (PronunciationLimitValues & { updatedAt: string; updatedBy: any }) | null;
  overrides: Array<PronunciationLimitValues & {
    agentId: string;
    agent: { id: string; firstName: string; lastName: string; email: string } | null;
    updatedAt: string;
  }>;
}

export interface PracticeUsageWindow { attempts: number; minutes: number; seconds: number }

export interface AgentPracticeRow {
  agent: { id: string; firstName: string; lastName: string; email: string; isActive: boolean };
  /** True when this agent has their own row, rather than tracking the global. */
  hasOverride: boolean;
  limits: PronunciationLimitValues & { source: Record<keyof PronunciationLimitValues, 'agent' | 'global' | 'default' | 'none'> };
  usage: { day: PracticeUsageWindow; month: PracticeUsageWindow; total: PracticeUsageWindow };
  /** null on a field means uncapped. Computed server-side, floored at 0. */
  remaining: {
    dailyAttempts: number | null; dailyMinutes: number | null;
    monthlyAttempts: number | null; monthlyMinutes: number | null;
    totalAttempts: number | null; totalMinutes: number | null;
  };
  blockedBy: { period: 'day' | 'month' | 'total'; measure: 'attempts' | 'minutes'; limit: number } | null;
}

export const pronunciationLimitsApi = {
  /**
   * Every agent with their limits, usage and what is left — one request.
   *
   * Distinct from `get`, which returns only agents that already have an
   * override and carries no usage, and from `getAgent`, which is one agent per
   * request. The roster needs all of them at once.
   */
  roster: (token: string) =>
    request<{ success: boolean; data: { agents: AgentPracticeRow[] } }>(
      '/api/admin/pronunciation/limits/agents', { token },
    ),
  get: (token: string) =>
    request<{ success: boolean; data: PronunciationLimitsResponse }>(
      '/api/admin/pronunciation/limits', { token },
    ),
  setGlobal: (token: string, body: Partial<PronunciationLimitValues>) =>
    request<any>('/api/admin/pronunciation/limits', { method: 'PUT', body, token }),
  setAgent: (token: string, agentId: string, body: Partial<PronunciationLimitValues>) =>
    request<any>(`/api/admin/pronunciation/limits/${agentId}`, { method: 'PUT', body, token }),
  clearAgent: (token: string, agentId: string) =>
    request<any>(`/api/admin/pronunciation/limits/${agentId}`, { method: 'DELETE', token }),
};

export const pronunciationApi = {
  list: (token: string) =>
    request<{ success: boolean; data: PronunciationSentence[] }>('/api/admin/pronunciation/sentences', { token }),
  create: (token: string, body: Partial<PronunciationSentence>) =>
    request<any>('/api/admin/pronunciation/sentences', { method: 'POST', body, token }),
  update: (token: string, id: string, body: Partial<PronunciationSentence>) =>
    request<any>(`/api/admin/pronunciation/sentences/${id}`, { method: 'PATCH', body, token }),
  remove: (token: string, id: string) =>
    request<any>(`/api/admin/pronunciation/sentences/${id}`, { method: 'DELETE', token }),
};

/**
 * Runtime settings an admin changes from the portal.
 *
 * `agentReportDetail` opens or closes the full QA breakdown for TRAINEES; an
 * admin's own view is never affected by it. The switch is enforced on the
 * server, so turning it off removes the fields from the agent's API responses
 * rather than only from their screen.
 */
export const settingsApi = {
  get: (token: string) =>
    request<{ success: boolean; data: { agentReportDetail: boolean } }>('/api/settings', { token }),
  update: (token: string, body: { agentReportDetail?: boolean }) =>
    request<{ success: boolean; data: { agentReportDetail: boolean } }>('/api/settings', {
      method: 'PUT', body, token,
    }),
};
