import asyncio
import json
import os
import queue
import threading
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

load_dotenv()

CHAT_MODEL = os.getenv("MLX_CHAT_MODEL", "mlx-community/Llama-3.2-3B-Instruct-4bit")
EMBED_MODEL = os.getenv("MLX_EMBED_MODEL", "mlx-community/nomic-embed-text-v1.5")

_chat_model = None
_chat_tokenizer = None
_embed_model = None
_embed_tokenizer = None

_SENTINEL = object()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _chat_model, _chat_tokenizer, _embed_model, _embed_tokenizer

    print(f"[MLX] Loading embedding model: {EMBED_MODEL}")
    from mlx_embeddings import load as load_embed
    _embed_model, _embed_tokenizer = load_embed(EMBED_MODEL)
    print("[MLX] Embedding model ready")

    print(f"[MLX] Loading chat model: {CHAT_MODEL}")
    from mlx_lm import load as load_chat
    _chat_model, _chat_tokenizer = load_chat(CHAT_MODEL)
    print("[MLX] Chat model ready")

    yield


app = FastAPI(lifespan=lifespan)


# ─── Schemas ─────────────────────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    query: str
    context: str
    history: list[Message] = []
    max_tokens: int = 1024
    temperature: float = 0.7


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "chat_model": CHAT_MODEL, "embed_model": EMBED_MODEL}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if _embed_model is None:
        raise HTTPException(503, "Embedding model not loaded")

    from mlx_embeddings import generate as do_embed

    result = do_embed(_embed_model, _embed_tokenizer, req.text)
    if hasattr(result, "text_embeds"):
        arr = result.text_embeds
    elif hasattr(result, "last_hidden_state"):
        import mlx.core as mx
        arr = mx.mean(result.last_hidden_state, axis=1)
    else:
        arr = result
    vec = arr[0] if arr.ndim == 2 else arr
    return EmbedResponse(embedding=vec.tolist())


@app.post("/chat")
async def chat(req: ChatRequest):
    if _chat_model is None:
        raise HTTPException(503, "Chat model not loaded")

    system_prompt = (
        "You are a helpful assistant that answers questions based on the provided context. "
        "Cite which document your answer comes from when relevant. "
        "If the context does not contain enough information, say so honestly."
    )

    context_block = f"<context>\n{req.context}\n</context>" if req.context else ""

    messages = [{"role": "system", "content": system_prompt}]
    for msg in req.history:
        messages.append({"role": msg.role, "content": msg.content})

    user_content = f"{context_block}\n\n{req.query}" if context_block else req.query
    messages.append({"role": "user", "content": user_content})

    # enable_thinking=False disables Qwen3's chain-of-thought reasoning tokens
    template_kwargs = {"tokenize": False, "add_generation_prompt": True}
    try:
        prompt = _chat_tokenizer.apply_chat_template(messages, enable_thinking=False, **template_kwargs)
    except TypeError:
        prompt = _chat_tokenizer.apply_chat_template(messages, **template_kwargs)

    async def token_stream() -> AsyncGenerator[dict, None]:
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_sampler

        token_queue: queue.Queue = queue.Queue()

        def _generate_in_thread():
            try:
                sampler = make_sampler(temp=req.temperature)
                for token in stream_generate(
                    _chat_model,
                    _chat_tokenizer,
                    prompt=prompt,
                    max_tokens=req.max_tokens,
                    sampler=sampler,
                ):
                    text = token.text if hasattr(token, "text") else str(token)
                    token_queue.put(text)
            except Exception as exc:
                print(f"[MLX] Generation error: {exc}")
                token_queue.put(exc)
            finally:
                token_queue.put(_SENTINEL)

        thread = threading.Thread(target=_generate_in_thread, daemon=True)
        thread.start()

        loop = asyncio.get_event_loop()
        while True:
            # Poll the queue without blocking the event loop
            item = await loop.run_in_executor(None, token_queue.get)
            if item is _SENTINEL:
                break
            if isinstance(item, Exception):
                yield {"data": json.dumps(f"[error] {item}"), "event": "token"}
                break
            # JSON-encode each token to safely handle newlines and special chars
            yield {"data": json.dumps(item), "event": "token"}

        yield {"data": "[DONE]", "event": "done"}

    return EventSourceResponse(token_stream())
