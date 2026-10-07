import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfigurationError,
  EMBEDDING_MODEL,
  getDatabaseUrls,
  getEmbeddingConfig,
} from "../../src/server/db/config";

const ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "JINA_EMBEDDING_MODEL",
  "JINA_EMBEDDING_DIMENSIONS",
] as const;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const VALID_POOLED = "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const VALID_UNPOOLED = "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full";

test("getDatabaseUrls requires both URLs", () => {
  withEnv({ DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: VALID_UNPOOLED }, () => {
    assert.throws(() => getDatabaseUrls(), ConfigurationError);
  });
  withEnv({ DATABASE_URL: VALID_POOLED, DATABASE_URL_UNPOOLED: undefined }, () => {
    assert.throws(() => getDatabaseUrls(), ConfigurationError);
  });
});

test("getDatabaseUrls rejects non-postgres protocol", () => {
  withEnv(
    { DATABASE_URL: "https://ep-x-pooler.eu-central-1.aws.neon.tech/neondb", DATABASE_URL_UNPOOLED: VALID_UNPOOLED },
    () => assert.throws(() => getDatabaseUrls(), ConfigurationError),
  );
});

test("getDatabaseUrls rejects non-Neon hostname", () => {
  withEnv(
    { DATABASE_URL: "postgresql://u:p@db.example.com/neondb?sslmode=require", DATABASE_URL_UNPOOLED: VALID_UNPOOLED },
    () => assert.throws(() => getDatabaseUrls(), ConfigurationError),
  );
});

test("getDatabaseUrls rejects missing or weak sslmode", () => {
  withEnv(
    { DATABASE_URL: "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb", DATABASE_URL_UNPOOLED: VALID_UNPOOLED },
    () => assert.throws(() => getDatabaseUrls(), ConfigurationError),
  );
  withEnv(
    { DATABASE_URL: "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=disable", DATABASE_URL_UNPOOLED: VALID_UNPOOLED },
    () => assert.throws(() => getDatabaseUrls(), ConfigurationError),
  );
});

test("getDatabaseUrls accepts valid Neon URLs without falling back", () => {
  withEnv({ DATABASE_URL: VALID_POOLED, DATABASE_URL_UNPOOLED: VALID_UNPOOLED }, () => {
    const urls = getDatabaseUrls();
    assert.equal(urls.pooled, VALID_POOLED);
    assert.equal(urls.unpooled, VALID_UNPOOLED);
  });
});

test("getDatabaseUrls requires pooled/direct split on same endpoint", () => {
  withEnv(
    { DATABASE_URL: VALID_UNPOOLED, DATABASE_URL_UNPOOLED: VALID_UNPOOLED },
    () => assert.throws(() => getDatabaseUrls(), /pooled/),
  );
  withEnv(
    { DATABASE_URL: VALID_POOLED, DATABASE_URL_UNPOOLED: VALID_POOLED },
    () => assert.throws(() => getDatabaseUrls(), /direct/),
  );
  withEnv(
    {
      DATABASE_URL: VALID_POOLED,
      DATABASE_URL_UNPOOLED: "postgresql://u:p@ep-other.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    },
    () => assert.throws(() => getDatabaseUrls(), /same Neon endpoint/),
  );
  withEnv(
    {
      DATABASE_URL: VALID_POOLED,
      DATABASE_URL_UNPOOLED: "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/otherdb?sslmode=require",
    },
    () => assert.throws(() => getDatabaseUrls(), /same database/),
  );
});

test("getEmbeddingConfig requires both env vars", () => {
  withEnv({ JINA_EMBEDDING_MODEL: undefined, JINA_EMBEDDING_DIMENSIONS: "1024" }, () => {
    assert.throws(() => getEmbeddingConfig(), ConfigurationError);
  });
  withEnv({ JINA_EMBEDDING_MODEL: EMBEDDING_MODEL, JINA_EMBEDDING_DIMENSIONS: undefined }, () => {
    assert.throws(() => getEmbeddingConfig(), ConfigurationError);
  });
});

test("getEmbeddingConfig rejects incompatible model or dimensions", () => {
  withEnv({ JINA_EMBEDDING_MODEL: "other-model", JINA_EMBEDDING_DIMENSIONS: "1024" }, () => {
    assert.throws(() => getEmbeddingConfig(), /mismatch/);
  });
  withEnv({ JINA_EMBEDDING_MODEL: EMBEDDING_MODEL, JINA_EMBEDDING_DIMENSIONS: "768" }, () => {
    assert.throws(() => getEmbeddingConfig(), /mismatch/);
  });
});

test("getEmbeddingConfig returns locked profile when env matches", () => {
  withEnv({ JINA_EMBEDDING_MODEL: EMBEDDING_MODEL, JINA_EMBEDDING_DIMENSIONS: "1024" }, () => {
    const config = getEmbeddingConfig();
    assert.equal(config.model, "jina-embeddings-v5-text-small");
    assert.equal(config.dimensions, 1024);
  });
});
