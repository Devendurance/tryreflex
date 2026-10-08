import {
  assertSameOrigin,
  errorResponse,
  jsonResponse,
  requireAuthenticated,
  requireJsonBody,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
  RequestValidationError,
  UnsupportedMediaTypeError,
  type AuthenticatedDeps,
} from "../../http/authenticated";
import { accountScopeSchema, CLASSIC_CSV_MAX_BYTES } from "../../bitget-classic-policy";
import { classicCommitPurposesSchema, createClassicCsvRepository, purposeChangeSchema } from "./repository";

const MAX_MULTIPART_BYTES = CLASSIC_CSV_MAX_BYTES + 64 * 1024;
const MULTIPART_DEADLINE_MS = 5000;
const FILE_MIME = new Set(["text/csv", "application/vnd.ms-excel", "application/octet-stream", ""]);

async function readMultipart(request: Request, allowedFields: readonly string[]): Promise<{ file: File; fields: Map<string, string> }> {
  assertSameOrigin(request);
  const contentType = request.headers.get("content-type");
  if (contentType === null || contentType.split(";")[0].trim().toLowerCase() !== "multipart/form-data") {
    throw new UnsupportedMediaTypeError();
  }
  if (request.body === null) throw new RequestValidationError();
  const reader = request.body.getReader();
  const deadline = Date.now() + MULTIPART_DEADLINE_MS;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        reader.cancel().catch(() => {});
        throw new RequestBodyTimeoutError();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new RequestBodyTimeoutError()), remaining);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MULTIPART_BYTES) {
        reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let form: FormData;
  try {
    form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
  } catch {
    throw new RequestValidationError();
  }
  const allowed = new Set([...allowedFields, "file"]);
  const fields = new Map<string, string>();
  let files = 0;
  let file: File | null = null;
  for (const key of new Set(form.keys())) {
    if (!allowed.has(key)) throw new RequestValidationError();
    const values = form.getAll(key);
    if (values.length !== 1) throw new RequestValidationError();
    const value = values[0];
    if (value instanceof File) {
      if (key !== "file") throw new RequestValidationError();
      files += 1;
      file = value;
    } else {
      if (key === "file") throw new RequestValidationError();
      fields.set(key, value);
    }
  }
  if (files !== 1 || file === null) throw new RequestValidationError();
  if (file.size > CLASSIC_CSV_MAX_BYTES) throw new RequestBodyTooLargeError();
  if (!FILE_MIME.has(file.type)) throw new UnsupportedMediaTypeError();
  return { file, fields };
}

export function createClassicCSVPreviewHandler(deps: AuthenticatedDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const { file, fields } = await readMultipart(request, ["accountScope"]);
      const scope = accountScopeSchema.parse(fields.get("accountScope") ?? "main");
      const bytes = new Uint8Array(await file.arrayBuffer());
      return jsonResponse(200, await createClassicCsvRepository(db, auth).preview(scope, bytes));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createClassicCSVCommitHandler(deps: AuthenticatedDeps = {}) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const { file, fields } = await readMultipart(request, ["accountScope", "previewHash", "confirmed", "purposes"]);
      const scope = accountScopeSchema.parse(fields.get("accountScope") ?? "main");
      const previewHash = fields.get("previewHash");
      if (typeof previewHash !== "string" || !/^[0-9a-f]{64}$/.test(previewHash)) throw new RequestValidationError();
      if (fields.get("confirmed") !== "true") throw new RequestValidationError();
      let rawPurposes: unknown;
      try {
        rawPurposes = JSON.parse(fields.get("purposes") ?? "");
      } catch {
        throw new RequestValidationError();
      }
      const purposes = classicCommitPurposesSchema.parse(rawPurposes);
      if (file.name.length > 255 || file.name.includes("\0")) throw new RequestValidationError();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await createClassicCsvRepository(db, auth).commit(scope, bytes, {
        previewHash,
        confirmed: true,
        purposes,
        filename: file.name || null,
      });
      return jsonResponse(result.status, result.body);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createClassicCSVImportsHandler(deps: AuthenticatedDeps = {}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const url = new URL(request.url);
      for (const key of url.searchParams.keys()) {
        if (key !== "limit" && key !== "cursor") throw new RequestValidationError();
      }
      const limit = url.searchParams.get("limit");
      const cursor = url.searchParams.get("cursor");
      return jsonResponse(
        200,
        await createClassicCsvRepository(db, auth).listImports(limit === null ? 50 : Number(limit), cursor),
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createClassicCSVImportHandler(deps: AuthenticatedDeps = {}) {
  return async function GET(request: Request, params: { id: string }): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      return jsonResponse(200, await createClassicCsvRepository(db, auth).getImport(params.id));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createSpotActivitiesHandler(deps: AuthenticatedDeps = {}) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const url = new URL(request.url);
      for (const key of url.searchParams.keys()) {
        if (key !== "limit" && key !== "cursor") throw new RequestValidationError();
      }
      const limit = url.searchParams.get("limit");
      const cursor = url.searchParams.get("cursor");
      return jsonResponse(
        200,
        await createClassicCsvRepository(db, auth).listActivities(limit === null ? 50 : Number(limit), cursor),
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createSpotActivityHandler(deps: AuthenticatedDeps = {}) {
  return async function GET(request: Request, params: { id: string }): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      return jsonResponse(200, await createClassicCsvRepository(db, auth).getActivity(params.id));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createSpotActivityPurposeHandler(deps: AuthenticatedDeps = {}) {
  return async function POST(request: Request, params: { id: string }): Promise<Response> {
    try {
      const { auth, db } = await requireAuthenticated(deps);
      const input = purposeChangeSchema.parse(await requireJsonBody(request));
      return jsonResponse(200, await createClassicCsvRepository(db, auth).setPurpose(params.id, input));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
