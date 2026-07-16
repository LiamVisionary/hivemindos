import { calcomReadAction } from "./calcom";
import { companyApiPreflightAction } from "./company-api-preflight";
import { medusaReadAction } from "./medusa";
import { monidReadAction, monidRunAction } from "./monid";
import { shopifyReadAction } from "./shopify";

export const INTEGRATION_HIVE_ACTIONS = [
  monidReadAction,
  monidRunAction,
  calcomReadAction,
  shopifyReadAction,
  medusaReadAction,
  companyApiPreflightAction,
] as const;
