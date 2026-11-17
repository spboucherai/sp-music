import { cache } from "react";
import { currentUser } from "./auth";

/** One session lookup per request, shared by the layouts and pages that need it. */
export const getUser = cache(currentUser);
