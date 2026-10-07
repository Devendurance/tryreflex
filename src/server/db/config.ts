export const EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
export const EMBEDDING_DIMENSIONS = 1024;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function validateNeonUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} is not a valid URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigurationError(`${name} must use the postgres protocol`);
  }
  if (!url.hostname.endsWith(".neon.tech")) {
    throw new ConfigurationError(`${name} must point to a Neon host`);
  }
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode !== "require" && sslmode !== "verify-full") {
    throw new ConfigurationError(`${name} must require TLS (sslmode=require or verify-full)`);
  }
  return url;
}

export function getDatabaseUrls(): { pooled: string; unpooled: string } {
  const pooled = process.env.DATABASE_URL;
  const unpooled = process.env.DATABASE_URL_UNPOOLED;
  if (!pooled) throw new ConfigurationError("DATABASE_URL is required");
  if (!unpooled) throw new ConfigurationError("DATABASE_URL_UNPOOLED is required");
  const pooledUrl = validateNeonUrl("DATABASE_URL", pooled);
  const unpooledUrl = validateNeonUrl("DATABASE_URL_UNPOOLED", unpooled);
  if (!pooledUrl.hostname.includes("-pooler")) {
    throw new ConfigurationError("DATABASE_URL must be the pooled Neon endpoint");
  }
  if (unpooledUrl.hostname.includes("-pooler")) {
    throw new ConfigurationError("DATABASE_URL_UNPOOLED must be the direct Neon endpoint");
  }
  if (pooledUrl.hostname.replace("-pooler", "") !== unpooledUrl.hostname) {
    throw new ConfigurationError("DATABASE_URL and DATABASE_URL_UNPOOLED must target the same Neon endpoint");
  }
  if (pooledUrl.pathname !== unpooledUrl.pathname) {
    throw new ConfigurationError("DATABASE_URL and DATABASE_URL_UNPOOLED must target the same database");
  }
  return { pooled, unpooled };
}

export function getEmbeddingConfig(): { model: string; dimensions: number } {
  const model = process.env.JINA_EMBEDDING_MODEL;
  const dims = process.env.JINA_EMBEDDING_DIMENSIONS;
  if (!model) throw new ConfigurationError("JINA_EMBEDDING_MODEL is required");
  if (!dims) throw new ConfigurationError("JINA_EMBEDDING_DIMENSIONS is required");
  if (model !== EMBEDDING_MODEL || dims !== String(EMBEDDING_DIMENSIONS)) {
    throw new ConfigurationError(
      `embedding profile mismatch: configured ${model}/${dims} does not match locked ${EMBEDDING_MODEL}/${EMBEDDING_DIMENSIONS}`,
    );
  }
  return { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS };
}
