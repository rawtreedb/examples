import { RawTree, type JsonObject } from "@rawtree/sdk";

export type RawTreeJsonObject = JsonObject;

let rawtreeClient: RawTree | null = null;
let rawtreeClientApiKey: string | null = null;

export async function insertRawTreeRows<Row extends RawTreeJsonObject>(
  tableName: string,
  rows: Row | Row[],
): Promise<void> {
  await getRawTreeClient().insert(tableName, rows);
}

export async function queryRawTree<Row>(sql: string): Promise<Row[]> {
  const response = await getRawTreeClient().query<Row>(sql);
  return response.data;
}

export function sqlIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid RawTree table name: ${value}`);
  }

  return `\`${value}\``;
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function getRawTreeApiKey(): string {
  const apiKey = process.env.RAWTREE_API_KEY;
  if (!apiKey) {
    throw new Error("Set RAWTREE_API_KEY to use RawTree.");
  }

  return apiKey;
}

function getRawTreeClient(): RawTree {
  const apiKey = getRawTreeApiKey();
  if (rawtreeClient && rawtreeClientApiKey === apiKey) {
    return rawtreeClient;
  }

  rawtreeClientApiKey = apiKey;
  rawtreeClient = new RawTree({ apiKey });
  return rawtreeClient;
}
