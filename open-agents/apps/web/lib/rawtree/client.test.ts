import { beforeEach, describe, expect, mock, test } from "bun:test";

class MockRawTreeError extends Error {
  readonly status: number;
  readonly error?: string;
  readonly hint?: string;

  constructor({
    error,
    hint,
    message,
    status,
  }: {
    error?: string;
    hint?: string;
    message: string;
    status: number;
  }) {
    super(message);
    this.name = "RawTreeError";
    this.status = status;
    this.error = error;
    this.hint = hint;
  }
}

const insertMock = mock(async () => ({ inserted: 1 }));
const queryMock = mock(async () => ({
  data: [] as unknown[],
}));

mock.module("@rawtree/sdk", () => ({
  RawTree: class {
    insert = insertMock;
    query = queryMock;
  },
  RawTreeError: MockRawTreeError,
}));

const clientModulePromise = import("./client");

beforeEach(() => {
  process.env.RAWTREE_API_KEY = "rt_test";
  insertMock.mockClear();
  queryMock.mockClear();
  queryMock.mockImplementation(async () => ({ data: [] }));
});

describe("RawTree client wrapper", () => {
  test("returns empty rows when a fresh RawTree project has not created the table yet", async () => {
    const { queryRawTree } = await clientModulePromise;
    queryMock.mockImplementationOnce(async () => {
      throw new MockRawTreeError({
        error: "rawtree_error",
        hint: "Check the table name and make sure it exists in your project.",
        message: "Table not found.",
        status: 400,
      });
    });

    await expect(queryRawTree("SELECT * FROM missing")).resolves.toEqual([]);
  });

  test("still throws non-missing-table RawTree errors", async () => {
    const { queryRawTree } = await clientModulePromise;
    queryMock.mockImplementation(async () => {
      throw new MockRawTreeError({
        error: "rawtree_error",
        message: "Syntax error.",
        status: 400,
      });
    });

    await expect(queryRawTree("bad sql")).rejects.toThrow("Syntax error.");
  });
});
