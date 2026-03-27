# Knowledge Base

The Knowledge Base (KB) system provides Retrieval-Augmented Generation (RAG) for agents. Documents are uploaded, chunked, embedded as vectors, and searched during conversations to give agents relevant context.

---

## Architecture

```
Document Upload
  │
  ▼
Text Extraction (PDF, TXT, MD)
  │
  ▼
Chunking (~2000 chars, 200 char overlap)
  │
  ▼
Embedding (OpenAI text-embedding-3-small via OpenRouter)
  │
  ▼
Storage (PostgreSQL + pgvector)
  │
  ▼
Semantic Search (cosine similarity)
  │
  ▼
Injected into agent's system prompt as context
```

---

## Data Model

### knowledge_bases

```sql
knowledge_bases
  ├── id           UUID (primary key)
  ├── workspaceId  UUID (FK → workspaces, cascade delete)
  ├── name         TEXT (required)
  ├── description  TEXT (optional)
  ├── createdAt    TIMESTAMP
  └── updatedAt    TIMESTAMP
```

### kb_documents

```sql
kb_documents
  ├── id           UUID (primary key)
  ├── workspaceId  UUID (FK → workspaces, cascade delete)
  ├── kbId         UUID (FK → knowledge_bases, cascade delete)
  ├── filename     TEXT (original filename)
  ├── chunkCount   INTEGER (number of chunks created)
  ├── createdAt    TIMESTAMP
  └── updatedAt    TIMESTAMP
```

### kb_chunks

```sql
kb_chunks
  ├── id           UUID (primary key)
  ├── workspaceId  UUID (FK → workspaces, cascade delete)
  ├── kbId         UUID (FK → knowledge_bases, cascade delete)
  ├── documentId   UUID (FK → kb_documents, cascade delete)
  ├── content      TEXT (chunk text content)
  ├── embedding    REAL[] (vector embedding, 1536 dimensions)
  ├── metadata     JSONB (filename, chunkIndex, totalChunks)
  └── createdAt    TIMESTAMP
```

---

## API Endpoints

### Knowledge Base CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/kb` | List all KBs in workspace |
| `POST` | `/api/kb` | Create a new KB |
| `GET` | `/api/kb/:id` | Get KB details |
| `PUT` | `/api/kb/:id` | Update KB name/description |
| `DELETE` | `/api/kb/:id` | Delete KB (cascades to documents and chunks) |

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/kb/:kbId/documents` | List documents in a KB |
| `POST` | `/api/kb/:kbId/documents/upload` | Upload a document (multipart) |
| `DELETE` | `/api/kb/:kbId/documents/:id` | Delete a document (chunks cascade-deleted) |

### Chunks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/kb/:kbId/chunks` | List all chunks in a KB |
| `GET` | `/api/kb/:kbId/documents/:documentId/chunks` | List chunks for a document |
| `POST` | `/api/kb/:kbId/documents/:documentId/chunks` | Add a manual chunk |
| `PUT` | `/api/kb/chunks/:chunkId` | Update chunk content (re-embeds) |
| `DELETE` | `/api/kb/chunks/:chunkId` | Delete a chunk |

---

## Document Upload Flow

### 1. Create a Knowledge Base

```json
POST /api/kb
{
  "name": "Product Documentation",
  "description": "All product manuals and specifications"
}
```

### 2. Upload a Document

```
POST /api/kb/:kbId/documents/upload
Content-Type: multipart/form-data

file: <binary file data>
```

### What Happens on Upload

1. **Validate KB exists** and belongs to the workspace
2. **Check credits** -- uploads cost credits (`BASE_CREDIT_COSTS.KB_DOCUMENT_UPLOAD`)
3. **Validate file size** -- max 10MB
4. **Validate file type** -- only `.txt`, `.md`, `.pdf` accepted
5. **Extract text:**
   - **PDF** -- Uses `pdfjs-dist` to extract text from each page
   - **TXT/MD** -- Read as UTF-8 text directly
6. **Validate content** -- must have non-empty text
7. **Chunk text** -- Split into ~2000 character chunks with 200 character overlap
8. **Generate embeddings** -- Send chunks to OpenRouter embeddings API in batches of 20
9. **Create document record** in `kb_documents`
10. **Insert chunk records** in `kb_chunks` with content, embedding, and metadata
11. **Deduct credits** from workspace balance
12. If chunk insertion fails, the document record is rolled back

### Supported File Types

| Extension | MIME Type | Extraction Method |
|-----------|-----------|-------------------|
| `.txt` | `text/plain` | UTF-8 read |
| `.md` | `text/markdown` | UTF-8 read |
| `.pdf` | `application/pdf` | pdfjs-dist text extraction |

---

## Text Chunking

Documents are split into overlapping chunks for optimal retrieval:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `CHUNK_SIZE` | 2000 | Characters per chunk |
| `CHUNK_OVERLAP` | 200 | Overlap between consecutive chunks |

### Chunking Algorithm

