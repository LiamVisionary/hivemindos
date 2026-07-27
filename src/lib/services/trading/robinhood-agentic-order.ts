export type RobinhoodEquityOrderInput = {
  ticker: string;
  side: "buy" | "sell";
  notionalUsd: number;
  qty?: number;
  accountId?: string;
};

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

export const ROBINHOOD_ORDER_FIELD_ALIASES = {
  accountId: ["account_id", "accountId", "account_number", "accountNumber", "account"],
  ticker: ["symbol", "ticker", "instrument_symbol", "instrumentSymbol"],
  side: ["side", "direction"],
  orderType: ["order_type", "orderType", "type"],
  timeInForce: ["time_in_force", "timeInForce", "tif"],
  notionalUsd: ["notional", "notional_usd", "notionalUsd", "notional_amount", "notionalAmount", "dollar_amount", "dollarAmount", "amount_in_dollars", "amount"],
  qty: ["quantity", "qty", "shares", "share_quantity", "shareQuantity"],
} as const;

export function robinhoodSchemaAliasKey(properties: Record<string, JsonSchema>, aliases: readonly string[]) {
  return aliases.find((alias) => Object.prototype.hasOwnProperty.call(properties, alias));
}

function buildOrderObject(schema: JsonSchema, input: RobinhoodEquityOrderInput) {
  const properties = schema.properties ?? {};
  const output: Record<string, unknown> = {};
  const assign = (aliases: readonly string[], value: unknown) => {
    const key = robinhoodSchemaAliasKey(properties, aliases);
    if (key && value !== undefined) output[key] = value;
    return key;
  };
  assign(ROBINHOOD_ORDER_FIELD_ALIASES.accountId, input.accountId);
  assign(ROBINHOOD_ORDER_FIELD_ALIASES.ticker, input.ticker);
  assign(ROBINHOOD_ORDER_FIELD_ALIASES.side, input.side);
  assign(ROBINHOOD_ORDER_FIELD_ALIASES.orderType, "market");
  assign(ROBINHOOD_ORDER_FIELD_ALIASES.timeInForce, "day");
  const quantityKey = input.qty && input.qty > 0 ? assign(ROBINHOOD_ORDER_FIELD_ALIASES.qty, input.qty) : undefined;
  if (!quantityKey) assign(ROBINHOOD_ORDER_FIELD_ALIASES.notionalUsd, input.notionalUsd);
  const missing = (schema.required ?? []).filter((key) => output[key] === undefined);
  if (missing.length) throw new Error(`Robinhood's live ${input.side} schema needs fields HivemindOS could not safely derive: ${missing.join(", ")}.`);
  return output;
}

/**
 * Adapt HivemindOS's governed market-order intent to the live schema Robinhood
 * returns from tools/list. It recognizes explicit semantic aliases only and
 * fails closed when a required field cannot be derived.
 */
export function buildRobinhoodEquityOrderArgs(schemaValue: unknown, input: RobinhoodEquityOrderInput) {
  const schema = schemaValue && typeof schemaValue === "object" ? schemaValue as JsonSchema : {};
  const properties = schema.properties ?? {};
  const nestedKey = ["order", "equity_order", "equityOrder", "request"].find((key) => properties[key]?.properties);
  if (!nestedKey) return buildOrderObject(schema, input);
  const output: Record<string, unknown> = { [nestedKey]: buildOrderObject(properties[nestedKey], input) };
  const topLevelAccount = robinhoodSchemaAliasKey(properties, ROBINHOOD_ORDER_FIELD_ALIASES.accountId);
  if (topLevelAccount && input.accountId) output[topLevelAccount] = input.accountId;
  const missing = (schema.required ?? []).filter((key) => output[key] === undefined);
  if (missing.length) throw new Error(`Robinhood's live order schema needs fields HivemindOS could not safely derive: ${missing.join(", ")}.`);
  return output;
}
