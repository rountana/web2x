// ─── Workspace ─────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceListResponse {
  workspaces: Workspace[];
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface CreateWorkspaceResponse {
  id: string;
  name: string;
}

export interface RenameWorkspaceRequest {
  name: string;
}

// ─── Article ───────────────────────────────────────────────────────────────

export type ArticleStatus = 'pending' | 'ready' | 'failed';

export interface Article {
  id: string;
  userId: string | null;
  workspaceId: string;
  sourceUrl: string;
  title: string;
  rawText: string;
  markdownContent: string;
  wordCount: number;
  extractedAt: Date | null;
  status: ArticleStatus;
  errorMessage: string | null;
  createdAt: Date;
}

export type ArticleListItem = Pick<
  Article,
  'id' | 'title' | 'sourceUrl' | 'status' | 'wordCount' | 'createdAt'
>;

// ─── Flashcards ────────────────────────────────────────────────────────────

export interface FlashCard {
  front: string;
  back: string;
}

export interface Deck {
  id: string;
  articleId: string;
  cards: FlashCard[];
  generatedAt: Date;
}

export interface CreateDeckRequest {
  count?: number;
}

// ─── Quiz ──────────────────────────────────────────────────────────────────

export interface MCQuestion {
  id: string;
  type: 'multiple_choice';
  question: string;
  options: [string, string, string, string];
  correctAnswer: string;
  explanation: string;
}

export interface OpenQuestion {
  id: string;
  type: 'open_ended';
  question: string;
  options?: never;
  correctAnswer: string;
  explanation: string;
}

export type QuizQuestion = MCQuestion | OpenQuestion;

export interface Quiz {
  id: string;
  articleId: string;
  questions: QuizQuestion[];
  generatedAt: Date;
}

export interface CreateQuizRequest {
  count?: number;
}

export interface GradeRequest {
  questionId: string;
  userAnswer: string;
}

export interface GradeResponse {
  correct: boolean;
  score: number;
  feedback: string;
}

// ─── Summary ───────────────────────────────────────────────────────────────

export interface Summary {
  id: string;
  articleId: string;
  keyPoints: string[];
  overview: string;
  generatedAt: Date;
}

// ─── API shapes ────────────────────────────────────────────────────────────

export interface ArticleListResponse {
  articles: ArticleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateArticleRequest {
  url: string;
}

export interface CreateArticleResponse {
  id: string;
  status: ArticleStatus;
}

export interface IngestMarkdownRequest {
  content: string;
  title?: string;
}

export interface PdfResponse {
  url: string;
  expiresAt: string;
}

export interface ApiError {
  error: string;
  code?: string;
}

// ─── Chat ──────────────────────────────────────────────────────────────────

export interface ChatSource {
  articleId: string;
  title: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

export interface ChatRequest {
  query: string;
  articleId?: string;
  history?: Pick<ChatMessage, 'role' | 'content'>[];
}

// ─── Query understanding ────────────────────────────────────────────────────

export type QueryType =
  | 'semantic_search'
  | 'list_then_summarize'
  | 'hybrid'
  | 'bm25'
  | 'vector'
  | 'rag'
  | 'csv'
  | 'metadata'
  | 'knowledge_graph';

export type RetrievalMode = QueryType;

export interface ChatFilters {
  dateFrom?: string; // ISO 8601
  dateTo?: string;   // ISO 8601
}

export interface MetadataFilter {
  workspaceId: string;
  dateFrom?: string; // ISO 8601
  dateTo?: string;   // ISO 8601
  // Phase 5: sourceType, domain, language, tags, readingTimeMin, readingTimeMax
}

export interface SearchQuery {
  text: string;
  workspaceId: string;
  articleId?: string;
  filters?: MetadataFilter;
  topK?: number;
  options?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  articleId: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
  source: QueryType;
}

export interface SearchStrategy {
  name: QueryType;
  search(query: SearchQuery): Promise<SearchResult[]>;
  score(result: SearchResult): number;
  supports(queryType: QueryType): boolean;
}

export interface QueryIntent {
  retrieval_mode: RetrievalMode;
  filters: ChatFilters;
  reformulated_query: string;
  context_hint: string;
}