```
Document: "ABCDEFGHIJ..." (long text)

Chunk 1: chars 0-2000
Chunk 2: chars 1800-3800  (200 char overlap with chunk 1)
Chunk 3: chars 3600-5600  (200 char overlap with chunk 2)
...
```

The overlap ensures that information near chunk boundaries isn't lost during retrieval.

Empty chunks (whitespace only) are filtered out.

---

## Embeddings

### Provider

Embeddings are generated via **OpenRouter** proxying the **OpenAI text-embedding-3-small** model.

| Setting | Value |
|---------|-------|
| **API endpoint** | `https://openrouter.ai/api/v1/embeddings` |
| **Model** | `openai/text-embedding-3-small` |
| **Dimensions** | 1536 |
| **Batch size** | 20 texts per request |

### Embedding Generation

```typescript
// Single text
const embedding = await generateEmbedding("Some text");
// Returns: number[] (1536 dimensions)

// Batch
const embeddings = await generateEmbeddings(["Text 1", "Text 2", ...]);
// Returns: number[][] (array of 1536-dimension vectors)
```

The batch function splits inputs into groups of 20 and processes them sequentially to avoid rate limits.

### When Embeddings Are Generated

- **Document upload** -- All chunks are embedded in batch
- **Chunk update** -- The updated chunk is re-embedded
- **Manual chunk add** -- The new chunk is embedded individually
- **Query** -- The search query is embedded for similarity comparison

---

## Semantic Search (RAG)

### How It Works

When an agent has KBs assigned and receives a user message:

1. The user's message is embedded using the same model
2. The embedding is compared against all chunks in the assigned KBs using **cosine similarity** (via pgvector)
3. The top-K most relevant chunks are retrieved (default: 5)
4. These chunks are injected into the agent's system prompt as context

### Query Function

```typescript
kbService.queryKB(
  kbIds: string[],    // IDs of assigned KBs
  query: string,      // User's message
  workspaceId: string,
  topK: number = 5    // Number of results
)
```

This calls `kbRepository.searchAcrossKBs()` which uses pgvector's similarity search across multiple KBs in a single query.

### Credit Cost

- **Upload:** `BASE_CREDIT_COSTS.KB_DOCUMENT_UPLOAD`
- **Query:** `BASE_CREDIT_COSTS.KB_QUERY` (deducted per agent conversation turn that uses KB)

---

## Chunk Management

### Edit a Chunk

```json
PUT /api/kb/chunks/:chunkId
{
  "content": "Updated chunk text content (minimum 10 characters)"
}
```

When a chunk is updated:
1. Content is saved to the database
2. A new embedding is generated for the updated content
3. The embedding is updated in the database
4. If re-embedding fails, the content is saved but the embedding may be stale (a warning is returned)

### Add a Manual Chunk

```json
POST /api/kb/:kbId/documents/:documentId/chunks
{
  "content": "Manually added text content"
}
```

This adds a chunk with `metadata.source: "manual"` and increments the document's `chunkCount`.

### Delete a Chunk

```
DELETE /api/kb/chunks/:chunkId
```

Deleting a chunk also decrements the parent document's `chunkCount`.

---

## Agent KB Integration

### Assigning KBs to Agents

KBs are assigned via resource permissions:

```json
POST /api/agents/:agentId/permissions
{
  "permissions": [
    { "resourceType": "kb", "resourceId": "kb-uuid-1", "allowed": true },
    { "resourceType": "kb", "resourceId": "kb-uuid-2", "allowed": true }
  ]
}
```

### How Agents Use KBs

During graph compilation:
1. The agent's KB permissions are loaded
2. Assigned KB metadata (name, description, document count) is added to the system prompt
3. On each user message, a semantic search is performed across all assigned KBs
4. Relevant chunks are included in the context for the LLM

### Agent System Tools for KB

If `canManageKB` is enabled, the agent can programmatically:
- `system_create_kb` -- Create a new KB
- `system_delete_kb` -- Delete a KB (with name confirmation safety check)
- `system_add_document` -- Add text content as a document (auto-chunks and embeds)

---

## Frontend KB UI

The KB page (`/kb`) provides:
- **KB list** -- View all knowledge bases with document counts
- **Create KB** -- Name and description form
- **Document upload** -- Drag-and-drop file upload
- **Document list** -- View documents within a KB with chunk counts
- **Chunk viewer** -- Browse individual chunks with their content
- **Chunk editing** -- Edit chunk content (triggers re-embedding)
- **Chunk deletion** -- Remove individual chunks

---

## Cascade Deletion

| Delete | Cascades To |
|--------|-------------|
| Workspace | All KBs → all documents → all chunks |
| Knowledge base | All documents → all chunks |
| Document | All chunks |
| Chunk | Nothing (decrements document chunk count) |

---

## Next Steps

- [Integrations](./09-integrations.md) -- Composio, Slack, Telegram, and vault connections
- [Scheduling](./10-scheduling.md) -- Cron-based agent scheduling
