/**
 * App DB access — the framework convention: getDb built over the app schema.
 */
import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema";

export const getDb = createGetDb(schema);
export { schema };
